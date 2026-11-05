import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as SecureRandom from "effect/crypto/SecureRandom";

import { PREAUTHORIZED_ADMIN_EMAIL } from "@t3tools/contracts";
import { layerSeededStore } from "../enterprise/EnterpriseStore.testkit.ts";
import * as ServerConfig from "../config.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as KnowledgeRepo from "./KnowledgeRepo.ts";
import * as KnowledgeProposals from "../enterprise/KnowledgeProposals.ts";
import * as TeamIdentity from "../auth/TeamIdentity.ts";
import * as AreaKnowledge from "./AreaKnowledge.ts";
import * as SessionContext from "./SessionContext.ts";

const base = Layer.mergeAll(NodeServices.layer, NodeCrypto.layer, SecureRandom.layerWebCrypto);
const layer = SessionContext.layer.pipe(
  Layer.provideMerge(AreaKnowledge.layer),
  Layer.provideMerge(KnowledgeProposals.layer),
  Layer.provideMerge(KnowledgeRepo.layer),
  Layer.provideMerge(ProcessRunner.layer),
  Layer.provideMerge(TeamIdentity.layer),
  Layer.provideMerge(layerSeededStore),
  Layer.provideMerge(
    Layer.effect(
      ServerConfig.ServerConfig,
      Effect.gen(function* () {
        const config = yield* ServerConfig.ServerConfig;
        return { ...config, devUrl: new URL("http://localhost:5173") };
      }),
    ).pipe(
      Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-session-context-test-" })),
      Layer.provide(base),
    ),
  ),
  Layer.provideMerge(base),
);

describe("SessionContext", () => {
  it.effect("shows only documents authorized for the authenticated identity", () =>
    Effect.gen(function* () {
      const context = yield* SessionContext.SessionContext;
      const identity = yield* (yield* TeamIdentity.TeamIdentity).verifyGoogleToken({
        token: TeamIdentity.createFakeGoogleToken({
          email: PREAUTHORIZED_ADMIN_EMAIL,
          sub: "google-jero",
          name: "Jero",
        }),
      });
      const documents = yield* context.listAuthorizedDocuments(identity);
      expect(documents.map((document) => document.areaId)).toEqual([
        "general",
        "accounts",
        "frontend",
        "ledger",
        "platform",
        "risk",
      ]);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("denies unauthorized agent document reads", () =>
    Effect.gen(function* () {
      const context = yield* SessionContext.SessionContext;
      const identity = yield* (yield* TeamIdentity.TeamIdentity).getAnonymousDevIdentity();
      const result = yield* context
        .readAuthorizedDocument(identity, "areas/ledger/README.md")
        .pipe(Effect.exit);
      expect(Exit.isFailure(result)).toBe(true);
    }).pipe(Effect.provide(layer)),
  );
});
