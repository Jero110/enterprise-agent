import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  EnterpriseError,
  EnvironmentId,
  EventId,
  MessageId,
  NodeId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2DomainEvent,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as SqlClient from "effect/sql/SqlClient";

import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ApplicationEvents from "../persistence/OrchestrationEventStore.ts";
import * as EnterpriseClient from "./EnterpriseClient.ts";
import * as EnterpriseStore from "./EnterpriseStore.ts";
import { layerSeededStore } from "./EnterpriseStore.testkit.ts";
import * as RunRecords from "./RunRecords.ts";
import * as RunReporter from "./RunReporter.ts";

const email = "ent.test.hugo@gmail.com";
const lead = "jeronimo.deli@gmail.com";
const hubId = EnvironmentId.make("hub");
const threadId = ThreadId.make("thread");
const providerInstanceId = ProviderInstanceId.make("codex");
const now = DateTime.makeUnsafe("2026-11-05T00:00:00Z");
const later = DateTime.makeUnsafe("2026-11-05T00:01:00Z");

const threadCreated: OrchestrationV2DomainEvent = {
  id: EventId.make("created"),
  type: "thread.created",
  threadId,
  occurredAt: now,
  payload: {
    createdBy: "user",
    creationSource: "web",
    id: threadId,
    projectId: ProjectId.make("project"),
    title: "Work",
    providerInstanceId,
    modelSelection: { instanceId: providerInstanceId, model: "test-model" },
    runtimeMode: "approval-required",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    activeProviderThreadId: null,
    lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
    forkedFrom: null,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    lastVisitedAt: null,
    deletedAt: null,
  },
};
const run = (id: string, status: "running" | "completed"): OrchestrationV2DomainEvent => ({
  id: EventId.make(`run-${id}-${status}`),
  type: status === "running" ? "run.created" : "run.updated",
  threadId,
  occurredAt: status === "running" ? now : later,
  payload: {
    id: RunId.make(id),
    threadId,
    ordinal: Number(id.slice(-1)),
    providerInstanceId,
    modelSelection: { instanceId: providerInstanceId, model: "test-model" },
    providerThreadId: null,
    userMessageId: MessageId.make("message"),
    rootNodeId: NodeId.make("node"),
    activeAttemptId: null,
    status,
    requestedAt: now,
    startedAt: now,
    completedAt: status === "completed" ? later : null,
    checkpointId: null,
    contextHandoffId: null,
  },
});
const tool = (
  runId: string,
  id: string,
  toolName: string,
  input: unknown,
  output: unknown,
): OrchestrationV2DomainEvent => ({
  id: EventId.make(`item-${id}`),
  type: "turn-item.updated",
  threadId,
  occurredAt: now,
  payload: {
    type: "dynamic_tool",
    id: TurnItemId.make(id),
    threadId,
    runId: RunId.make(runId),
    nodeId: null,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: 1,
    status: "completed",
    title: null,
    startedAt: now,
    completedAt: later,
    updatedAt: later,
    toolName,
    input,
    output,
  },
});
const ok = (value: unknown) => ({ ok: true, value });

const fixture = (options: {
  readonly connected: Ref.Ref<boolean>;
  readonly online: Ref.Ref<boolean>;
  readonly attempts: Queue.Queue<string>;
  readonly changes: PubSub.PubSub<void>;
}) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const hub = yield* RunRecords.RunRecords;
      return Layer.mock(EnterpriseClient.EnterpriseClient)({
        hubEnvironmentId: Ref.get(options.connected).pipe(
          Effect.tap((connected) =>
            connected ? Effect.void : Queue.offer(options.attempts, "skipped"),
          ),
          Effect.map((connected) => (connected ? hubId : null)),
        ),
        connectionChanges: Stream.fromPubSub(options.changes),
        runReport: (input) =>
          Effect.gen(function* () {
            if (!(yield* Ref.get(options.online))) {
              yield* Queue.offer(options.attempts, `failed:${input.turnId}`);
              return yield* new EnterpriseError({
                code: "hub_unreachable",
                message: "offline",
              });
            }
            const result = yield* hub.report(email, input);
            yield* Queue.offer(options.attempts, `delivered:${input.turnId}`);
            return result;
          }),
      });
    }),
  );

const setup = (options: Parameters<typeof fixture>[0]) =>
  RunReporter.layer.pipe(
    Layer.provideMerge(fixture(options)),
    Layer.provideMerge(
      Layer.mergeAll(ProjectionStore.layer, ApplicationEvents.layer, RunRecords.layer),
    ),
    Layer.provideMerge(layerSeededStore),
    Layer.provide(
      Layer.mergeAll(NodeServices.layer, NodeCrypto.layer, SecureRandom.layerWebCrypto),
    ),
  );

const commit = Effect.fn("commit")(function* (...batch: ReadonlyArray<OrchestrationV2DomainEvent>) {
  const projection = yield* ProjectionStore.ProjectionStoreV2;
  const events = yield* ApplicationEvents.OrchestrationEventStore;
  for (const event of batch) yield* projection.apply(event);
  yield* events.publishCommitted(yield* events.appendAgentEvents({ events: [...batch] }));
});

