import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { AuthSessionId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SecureRandom from "effect/crypto/SecureRandom";

import * as ServerConfig from "../config.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as EnterpriseClient from "./EnterpriseClient.ts";
import * as EnterpriseStore from "./EnterpriseStore.ts";
import * as EnterpriseThreadAuthor from "./EnterpriseThreadAuthor.ts";
import { acmeSeedPath } from "./EnterpriseStore.testkit.ts";

const layer = EnterpriseThreadAuthor.layer.pipe(
  Layer.provideMerge(EnterpriseStore.layerHub),
  Layer.provide(
    Layer.effect(
      ServerConfig.ServerConfig,
      Effect.map(ServerConfig.ServerConfig, (config) => ({
        ...config,
        enterpriseHub: true,
        enterpriseSeedPath: acmeSeedPath,
      })),
    ).pipe(Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-thread-author-" }))),
  ),
  Layer.provide(
    Layer.mock(EnterpriseClient.EnterpriseClient)({
      status: Effect.die("The hub must resolve its own authors."),
    }),
  ),
  Layer.provide(Sqlite.layerMemory),
  Layer.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer, SecureRandom.layerWebCrypto)),
);

it.effect(
  "resolves existing logged-in members and keeps author identity separate across sessions",
  () =>
    Effect.gen(function* () {
      const author = yield* EnterpriseThreadAuthor.EnterpriseThreadAuthor;
      const store = yield* EnterpriseStore.EnterpriseStore;
      const ana = {
        sessionId: AuthSessionId.make("session-ana"),
        subject: "cli-issued-session",
        client: { deviceType: "desktop" as const, label: "Enterprise · ent.test.ana@gmail.com" },
      };
      const bruno = {
        ...ana,
        sessionId: AuthSessionId.make("session-bruno"),
        client: { deviceType: "desktop" as const, label: "Enterprise · ent.test.bruno@gmail.com" },
      };
      expect(yield* author.author(ana)).toEqual({
        email: "ent.test.ana@gmail.com",
        displayName: "Ana",
      });
      expect(yield* author.author(bruno)).toEqual({
        email: "ent.test.bruno@gmail.com",
        displayName: "Bruno",
      });
      expect(yield* author.author({ ...ana, subject: "paired-client" })).toBeNull();
      expect(
        yield* author.author({
          ...ana,
          client: { deviceType: "desktop" as const, label: "My laptop" },
        }),
      ).toBeNull();

      yield* store.enroll({ environmentId: bruno.sessionId, email: "ent.test.bruno@gmail.com" });
      expect(yield* author.author({ ...bruno, client: ana.client })).toEqual({
        email: "ent.test.bruno@gmail.com",
        displayName: "Bruno",
      });
      yield* store.revokeMember("ent.test.ana@gmail.com");
      expect(yield* author.author(ana)).toBeNull();
      expect(yield* author.author(bruno)).toEqual({
        email: "ent.test.bruno@gmail.com",
        displayName: "Bruno",
      });
    }).pipe(Effect.provide(layer)),
);
