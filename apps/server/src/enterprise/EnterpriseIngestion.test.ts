import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  ProviderInstanceId,
  type ApplicationStoredEvent,
  type OrchestrationV2ServerCommand,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as FileSystem from "effect/FileSystem";
import * as Deferred from "effect/Deferred";
import * as Stream from "effect/Stream";
import * as ApplicationEvents from "../persistence/OrchestrationEventStore.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as KnowledgeProposals from "./KnowledgeProposals.ts";
import * as Result from "effect/Result";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as ServerConfig from "../config.ts";
import { layerKnowledge } from "../knowledge/KnowledgeRepo.testkit.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as EnterpriseHub from "./EnterpriseHub.ts";
import * as EnterpriseIngestion from "./EnterpriseIngestion.ts";
import * as EnterpriseStore from "./EnterpriseStore.ts";
import { layerSeededStore } from "./EnterpriseStore.testkit.ts";

const token = "ACME-BANK-DEV-2026";
const modelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-6-luna" };
const layerFor = (commands: OrchestrationV2ServerCommand[]) =>
  EnterpriseIngestion.layer.pipe(
    Layer.provideMerge(EnterpriseHub.layer),
    Layer.provideMerge(layerKnowledge),
    Layer.provideMerge(layerSeededStore),
    Layer.provideMerge(
      Layer.succeed(ProjectService.ProjectService, {
        bootstrap: (input: { projectId: string }) =>
          Effect.succeed({ project: { id: input.projectId }, created: true }),
      } as unknown as ProjectService.ProjectService["Service"]),
    ),
    Layer.provideMerge(
      Layer.succeed(ThreadManagement.ThreadManagementService, {
        dispatch: (command: OrchestrationV2ServerCommand) =>
          Effect.sync(() => {
            commands.push(command);
            return {} as never;
          }),
      } as unknown as ThreadManagement.ThreadManagementService["Service"]),
    ),
    Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-ingestion-" })),
    Layer.provideMerge(
      Layer.mergeAll(NodeServices.layer, NodeCrypto.layer, SecureRandom.layerWebCrypto),
    ),
  );

