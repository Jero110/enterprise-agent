import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as EnterpriseStore from "./EnterpriseStore.ts";
import { layerSeededStore } from "./EnterpriseStore.testkit.ts";
import * as RunRecords from "./RunRecords.ts";

const layer = RunRecords.layer.pipe(
  Layer.provideMerge(layerSeededStore),
  Layer.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer, SecureRandom.layerWebCrypto)),
);
const record = {
  threadId: "thread-1",
  turnId: "turn-1",
  provider: "codex",
  model: "model",
  inputTokens: 10,
  outputTokens: 20,
  toolCalls: [{ name: "knowledge_get", mcpServer: "hub" }],
  knowledgeReads: ["global/a.md", "global/b.md"],
  proposalIds: ["proposal-1"],
  startedAt: "2026-11-05T00:00:00Z",
  endedAt: "2026-11-05T00:01:00Z",
  outcome: "unknown" as const,
};
it.effect("binds records to enrollment, deduplicates delivery and fences lead queries", () =>
  Effect.gen(function* () {
    const store = yield* EnterpriseStore.EnterpriseStore;
    const runs = yield* RunRecords.RunRecords;
    for (const email of [
      "ent.test.hugo@gmail.com",
      "ent.test.gerry@gmail.com",
      "ent.test.ana@gmail.com",
      "jeronimo.deli@gmail.com",
    ]) {
      yield* store.enroll({ environmentId: email, email });
    }
    yield* runs.report("ent.test.hugo@gmail.com", record);
    yield* runs.report("ent.test.hugo@gmail.com", record);
    const all = yield* runs.query("jeronimo.deli@gmail.com", {});
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ ...record, member: "ent.test.hugo@gmail.com" });
    expect(yield* runs.query("ent.test.gerry@gmail.com", {})).toHaveLength(1);
    expect(
      Result.isFailure(
        yield* Effect.result(runs.query("ent.test.gerry@gmail.com", { teamId: "ledger" })),
      ),
    ).toBe(true);
    expect(Result.isFailure(yield* Effect.result(runs.query("ent.test.hugo@gmail.com", {})))).toBe(
      true,
    );
    expect(Result.isFailure(yield* Effect.result(runs.report("unbound", record)))).toBe(true);
  }).pipe(Effect.provide(layer)),
);
