import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { ProviderInstanceId, type OrchestrationV2ServerCommand } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
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
  it.effect("starts an ordinary thread attributed to the authenticated admin", () => {
    const commands: OrchestrationV2ServerCommand[] = [];
    return Effect.gen(function* () {
      const hub = yield* EnterpriseHub.EnterpriseHub;
      const store = yield* EnterpriseStore.EnterpriseStore;
      const ingestion = yield* EnterpriseIngestion.EnterpriseIngestion;
      yield* hub.enroll("admin", { email: "jeronimo.deli@gmail.com", token });
      const result = yield* ingestion.start("admin", { folder: process.cwd(), modelSelection });
      expect(commands.map((command) => command.type)).toEqual([
        "thread.create",
        "message.dispatch",
      ]);
      expect(commands[0]).toMatchObject({ threadId: result.threadId, modelSelection });
      expect(yield* store.getIngestionRun(result.threadId)).toMatchObject({
        id: result.runId,
        adminEmail: "jeronimo.deli@gmail.com",
        folder: process.cwd(),
        status: "running",
      });
    }).pipe(Effect.provide(layerFor(commands)));
  });
});