describe("EnterpriseIngestion", () => {
  it.effect("rejects a non-admin before starting any work", () => {
    const commands: OrchestrationV2ServerCommand[] = [];
    return Effect.gen(function* () {
      const hub = yield* EnterpriseHub.EnterpriseHub;
      const ingestion = yield* EnterpriseIngestion.EnterpriseIngestion;
      yield* hub.enroll("ana", { email: "ent.test.ana@gmail.com", token });
      const result = yield* Effect.result(
        ingestion.start("ana", { folder: "/not-needed", modelSelection }),
      );
      expect(Result.isFailure(result) && result.failure.code).toBe("admin_required");
      expect(commands).toEqual([]);
    }).pipe(Effect.provide(layerFor(commands)));
  });
  it.effect(
    "skips completed content hashes, retries failures and supports note-only runs with an index",
    () => {
      const commands: OrchestrationV2ServerCommand[] = [];
      return Effect.gen(function* () {
        const hub = yield* EnterpriseHub.EnterpriseHub;
        const ingestion = yield* EnterpriseIngestion.EnterpriseIngestion;
        const proposals = yield* KnowledgeProposals.KnowledgeProposals;
        const store = yield* EnterpriseStore.EnterpriseStore;
        const fs = yield* FileSystem.FileSystem;
        yield* hub.enroll("admin", { email: "jeronimo.deli@gmail.com", token });
        const bytes = new Uint8Array([0, 255, 128, 10]);
        const upload = yield* proposals.upload("jeronimo.deli@gmail.com", {
          scope: "global",
          reason: "Bucket",
          files: [{ name: "opaque.bin", mimeType: "application/octet-stream", bytes }],
        });
        const input = { uploadProposalIds: [upload.id], modelSelection };
        const first = yield* ingestion.start("admin", input);
        const firstMessage = commands.find((command) => command.type === "message.dispatch");
        const source = /Selected sources \(data\): (.+)/.exec(firstMessage!.text)!;
        const sourcePath = (JSON.parse(source[1]!) as string[])[0]!;
        expect(Array.from(yield* fs.readFile(sourcePath))).toEqual(Array.from(bytes));
        yield* ingestion.finish(first.threadId, "failed");
        expect((yield* store.getIngestionRun(first.threadId))?.status).toBe("failed");
        const retry = yield* ingestion.start("admin", input);
        yield* ingestion.finish(retry.threadId, "completed");
        const second = yield* ingestion.start("admin", input);
        expect((yield* store.getIngestionRun(second.threadId))?.status).toBe("completed");
        expect(commands.filter((command) => command.type === "message.dispatch")).toHaveLength(2);
        yield* ingestion.start("admin", { note: "We're missing payment owners", modelSelection });
        const message = commands.filter((command) => command.type === "message.dispatch").at(-1)!;
        expect(message.text).toContain("We're missing payment owners");
        expect(message.text).toContain('"path":"areas/ledger/README.md"');
        expect(message.text).toContain("Existing node index");
        const invalid = yield* Effect.result(ingestion.start("admin", { modelSelection }));
        expect(Result.isFailure(invalid)).toBe(true);
      }).pipe(Effect.provide(layerFor(commands)));
    },
  );
  it.effect(
    "reconciles terminal runs after restart and persists live failures from committed events",
    () => {
      const commands: OrchestrationV2ServerCommand[] = [];
      return Effect.gen(function* () {
        const store = yield* EnterpriseStore.EnterpriseStore;
        const ingestion = yield* EnterpriseIngestion.EnterpriseIngestion;
        for (const threadId of ["restart", "live"]) {
          yield* store.saveIngestionRun({
            id: threadId,
            threadId,
            adminEmail: "jeronimo.deli@gmail.com",
            folder: "/bucket",
            status: "running",
          });
        }
        const settled = yield* Deferred.make<void>();
        const tracker = EnterpriseIngestion.layerTracking.pipe(
          Layer.provide(
            Layer.succeed(EnterpriseIngestion.EnterpriseIngestion, {
              ...ingestion,
              finish: (threadId, status) =>
                ingestion
                  .finish(threadId, status)
                  .pipe(
                    Effect.tap(() =>
                      threadId === "live" ? Deferred.succeed(settled, undefined) : Effect.void,
                    ),
                  ),
            }),
          ),
          Layer.provide(Layer.succeed(EnterpriseStore.EnterpriseStore, store)),
          Layer.provide(
            Layer.succeed(ProjectionStore.ProjectionStoreV2, {
              getThreadRecords: (threadId: string) =>
                Effect.succeed({
                  runs: [{ status: threadId === "restart" ? "completed" : "running" }],
                }),
            } as unknown as ProjectionStore.ProjectionStoreV2["Service"]),
          ),
          Layer.provide(
            Layer.succeed(ApplicationEvents.OrchestrationEventStore, {
              latestApplicationSequence: Effect.succeed(0),
              streamProjectedApplicationEvents: ({
                project,
                filter,
              }: {
                project: (event: ApplicationStoredEvent) => { sequence: number };
                filter: (event: ApplicationStoredEvent) => boolean;
              }) => {
                const event = {
                  sequence: 1,
                  event: { type: "run.updated", threadId: "live", payload: { status: "failed" } },
                } as unknown as ApplicationStoredEvent;
                return Stream.fromIterable(filter(event) ? [project(event)] : []);
              },
            } as unknown as ApplicationEvents.OrchestrationEventStore["Service"]),
          ),
        );
        yield* Layer.build(tracker);
        yield* Deferred.await(settled);
        expect((yield* store.getIngestionRun("restart"))?.status).toBe("completed");
        expect((yield* store.getIngestionRun("live"))?.status).toBe("failed");
      }).pipe(Effect.provide(layerFor(commands)));
    },
  );
  it.effect("starts an ordinary thread attributed to the authenticated admin", () => {
    const commands: OrchestrationV2ServerCommand[] = [];
    return Effect.gen(function* () {
      const hub = yield* EnterpriseHub.EnterpriseHub;
      const store = yield* EnterpriseStore.EnterpriseStore;
      const ingestion = yield* EnterpriseIngestion.EnterpriseIngestion;
      yield* hub.enroll("admin", { email: "jeronimo.deli@gmail.com", token });
      const fs = yield* FileSystem.FileSystem;
      const folder = yield* fs.makeTempDirectoryScoped();
      yield* fs.writeFileString(`${folder}/meeting.txt`, "Ana: I own the ledger decision.");
      const result = yield* ingestion.start("admin", { folder, modelSelection });
      expect(commands.map((command) => command.type)).toEqual([
        "thread.create",
        "message.dispatch",
      ]);
      expect(commands[0]).toMatchObject({ threadId: result.threadId, modelSelection });
      const message = commands.find((command) => command.type === "message.dispatch");
      expect(message?.text).toContain("Organization and areas");
      expect(message?.text).toContain("Ledger");
      expect(message?.text).toContain("knowledge_propose");
      expect(message?.text).toContain("Metrics, Business, AI, Data");
      expect(message?.text).toContain("Existing node index");
      expect(yield* store.getIngestionRun(result.threadId)).toMatchObject({
        id: result.runId,
        adminEmail: "jeronimo.deli@gmail.com",
        folder,
        status: "running",
      });
    }).pipe(Effect.provide(layerFor(commands)));
  });
});
