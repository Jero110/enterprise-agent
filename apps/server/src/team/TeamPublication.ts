import {
  EnterpriseError,
  TeamThreadMessage,
  type EnterpriseHubIdentity,
  type TeamThreadPublishInput,
  type TeamThreadReference,
  type TeamThreadReport,
  type TeamThreadSnapshot,
  type TeamThreadSummary,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import * as EnterpriseStore from "../enterprise/EnterpriseStore.ts";

export class TeamPublication extends Context.Service<
  TeamPublication,
  {
    readonly report: (
      sessionId: string,
      input: TeamThreadReport,
    ) => Effect.Effect<{ readonly updated: boolean }, EnterpriseError>;
    readonly publish: (
      sessionId: string,
      input: TeamThreadPublishInput,
    ) => Effect.Effect<{ readonly updated: boolean }, EnterpriseError>;
    readonly list: (
      sessionId: string,
    ) => Effect.Effect<ReadonlyArray<TeamThreadSummary>, EnterpriseError>;
    readonly get: (
      sessionId: string,
      input: TeamThreadReference,
    ) => Effect.Effect<TeamThreadSnapshot, EnterpriseError>;
  }
>()("t3/team/TeamPublication") {}

interface ThreadRow {
  readonly owner_email: string;
  readonly thread_id: string;
  readonly parent_thread_id: string | null;
  readonly title: string;
  readonly status: TeamThreadSummary["status"];
  readonly updated_at: string;
  readonly publication_status: TeamThreadSummary["publicationStatus"];
  readonly publication_team_id: string | null;
  readonly snapshot_json: string | null;
}
const denied = new EnterpriseError({ code: "access_denied", message: "Thread access denied." });
const MessagesJson = Schema.fromJsonString(Schema.Array(TeamThreadMessage));
const decodeMessages = Schema.decodeUnknownEffect(MessagesJson);
const encodeMessages = Schema.encodeEffect(MessagesJson);

const ancestors = (rows: ReadonlyArray<ThreadRow>, row: ThreadRow) => {
  const byId = new Map(rows.map((thread) => [thread.thread_id, thread]));
  const chain: ThreadRow[] = [];
  const visited = new Set<string>();
  let current: ThreadRow | undefined = row;
  while (current !== undefined) {
    if (visited.has(current.thread_id)) return undefined;
    visited.add(current.thread_id);
    chain.push(current);
    if (current.parent_thread_id === null) return chain;
    current = byId.get(current.parent_thread_id);
  }
  return undefined;
};
const isPublished = (rows: ReadonlyArray<ThreadRow>, row: ThreadRow, teamId: string | null) =>
  teamId !== null &&
  ancestors(rows, row)?.some(
    (ancestor) =>
      ancestor.publication_status === "read-only" && ancestor.publication_team_id === teamId,
  ) === true;
const toSummary = (
  rows: ReadonlyArray<ThreadRow>,
  row: ThreadRow,
  owner: { readonly displayName: string; readonly teamId: string | null },
): TeamThreadSummary => ({
  threadId: row.thread_id,
  parentThreadId: row.parent_thread_id,
  title: row.title,
  status: row.status,
  updatedAt: row.updated_at,
  ownerEmail: row.owner_email,
  ownerDisplayName: owner.displayName,
  publicationStatus: isPublished(rows, row, owner.teamId) ? "read-only" : "unpublished",
});

export const layer = Layer.effect(
  TeamPublication,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const store = yield* EnterpriseStore.EnterpriseStore;
    const identity = Effect.fn("TeamPublication.identity")(function* (sessionId: string) {
      const enrollment = yield* store.getEnrollment(sessionId);
      if (enrollment === null)
        return yield* new EnterpriseError({
          code: "not_connected",
          message: "Connect to your enterprise first.",
        });
      const member = yield* store.getMember(enrollment.email);
      if (member === null || !member.authorized || member.revoked) return yield* denied;
      return member;
    });
    const ownerRows = (email: string) =>
      sql<ThreadRow>`SELECT owner_email, thread_id, parent_thread_id, title, status, updated_at, publication_status, publication_team_id, NULL AS snapshot_json FROM enterprise_team_threads WHERE owner_email = ${email}`.pipe(
        Effect.orDie,
      );
    const report: TeamPublication["Service"]["report"] = Effect.fn("TeamPublication.report")(
      function* (sessionId, input) {
        const owner = yield* identity(sessionId);
        return yield* sql
          .withTransaction(
            Effect.gen(function* () {
              for (const thread of input.summaries) {
                yield* sql`INSERT INTO enterprise_team_threads (owner_email, thread_id, parent_thread_id, title, status, updated_at)
          VALUES (${owner.email}, ${thread.threadId}, ${thread.parentThreadId}, ${thread.title}, ${thread.status}, ${thread.updatedAt})
          ON CONFLICT(owner_email, thread_id) DO UPDATE SET parent_thread_id = excluded.parent_thread_id, title = excluded.title,
            status = excluded.status, updated_at = excluded.updated_at`;
              }
              const rows = yield* ownerRows(owner.email);
              if (rows.some((row) => ancestors(rows, row) === undefined)) return yield* denied;
              for (const snapshot of input.snapshots) {
                const row = rows.find((thread) => thread.thread_id === snapshot.threadId);
                // A delayed turn upload must never resurrect an unpublished snapshot.
                if (row === undefined || !isPublished(rows, row, owner.teamId)) continue;
                yield* sql`UPDATE enterprise_team_threads SET snapshot_json = ${yield* encodeMessages(snapshot.messages).pipe(Effect.orDie)}
          WHERE owner_email = ${owner.email} AND thread_id = ${snapshot.threadId}`;
              }
              return { updated: true };
            }),
          )
          .pipe(Effect.catchIf((error) => error._tag !== "EnterpriseError", Effect.die));
      },
    );
    const publish: TeamPublication["Service"]["publish"] = Effect.fn("TeamPublication.publish")(
      function* (sessionId, input) {
        const owner = yield* identity(sessionId);
        if (owner.teamId === null && input.status === "read-only") return yield* denied;
        return yield* sql
          .withTransaction(
            Effect.gen(function* () {
              const rows = yield* ownerRows(owner.email);
              const target = rows.find((row) => row.thread_id === input.threadId);
              if (target === undefined) return yield* denied;
              if (input.status === "unpublished") {
                if (
                  ancestors(rows, target)
                    ?.slice(1)
                    .some((ancestor) => isPublished(rows, ancestor, owner.teamId))
                ) {
                  return yield* new EnterpriseError({
                    code: "access_denied",
                    message: "Unpublish the parent thread first.",
                  });
                }
                for (const row of rows) {
                  if (
                    ancestors(rows, row)?.some((ancestor) => ancestor.thread_id === input.threadId)
                  ) {
                    yield* sql`UPDATE enterprise_team_threads SET publication_status = 'unpublished', publication_team_id = NULL, snapshot_json = NULL
              WHERE owner_email = ${owner.email} AND thread_id = ${row.thread_id}`;
                  }
                }
              } else {
                yield* sql`UPDATE enterprise_team_threads SET publication_status = 'read-only', publication_team_id = ${owner.teamId}
          WHERE owner_email = ${owner.email} AND thread_id = ${input.threadId}`;
              }
              return { updated: true };
            }),
          )
          .pipe(Effect.catchIf((error) => error._tag !== "EnterpriseError", Effect.die));
      },
    );
    const visibleOwner = (
      viewer: Pick<EnterpriseHubIdentity, "email" | "teamId" | "role">,
      owner: EnterpriseStore.EnterpriseMember,
    ) =>
      owner.authorized &&
      !owner.revoked &&
      (viewer.role === "admin" ||
        viewer.email === owner.email ||
        (viewer.teamId !== null && viewer.teamId === owner.teamId));
    const list: TeamPublication["Service"]["list"] = Effect.fn("TeamPublication.list")(
      function* (sessionId) {
        const viewer = yield* identity(sessionId);
        const owners = (yield* store.listMembers).filter((member) => visibleOwner(viewer, member));
        const summaries: TeamThreadSummary[] = [];
        for (const owner of owners) {
          const rows = yield* ownerRows(owner.email);
          summaries.push(...rows.map((row) => toSummary(rows, row, owner)));
        }
        return summaries.sort(
          (a, b) =>
            a.ownerEmail.localeCompare(b.ownerEmail) ||
            b.updatedAt.localeCompare(a.updatedAt) ||
            a.threadId.localeCompare(b.threadId),
        );
      },
    );
    const get: TeamPublication["Service"]["get"] = Effect.fn("TeamPublication.get")(
      function* (sessionId, input) {
        const viewer = yield* identity(sessionId);
        const owner = yield* store.getMember(input.ownerEmail);
        if (owner === null || !visibleOwner(viewer, owner)) return yield* denied;
        const rows = yield* ownerRows(owner.email);
        const row = rows.find((thread) => thread.thread_id === input.threadId);
        if (row === undefined || !isPublished(rows, row, owner.teamId)) return yield* denied;
        const snapshot = yield* sql<{
          readonly snapshot_json: string | null;
        }>`SELECT snapshot_json FROM enterprise_team_threads WHERE owner_email = ${owner.email} AND thread_id = ${row.thread_id}`.pipe(
          Effect.orDie,
        );
        const json = snapshot[0]?.snapshot_json;
        if (json == null)
          return yield* new EnterpriseError({
            code: "snapshot_unavailable",
            message: "The owner's IDE has not uploaded this snapshot yet.",
          });
        return {
          summary: toSummary(rows, row, owner),
          messages: yield* decodeMessages(json).pipe(Effect.orDie),
        };
      },
    );
    return TeamPublication.of({ report, publish, list, get });
  }),
);
