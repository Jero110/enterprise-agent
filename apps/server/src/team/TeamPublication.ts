import {
  EnterpriseError,
  TEAM_THREAD_AUDIENCE_MAX,
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

import { teamMemberKey } from "@t3tools/shared/teamMemberKey";

import * as EnterpriseStore from "../enterprise/EnterpriseStore.ts";
import { summarizeSharedThread } from "./sharedThreadSummary.ts";

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
  readonly publication_status: "unpublished" | "read-only";
  readonly publication_view: "full" | "summary";
  readonly publication_team_id: string | null;
  readonly publication_audience: string | null;
}
const denied = new EnterpriseError({ code: "access_denied", message: "Thread access denied." });
const MessagesJson = Schema.fromJsonString(Schema.Array(TeamThreadMessage));
const decodeMessages = Schema.decodeUnknownEffect(MessagesJson);
const encodeMessages = Schema.encodeEffect(MessagesJson);
const AudienceJson = Schema.fromJsonString(Schema.Array(Schema.String));
const decodeAudience = Schema.decodeUnknownSync(AudienceJson);
const encodeAudience = Schema.encodeSync(AudienceJson);
const audienceOf = (row: ThreadRow): ReadonlyArray<string> | null =>
  row.publication_audience === null ? null : decodeAudience(row.publication_audience);

type Viewer = Pick<EnterpriseHubIdentity, "email" | "teamId" | "role">;
/**
 * Who may read a shared thread: its owner, the owner's bosses (any admin, the lead of the
 * owner's area) and whoever the share names, or the owner's whole team when it names nobody.
 * An unshared thread is never readable by anyone but its owner.
 */
const canRead = (
  rows: ReadonlyMap<string, ThreadRow>,
  row: ThreadRow,
  owner: EnterpriseStore.EnterpriseMember,
  viewer: Viewer,
) => {
  if (viewer.email === owner.email) return true;
  const sharing = sharingAncestors(rows, row, owner.teamId);
  if (sharing.length === 0) return false;
  if (viewer.role === "admin") return true;
  if (viewer.role === "lead" && viewer.teamId !== null && viewer.teamId === owner.teamId)
    return true;
  return sharing.some((ancestor) => {
    const audience = audienceOf(ancestor);
    return audience === null
      ? viewer.teamId !== null && viewer.teamId === owner.teamId
      : audience.includes(viewer.email);
  });
};

const ancestors = (rows: ReadonlyMap<string, ThreadRow>, row: ThreadRow) => {
  const chain: ThreadRow[] = [];
  const visited = new Set<string>();
  let current: ThreadRow | undefined = row;
  while (current !== undefined) {
    if (visited.has(current.thread_id)) return undefined;
    visited.add(current.thread_id);
    chain.push(current);
    if (current.parent_thread_id === null) return chain;
    current = rows.get(current.parent_thread_id);
  }
  return undefined;
};
const sharingAncestors = (
  rows: ReadonlyMap<string, ThreadRow>,
  row: ThreadRow,
  teamId: string | null,
) =>
  teamId === null
    ? []
    : (ancestors(rows, row) ?? []).filter(
        (ancestor) =>
          ancestor.publication_status === "read-only" && ancestor.publication_team_id === teamId,
      );
const isPublished = (rows: ReadonlyMap<string, ThreadRow>, row: ThreadRow, teamId: string | null) =>
  sharingAncestors(rows, row, teamId).length > 0;
