import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { AuthSessionId, EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as SecureRandom from "effect/crypto/SecureRandom";

import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import { layerKnowledge } from "../knowledge/KnowledgeRepo.testkit.ts";
import * as TeamPublication from "../team/TeamPublication.ts";
import * as EnterpriseClient from "./EnterpriseClient.ts";
import * as EnterpriseHub from "./EnterpriseHub.ts";
import * as EnterpriseHubClient from "./EnterpriseHubClient.ts";
import * as EnterpriseIngestion from "./EnterpriseIngestion.ts";
import * as EnterpriseStore from "./EnterpriseStore.ts";
import { layerSeededStore } from "./EnterpriseStore.testkit.ts";
import * as RunRecords from "./RunRecords.ts";
import { EnterpriseSession } from "./EnterpriseSession.ts";

const environmentId = EnvironmentId.make("shared-enterprise-host");
const layer = EnterpriseHubClient.layer.pipe(
  Layer.provide(Layer.mock(EnterpriseIngestion.EnterpriseIngestion)({})),
  Layer.provide(
    Layer.succeed(ServerEnvironment.ServerEnvironment, {
      getEnvironmentId: Effect.succeed(environmentId),
      getDescriptor: Effect.die("unused"),
    }),
  ),
  Layer.provide(EnterpriseHub.layer),
  Layer.provide(TeamPublication.layer),
  Layer.provide(RunRecords.layer),
  Layer.provide(layerKnowledge),
  Layer.provideMerge(layerSeededStore),
  Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-shared-enterprise-" })),
  Layer.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer, SecureRandom.layerWebCrypto)),
);

it.effect(
  "signs paired clients into the configured enterprise independently without a hub URL",
  () =>
    Effect.gen(function* () {
      const client = yield* EnterpriseClient.EnterpriseClient;
      const store = yield* EnterpriseStore.EnterpriseStore;
      const as = <A, E, R>(id: string, effect: Effect.Effect<A, E, R>) =>
        effect.pipe(Effect.provideService(EnterpriseSession, AuthSessionId.make(id)));
      const login = (email: string) => client.connect({ email, token: "ACME-BANK-DEV-2026" });
      expect(yield* as("jero", client.status)).toEqual({ configured: true, identity: null });
      expect(yield* as("jero", login("jeronimo.deli@gmail.com"))).toMatchObject({
        email: "jeronimo.deli@gmail.com",
        displayName: "Jero",
        hubEnvironmentId: environmentId,
      });
      expect(yield* as("pablo", login("ent.test.pablo@gmail.com"))).toMatchObject({
        email: "ent.test.pablo@gmail.com",
        displayName: "Pablo",
        teamName: "Platform",
      });
      expect((yield* as("jero", client.status)).identity?.email).toBe("jeronimo.deli@gmail.com");
      expect((yield* as("pablo", client.status)).identity?.email).toBe("ent.test.pablo@gmail.com");
      expect(yield* as("anonymous", client.status)).toEqual({ configured: true, identity: null });
      const denied = yield* as("pablo", client.listMembers.pipe(Effect.result));
      expect(Result.isFailure(denied) && denied.failure.code).toBe("admin_required");
      const wrongToken = yield* as(
        "jero",
        client.connect({ email: "ent.test.pablo@gmail.com", token: "wrong" }).pipe(Effect.result),
      );
      expect(Result.isFailure(wrongToken) && wrongToken.failure).toMatchObject({
        code: "invalid_token",
      });
      expect((yield* as("jero", client.status)).identity?.email).toBe("jeronimo.deli@gmail.com");
      yield* as("pablo", client.disconnect);
      expect((yield* as("pablo", client.status)).identity).toBeNull();
      expect((yield* as("jero", client.status)).identity?.email).toBe("jeronimo.deli@gmail.com");
      yield* store.revokeMember("jeronimo.deli@gmail.com");
      const revoked = yield* as("jero", client.status.pipe(Effect.result));
      expect(Result.isFailure(revoked) && revoked.failure.code).toBe("not_authorized");
    }).pipe(Effect.provide(layer)),
);
