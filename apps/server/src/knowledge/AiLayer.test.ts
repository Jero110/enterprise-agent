import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as FileSystem from "effect/FileSystem";
import * as ServerConfig from "../config.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import { layerSeededStore } from "../enterprise/EnterpriseStore.testkit.ts";
import { layerKnowledge } from "./KnowledgeRepo.testkit.ts";
import * as KnowledgeRepo from "./KnowledgeRepo.ts";
import * as AiLayer from "./AiLayer.ts";

it.effect("generates every member and hub tool and real skill without a second commit", () =>
  Effect.gen(function* () {
    const ai = yield* AiLayer.AiLayer;
    const repo = yield* KnowledgeRepo.KnowledgeRepo;
    yield* ai.generate();
    const docs = yield* repo.documents;
    for (const toolkit of AiLayer.toolkits) {
      for (const name of Object.keys(toolkit.tools)) {
        expect(docs.find((doc) => doc.id === `global/ai/tools/${name}.md`)).toMatchObject({
          title: name,
          areaId: "general",
          layer: "ai",
          private: false,
        });
      }
    }
    expect(
      docs.find((doc) => doc.id === "global/ai/skills/skill-codex-investigate.md")?.content,
    ).toContain("Verify evidence before proposing.");
    const config = yield* ServerConfig.ServerConfig;
    const fs = yield* FileSystem.FileSystem;
    const root = `${config.baseDir}/enterprise/knowledge`;
    const head = yield* fs.readFileString(
      `${root}/.git/refs/heads/${(yield* fs.readFileString(`${root}/.git/HEAD`)).trim().replace("ref: refs/heads/", "")}`,
    );
    yield* ai.generate();
    expect(
      yield* fs.readFileString(
        `${root}/.git/refs/heads/${(yield* fs.readFileString(`${root}/.git/HEAD`)).trim().replace("ref: refs/heads/", "")}`,
      ),
    ).toBe(head);
  }).pipe(
    Effect.provide(
      AiLayer.layer.pipe(
        Layer.provideMerge(layerKnowledge),
        Layer.provideMerge(layerSeededStore),
        Layer.provide(
          Layer.succeed(ProviderRegistry.ProviderRegistry, {
            getProviders: Effect.gen(function* () {
              const fs = yield* FileSystem.FileSystem;
              const config = yield* ServerConfig.ServerConfig;
              const path = `${config.baseDir}/sample-skill.md`;
              yield* fs.writeFileString(path, "# Investigate\nVerify evidence before proposing.");
              return [
                {
                  instanceId: "codex",
                  skills: [{ name: "investigate", path, description: "Investigate sources" }],
                },
              ];
            }),
          } as unknown as ProviderRegistry.ProviderRegistry["Service"]),
        ),
        Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-ai-layer-" })),
        Layer.provideMerge(
          Layer.mergeAll(NodeServices.layer, NodeCrypto.layer, SecureRandom.layerWebCrypto),
        ),
      ),
    ),
  ),
);
