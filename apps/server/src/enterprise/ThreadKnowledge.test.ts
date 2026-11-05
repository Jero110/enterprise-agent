import { expect, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import Migration from "../persistence/Migrations/085_ThreadKnowledgeOff.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as EnterpriseClient from "./EnterpriseClient.ts";
import * as ThreadKnowledge from "./ThreadKnowledge.ts";

const documents = [
  { id: "global/overview.md", areaId: "general", title: "Overview" },
  { id: "areas/ledger/README.md", areaId: "ledger", title: "Ledger" },
];

const read = {
  type: "dynamic_tool",
  toolName: "mcp__t3-code__knowledge_get",
  status: "completed",
  input: { path: "global/overview.md" },
  output: { ok: true, value: {} },
};

const layerFor = (listed: typeof documents) =>
  ThreadKnowledge.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(EnterpriseClient.EnterpriseClient, {
          knowledgeList: Effect.succeed({ documents: listed }),
        } as never),
        Layer.succeed(ProjectionStore.ProjectionStoreV2, {
          getThreadRecords: () => Effect.succeed({ turnItems: [read] }),
        } as never),
      ),
    ),
    Layer.provideMerge(NodeSqliteClient.layer({ filename: ":memory:" })),
  );

it.effect("a conversation switches a knowledge level off and on, and only that level", () =>
  Effect.gen(function* () {
    yield* Migration;
    const knowledge = yield* ThreadKnowledge.ThreadKnowledge;
    const threadId = "thread-1";

    const fresh = yield* knowledge.get({ threadId });
    expect(fresh.cards.map((card) => [card.scope, card.enabled])).toEqual([
      ["general", true],
      ["area", true],
    ]);
    expect(fresh.cards[0]?.documents).toEqual([
      { path: "global/overview.md", title: "Overview", areaId: "general", loaded: true },
    ]);
    expect(fresh.cards[1]?.documents[0]?.loaded).toBe(false);

    const off = yield* knowledge.set({ threadId, scope: "general", enabled: false });
    expect(off.cards[0]?.enabled).toBe(false);
    expect(yield* knowledge.allows(threadId, "general")).toBe(false);
    expect(yield* knowledge.allows(threadId, "ledger")).toBe(true);
    expect(yield* knowledge.allows("thread-2", "general")).toBe(true);

    const on = yield* knowledge.set({ threadId, scope: "general", enabled: true });
    expect(on.cards[0]?.enabled).toBe(true);
    expect(yield* knowledge.allows(threadId, "general")).toBe(true);
  }).pipe(Effect.provide(layerFor(documents))),
);

it.effect("a member without area documents gets no area card", () =>
  Effect.gen(function* () {
    yield* Migration;
    const knowledge = yield* ThreadKnowledge.ThreadKnowledge;
    const context = yield* knowledge.get({ threadId: "thread-1" });
    expect(context.cards.map((card) => card.scope)).toEqual(["general"]);
  }).pipe(Effect.provide(layerFor(documents.slice(0, 1)))),
);
