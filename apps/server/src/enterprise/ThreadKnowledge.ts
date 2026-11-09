import {
  EnterpriseError,
  type ThreadContext,
  type ThreadContextInput,
  type ThreadContextSetInput,
  ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";

import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as EnterpriseClient from "./EnterpriseClient.ts";
import { knowledgeReadPaths } from "./RunReporter.ts";

/**
 * Which enterprise knowledge a conversation may use. Defaults to everything the hub lets the
 * member read; a conversation can switch the general or area level off, enforced on the member
 * IDE before an agent's answer is returned, so the hub's own filtering is never loosened.
 */
export class ThreadKnowledge extends Context.Service<
  ThreadKnowledge,
  {
    readonly get: (input: ThreadContextInput) => Effect.Effect<ThreadContext, EnterpriseError>;
    readonly set: (input: ThreadContextSetInput) => Effect.Effect<ThreadContext, EnterpriseError>;
    readonly allows: (threadId: string, areaId: string) => Effect.Effect<boolean>;
  }
>()("t3/enterprise/ThreadKnowledge") {}

const scopeOf = (areaId: string) =>
  areaId === "general" ? ("general" as const) : ("area" as const);

export const layer = Layer.effect(
  ThreadKnowledge,
  Effect.gen(function* () {
    const client = yield* EnterpriseClient.EnterpriseClient;
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    const sql = yield* SqlClient.SqlClient;

    const switchedOff = (threadId: string) =>
      sql<{ readonly scope: string }>`
        SELECT scope FROM enterprise_thread_knowledge_off WHERE thread_id = ${threadId}`.pipe(
        Effect.map((rows) => new Set(rows.map((row) => row.scope))),
        Effect.orDie,
      );

    const get: ThreadKnowledge["Service"]["get"] = Effect.fn("ThreadKnowledge.get")(function* ({
      threadId,
    }) {
      const { documents } = yield* client.knowledgeList;
      const off = yield* switchedOff(threadId);
      const read = yield* projections.getThreadRecords(ThreadId.make(threadId), ["turnItems"]).pipe(
        Effect.map((records) => knowledgeReadPaths(records.turnItems)),
        Effect.orElseSucceed(() => new Set<string>()),
      );
      const card = (scope: "general" | "area") => ({
        scope,
        enabled: !off.has(scope),
        documents: documents
          .filter(
            (document) => document.areaId !== "personal" && scopeOf(document.areaId) === scope,
          )
          .map((document) => ({
            path: document.id,
            title: document.title,
            areaId: document.areaId,
            loaded: read.has(document.id),
            enabled: !off.has(`area:${document.areaId}`),
          })),
      });
      const area = card("area");
      return { cards: area.documents.length > 0 ? [card("general"), area] : [card("general")] };
    });

    const set: ThreadKnowledge["Service"]["set"] = Effect.fn("ThreadKnowledge.set")(
      function* (input) {
        const { documents } = yield* client.knowledgeList;
        if (
          input.areaId !== undefined &&
          (input.scope !== "area" ||
            input.areaId === "general" ||
            !documents.some((document) => document.areaId === input.areaId))
        ) {
          return yield* new EnterpriseError({
            code: "access_denied",
            message: "This area is not available to this conversation.",
          });
        }
        const key = input.areaId === undefined ? input.scope : `area:${input.areaId}`;
        yield* (
          input.enabled
            ? sql`DELETE FROM enterprise_thread_knowledge_off
                WHERE thread_id = ${input.threadId} AND scope = ${key}`
            : sql`INSERT OR IGNORE INTO enterprise_thread_knowledge_off (thread_id, scope)
                VALUES (${input.threadId}, ${key})`
        ).pipe(Effect.orDie);
        return yield* get({ threadId: input.threadId });
      },
    );

    const allows: ThreadKnowledge["Service"]["allows"] = (threadId, areaId) =>
      switchedOff(threadId).pipe(
        Effect.map(
          (off) =>
            areaId === "personal" ||
            (!off.has(scopeOf(areaId)) && (areaId === "general" || !off.has(`area:${areaId}`))),
        ),
      );

    return ThreadKnowledge.of({ get, set, allows });
  }),
);