const harness = (connected: boolean, online: boolean) =>
  Effect.gen(function* () {
    return {
      connected: yield* Ref.make(connected),
      online: yield* Ref.make(online),
      attempts: yield* Queue.unbounded<string>(),
      changes: yield* PubSub.unbounded<void>(),
    };
  });

it.effect("reports a completed turn's tools, knowledge reads and proposal to the hub", () =>
  Effect.gen(function* () {
    const options = yield* harness(true, true);
    yield* Effect.gen(function* () {
      const store = yield* EnterpriseStore.EnterpriseStore;
      for (const member of [email, lead])
        yield* store.enroll({ environmentId: member, email: member });
      const reporter = yield* RunReporter.RunReporter;
      const runs = yield* RunRecords.RunRecords;
      yield* commit(threadCreated);
      yield* reporter.start;
      yield* commit(
        run("run-1", "running"),
        tool(
          "run-1",
          "a",
          "t3-code.knowledge_get",
          { path: "global/a.md" },
          ok({ path: "global/a.md" }),
        ),
        tool(
          "run-1",
          "b",
          "mcp__t3-code__knowledge_get",
          { path: "global/b.md" },
          ok({ path: "global/b.md" }),
        ),
        tool("run-1", "c", "t3-code.knowledge_propose", { path: "global/c.md" }, [
          { type: "text", text: JSON.stringify(ok({ id: "proposal-1" })) },
        ]),
        tool("run-1", "d", "shell_helper", {}, undefined),
        tool("run-2", "other", "t3-code.knowledge_get", { path: "global/z.md" }, ok({})),
      );
      yield* commit(run("run-1", "completed"));
      expect(yield* Queue.take(options.attempts)).toBe("delivered:run-1");
      const [record] = yield* runs.query(lead, { member: email });
      expect(record).toMatchObject({
        threadId: "thread",
        turnId: "run-1",
        provider: "codex",
        model: "test-model",
        inputTokens: null,
        outputTokens: null,
        knowledgeReads: ["global/a.md", "global/b.md"],
        proposalIds: ["proposal-1"],
        startedAt: "2026-11-05T00:00:00.000Z",
        endedAt: "2026-11-05T00:01:00.000Z",
        outcome: "unknown",
      });
      expect(record?.toolCalls).toEqual([
        { name: "knowledge_get", mcpServer: "t3-code" },
        { name: "knowledge_get", mcpServer: "t3-code" },
        { name: "knowledge_propose", mcpServer: "t3-code" },
        { name: "shell_helper", mcpServer: null },
      ]);
    }).pipe(Effect.provide(setup(options)), Effect.scoped);
  }),
);

it.effect("sends nothing from an environment that is not enrolled", () =>
  Effect.gen(function* () {
    const options = yield* harness(false, true);
    yield* Effect.gen(function* () {
      const store = yield* EnterpriseStore.EnterpriseStore;
      for (const member of [email, lead])
        yield* store.enroll({ environmentId: member, email: member });
      const reporter = yield* RunReporter.RunReporter;
      const runs = yield* RunRecords.RunRecords;
      const sql = yield* SqlClient.SqlClient;
      yield* commit(threadCreated);
      yield* reporter.start;
      yield* commit(run("run-1", "running"));
      yield* commit(run("run-1", "completed"));
      // The startup flush and run-1 each consult the connection once and skip.
      expect(yield* Queue.take(options.attempts)).toBe("skipped");
      expect(yield* Queue.take(options.attempts)).toBe("skipped");
      yield* Ref.set(options.connected, true);
      yield* commit(run("run-2", "running"));
      yield* commit(run("run-2", "completed"));
      expect(yield* Queue.take(options.attempts)).toBe("delivered:run-2");
      expect((yield* runs.query(lead, {})).map((record) => record.turnId)).toEqual(["run-2"]);
      expect(yield* sql`SELECT turn_id FROM enterprise_run_outbox`).toEqual([{ turn_id: "run-2" }]);
    }).pipe(Effect.provide(setup(options)), Effect.scoped);
  }),
);

it.effect("queues while the hub is offline and delivers once after reconnect", () =>
  Effect.gen(function* () {
    const options = yield* harness(true, false);
    yield* Effect.gen(function* () {
      const store = yield* EnterpriseStore.EnterpriseStore;
      for (const member of [email, lead])
        yield* store.enroll({ environmentId: member, email: member });
      const reporter = yield* RunReporter.RunReporter;
      const runs = yield* RunRecords.RunRecords;
      yield* commit(threadCreated);
      yield* reporter.start;
      yield* commit(run("run-1", "running"));
      yield* commit(run("run-1", "completed"));
      expect(yield* Queue.take(options.attempts)).toBe("failed:run-1");
      expect(yield* runs.query(lead, {})).toEqual([]);
      yield* Ref.set(options.online, true);
      yield* PubSub.publish(options.changes, undefined);
      expect(yield* Queue.take(options.attempts)).toBe("delivered:run-1");
      yield* PubSub.publish(options.changes, undefined);
      yield* commit(run("run-2", "running"));
      yield* commit(run("run-2", "completed"));
      expect(yield* Queue.take(options.attempts)).toBe("delivered:run-2");
      expect((yield* runs.query(lead, {})).map((record) => record.turnId)).toEqual([
        "run-1",
        "run-2",
      ]);
    }).pipe(Effect.provide(setup(options)), Effect.scoped);
  }),
);