// The most restrictive share in the chain wins: under a summary share nothing exposes the transcript.
const publicationOf = (
  rows: ReadonlyMap<string, ThreadRow>,
  row: ThreadRow,
  teamId: string | null,
): TeamThreadSummary["publicationStatus"] => {
  const sharing = sharingAncestors(rows, row, teamId);
  if (sharing.length === 0) return "unpublished";
  return sharing.some((ancestor) => ancestor.publication_view === "summary")
    ? "summary"
    : "read-only";
};
const toSummary = (
  rows: ReadonlyMap<string, ThreadRow>,
  row: ThreadRow,
  owner: { readonly displayName: string; readonly teamId: string | null },
  forOwner = false,
): TeamThreadSummary => {
  const audience = audienceOf(row);
  return {
    threadId: row.thread_id,
    parentThreadId: row.parent_thread_id,
    title: row.title,
    status: row.status,
    updatedAt: row.updated_at,
    ownerEmail: row.owner_email,
    ownerDisplayName: owner.displayName,
    publicationStatus: publicationOf(rows, row, owner.teamId),
    ...(forOwner && audience !== null ? { audienceKeys: audience.map(teamMemberKey) } : {}),
  };
};

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
      sql<ThreadRow>`SELECT owner_email, thread_id, parent_thread_id, title, status, updated_at, publication_status, publication_view, publication_team_id, publication_audience FROM enterprise_team_threads WHERE owner_email = ${email}`.pipe(
        Effect.map((rows) => new Map(rows.map((row) => [row.thread_id, row]))),
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
              if (Array.from(rows.values()).some((row) => ancestors(rows, row) === undefined))
                return yield* denied;
              for (const snapshot of input.snapshots) {
                const row = rows.get(snapshot.threadId);
                // A delayed turn upload must never resurrect an unpublished snapshot.
                if (row === undefined || !isPublished(rows, row, owner.teamId)) continue;
                const messages =
                  publicationOf(rows, row, owner.teamId) === "summary"
                    ? summarizeSharedThread(snapshot.messages)
                    : snapshot.messages;
                yield* sql`UPDATE enterprise_team_threads SET snapshot_json = ${yield* encodeMessages(messages).pipe(Effect.orDie)}
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
        if (owner.teamId === null && input.status !== "unpublished") return yield* denied;
        const keys = input.audienceKeys ?? [];
        if (keys.length > TEAM_THREAD_AUDIENCE_MAX)
          return yield* new EnterpriseError({
            code: "access_denied",
            message: "Share with fewer people, or with your whole team.",
          });
        const members = keys.length === 0 ? [] : yield* store.listMembers;
        const audience: string[] = [];
        for (const key of new Set(keys)) {
          const member = members.find((entry) => teamMemberKey(entry.email) === key);
          if (member === undefined || !member.authorized || member.revoked)
            return yield* new EnterpriseError({
              code: "access_denied",
              message: "You can only share with people in your company.",
            });
          if (member.email !== owner.email) audience.push(member.email);
        }
        return yield* sql
          .withTransaction(
            Effect.gen(function* () {
              const rows = yield* ownerRows(owner.email);
              const target = rows.get(input.threadId);
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
                for (const row of rows.values()) {
                  if (
                    ancestors(rows, row)?.some((ancestor) => ancestor.thread_id === input.threadId)
                  ) {
                    yield* sql`UPDATE enterprise_team_threads SET publication_status = 'unpublished', publication_view = 'full', publication_team_id = NULL, publication_audience = NULL, snapshot_json = NULL
              WHERE owner_email = ${owner.email} AND thread_id = ${row.thread_id}`;
                  }
                }
              } else {
                const view = input.status === "summary" ? "summary" : "full";
                const audienceJson = keys.length === 0 ? null : encodeAudience(audience);
                yield* sql`UPDATE enterprise_team_threads SET publication_status = 'read-only', publication_view = ${view}, publication_team_id = ${owner.teamId}, publication_audience = ${audienceJson}
          WHERE owner_email = ${owner.email} AND thread_id = ${input.threadId}`;
                // Drop stored snapshots under this thread so a switch never leaves the other view behind.
                for (const row of rows.values()) {
                  if (
                    ancestors(rows, row)?.some((ancestor) => ancestor.thread_id === input.threadId)
                  ) {
                    yield* sql`UPDATE enterprise_team_threads SET snapshot_json = NULL
              WHERE owner_email = ${owner.email} AND thread_id = ${row.thread_id}`;
                  }
                }
              }
              return { updated: true };
            }),
          )
          .pipe(Effect.catchIf((error) => error._tag !== "EnterpriseError", Effect.die));
      },
    );
    const list: TeamPublication["Service"]["list"] = Effect.fn("TeamPublication.list")(
      function* (sessionId) {
        const viewer = yield* identity(sessionId);
        const owners = (yield* store.listMembers).filter(
          (member) => member.authorized && !member.revoked,
        );
        const summaries: TeamThreadSummary[] = [];
        for (const owner of owners) {
          const rows = yield* ownerRows(owner.email);
          for (const row of rows.values()) {
            if (canRead(rows, row, owner, viewer))
              summaries.push(toSummary(rows, row, owner, owner.email === viewer.email));
          }
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
        if (owner === null || !owner.authorized || owner.revoked) return yield* denied;
        const rows = yield* ownerRows(owner.email);
        const row = rows.get(input.threadId);
        if (
          row === undefined ||
          !isPublished(rows, row, owner.teamId) ||
          !canRead(rows, row, owner, viewer)
        )
          return yield* denied;
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
        const summary = toSummary(rows, row, owner, owner.email === viewer.email);
        const messages = yield* decodeMessages(json).pipe(Effect.orDie);
        return {
          summary,
          messages:
            summary.publicationStatus === "summary" ? summarizeSharedThread(messages) : messages,
        };
      },
    );
    return TeamPublication.of({ report, publish, list, get });
  }),
);
