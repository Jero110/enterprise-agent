import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { expect, it, describe } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Exit from "effect/Exit";
import * as SecureRandom from "effect/crypto/SecureRandom";

import { PREAUTHORIZED_ADMIN_EMAIL } from "@t3tools/contracts";

import * as AreaKnowledge from "./AreaKnowledge.ts";
import * as TeamIdentity from "../auth/TeamIdentity.ts";
import { layerSeededStore } from "../enterprise/EnterpriseStore.testkit.ts";
import * as ServerConfig from "../config.ts";

const baseLayer = Layer.mergeAll(NodeServices.layer, NodeCrypto.layer, SecureRandom.layerWebCrypto);

const layerServerConfig = (overrides?: Partial<ServerConfig.ServerConfig["Service"]>) =>
  Layer.effect(
    ServerConfig.ServerConfig,
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      return {
        ...config,
        ...overrides,
      } satisfies ServerConfig.ServerConfig["Service"];
    }),
  ).pipe(
    Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-area-knowledge-test-" })),
    Layer.provide(baseLayer),
  );

const layerAreaKnowledge = (overrides?: Partial<ServerConfig.ServerConfig["Service"]>) =>
  AreaKnowledge.layer.pipe(
    Layer.provideMerge(TeamIdentity.layer),
    Layer.provideMerge(layerSeededStore),
    Layer.provideMerge(layerServerConfig(overrides)),
    Layer.provideMerge(baseLayer),
  );

describe("AreaKnowledge", () => {
  describe("listDocuments", () => {
    it.effect("admin sees general + every team document", () =>
      Effect.gen(function* () {
        const knowledge = yield* AreaKnowledge.AreaKnowledge;
        const identity = yield* TeamIdentity.TeamIdentity;

        const adminIdentity = yield* identity.verifyGoogleToken({
          token: TeamIdentity.createFakeGoogleToken({
            email: PREAUTHORIZED_ADMIN_EMAIL,
            sub: "google-jero",
            name: "Jero",
          }),
        });

        const principal = yield* knowledge.getPrincipal(adminIdentity);
        const docs = yield* knowledge.listDocuments(principal);

        const areaIds = docs.map((d) => d.areaId);
        expect(areaIds).toEqual(["general", "ledger", "frontend"]);
      }).pipe(Effect.provide(layerAreaKnowledge())),
    );

    it.effect("anonymous dev sees only general documents", () =>
      Effect.gen(function* () {
        const knowledge = yield* AreaKnowledge.AreaKnowledge;
        const identity = yield* TeamIdentity.TeamIdentity;

        const anonIdentity = yield* identity.getAnonymousDevIdentity();
        const principal = yield* knowledge.getPrincipal(anonIdentity);
        const docs = yield* knowledge.listDocuments(principal);

        const areaIds = docs.map((d) => d.areaId);
        expect(areaIds).toEqual(["general"]);
      }).pipe(Effect.provide(layerAreaKnowledge({ devUrl: new URL("http://localhost:5173") }))),
    );
  });

  describe("readDocument", () => {
    it.effect("admin can read any team document", () =>
      Effect.gen(function* () {
        const knowledge = yield* AreaKnowledge.AreaKnowledge;
        const identity = yield* TeamIdentity.TeamIdentity;

        const adminIdentity = yield* identity.verifyGoogleToken({
          token: TeamIdentity.createFakeGoogleToken({
            email: PREAUTHORIZED_ADMIN_EMAIL,
            sub: "google-jero",
            name: "Jero",
          }),
        });

        const principal = yield* knowledge.getPrincipal(adminIdentity);
        const doc = yield* knowledge.readDocument(principal, "doc-ledger");

        expect(doc.areaId).toBe("ledger");
        expect(doc.content).toContain("Ledger");
      }).pipe(Effect.provide(layerAreaKnowledge())),
    );

    it.effect("a member cannot read another team's document", () =>
      Effect.gen(function* () {
        const knowledge = yield* AreaKnowledge.AreaKnowledge;
        const identity = yield* TeamIdentity.TeamIdentity;

        const adminIdentity = yield* identity.verifyGoogleToken({
          token: TeamIdentity.createFakeGoogleToken({
            email: "ent.test.ana@gmail.com",
            sub: "google-ana",
            name: "Ana",
          }),
        });

        const principal = yield* knowledge.getPrincipal(adminIdentity);
        const result = yield* knowledge.readDocument(principal, "doc-frontend").pipe(Effect.exit);

        expect(Exit.isFailure(result)).toBe(true);
      }).pipe(Effect.provide(layerAreaKnowledge())),
    );

    it.effect("anonymous dev cannot read a team document even by direct id", () =>
      Effect.gen(function* () {
        const knowledge = yield* AreaKnowledge.AreaKnowledge;
        const identity = yield* TeamIdentity.TeamIdentity;

        const anonIdentity = yield* identity.getAnonymousDevIdentity();
        const principal = yield* knowledge.getPrincipal(anonIdentity);
        const result = yield* knowledge.readDocument(principal, "doc-ledger").pipe(Effect.exit);

        expect(Exit.isFailure(result)).toBe(true);
      }).pipe(Effect.provide(layerAreaKnowledge({ devUrl: new URL("http://localhost:5173") }))),
    );

    it.effect("unauthorized email cannot read any restricted document", () =>
      Effect.gen(function* () {
        const knowledge = yield* AreaKnowledge.AreaKnowledge;
        const identity = yield* TeamIdentity.TeamIdentity;

        const unknownIdentity = yield* identity.verifyGoogleToken({
          token: TeamIdentity.createFakeGoogleToken({
            email: "unknown@example.com",
            sub: "google-unknown",
            name: "Unknown",
          }),
        });

        const principal = yield* knowledge.getPrincipal(unknownIdentity);

        const authResult = yield* knowledge.readDocument(principal, "doc-ledger").pipe(Effect.exit);
        const noMailResult = yield* knowledge
          .readDocument(principal, "doc-no-mail")
          .pipe(Effect.exit);

        expect(Exit.isFailure(authResult)).toBe(true);
        expect(Exit.isFailure(noMailResult)).toBe(true);
      }).pipe(Effect.provide(layerAreaKnowledge())),
    );

    it.effect("forged document id is rejected", () =>
      Effect.gen(function* () {
        const knowledge = yield* AreaKnowledge.AreaKnowledge;
        const identity = yield* TeamIdentity.TeamIdentity;

        const adminIdentity = yield* identity.verifyGoogleToken({
          token: TeamIdentity.createFakeGoogleToken({
            email: PREAUTHORIZED_ADMIN_EMAIL,
            sub: "google-jero",
            name: "Jero",
          }),
        });

        const principal = yield* knowledge.getPrincipal(adminIdentity);
        const result = yield* knowledge.readDocument(principal, "forged-doc-id").pipe(Effect.exit);

        expect(Exit.isFailure(result)).toBe(true);
      }).pipe(Effect.provide(layerAreaKnowledge())),
    );
  });

  describe("area requests", () => {
    it.effect("user can request area access", () =>
      Effect.gen(function* () {
        const knowledge = yield* AreaKnowledge.AreaKnowledge;
        const identity = yield* TeamIdentity.TeamIdentity;

        const userIdentity = yield* identity.verifyGoogleToken({
          token: TeamIdentity.createFakeGoogleToken({
            email: "ent.test.gerry@gmail.com",
            sub: "google-user",
            name: "User",
          }),
        });

        const principal = yield* knowledge.getPrincipal(userIdentity);
        const request = yield* knowledge.requestAreaAccess(principal, "ledger");

        expect(request.status).toBe("pending");
        expect(request.areaId).toBe("ledger");
      }).pipe(Effect.provide(layerAreaKnowledge())),
    );

    it.effect("pending request does not grant access", () =>
      Effect.gen(function* () {
        const knowledge = yield* AreaKnowledge.AreaKnowledge;
        const identity = yield* TeamIdentity.TeamIdentity;

        const userIdentity = yield* identity.verifyGoogleToken({
          token: TeamIdentity.createFakeGoogleToken({
            email: "ent.test.gerry@gmail.com",
            sub: "google-user",
            name: "User",
          }),
        });

        const principal = yield* knowledge.getPrincipal(userIdentity);
        yield* knowledge.requestAreaAccess(principal, "ledger");

        const result = yield* knowledge.readDocument(principal, "doc-ledger").pipe(Effect.exit);
        expect(Exit.isFailure(result)).toBe(true);
      }).pipe(Effect.provide(layerAreaKnowledge())),
    );

    it.effect("admin can approve request", () =>
      Effect.gen(function* () {
        const knowledge = yield* AreaKnowledge.AreaKnowledge;
        const identity = yield* TeamIdentity.TeamIdentity;

        const userIdentity = yield* identity.verifyGoogleToken({
          token: TeamIdentity.createFakeGoogleToken({
            email: "ent.test.gerry@gmail.com",
            sub: "google-user",
            name: "User",
          }),
        });

        const adminIdentity = yield* identity.verifyGoogleToken({
          token: TeamIdentity.createFakeGoogleToken({
            email: PREAUTHORIZED_ADMIN_EMAIL,
            sub: "google-jero",
            name: "Jero",
          }),
        });

        const userPrincipal = yield* knowledge.getPrincipal(userIdentity);
        const request = yield* knowledge.requestAreaAccess(userPrincipal, "ledger");

        const adminPrincipal = yield* knowledge.getPrincipal(adminIdentity);
        yield* knowledge.resolveRequest(adminPrincipal, request.id, "approved");

        const updatedPrincipal = yield* knowledge.getPrincipal(userIdentity);
        const doc = yield* knowledge.readDocument(updatedPrincipal, "doc-ledger");

        expect(doc.areaId).toBe("ledger");
      }).pipe(Effect.provide(layerAreaKnowledge())),
    );

    it.effect("non-admin cannot approve request", () =>
      Effect.gen(function* () {
        const knowledge = yield* AreaKnowledge.AreaKnowledge;
        const identity = yield* TeamIdentity.TeamIdentity;

        const user1Identity = yield* identity.verifyGoogleToken({
          token: TeamIdentity.createFakeGoogleToken({
            email: "ent.test.gerry@gmail.com",
            sub: "google-user1",
            name: "User 1",
          }),
        });

        const user2Identity = yield* identity.verifyGoogleToken({
          token: TeamIdentity.createFakeGoogleToken({
            email: "ent.test.hugo@gmail.com",
            sub: "google-user2",
            name: "User 2",
          }),
        });

        const user1Principal = yield* knowledge.getPrincipal(user1Identity);
        const request = yield* knowledge.requestAreaAccess(user1Principal, "ledger");

        const user2Principal = yield* knowledge.getPrincipal(user2Identity);
        const result = yield* knowledge
          .resolveRequest(user2Principal, request.id, "approved")
          .pipe(Effect.exit);

        expect(Exit.isFailure(result)).toBe(true);
      }).pipe(Effect.provide(layerAreaKnowledge())),
    );

    it.effect("revocation removes access immediately", () =>
      Effect.gen(function* () {
        const knowledge = yield* AreaKnowledge.AreaKnowledge;
        const identity = yield* TeamIdentity.TeamIdentity;

        const userIdentity = yield* identity.verifyGoogleToken({
          token: TeamIdentity.createFakeGoogleToken({
            email: "ent.test.gerry@gmail.com",
            sub: "google-user",
            name: "User",
          }),
        });

        const adminIdentity = yield* identity.verifyGoogleToken({
          token: TeamIdentity.createFakeGoogleToken({
            email: PREAUTHORIZED_ADMIN_EMAIL,
            sub: "google-jero",
            name: "Jero",
          }),
        });

        const userPrincipal = yield* knowledge.getPrincipal(userIdentity);
        const request = yield* knowledge.requestAreaAccess(userPrincipal, "ledger");

        const adminPrincipal = yield* knowledge.getPrincipal(adminIdentity);
        yield* knowledge.resolveRequest(adminPrincipal, request.id, "approved");

        const grantedPrincipal = yield* knowledge.getPrincipal(userIdentity);
        const doc = yield* knowledge.readDocument(grantedPrincipal, "doc-ledger");
        expect(doc.areaId).toBe("ledger");

        yield* knowledge.revokeAreaAccess(adminPrincipal, "ent.test.gerry@gmail.com", "ledger");

        const revokedPrincipal = yield* knowledge.getPrincipal(userIdentity);
        const result = yield* knowledge
          .readDocument(revokedPrincipal, "doc-ledger")
          .pipe(Effect.exit);
        expect(Exit.isFailure(result)).toBe(true);
      }).pipe(Effect.provide(layerAreaKnowledge())),
    );
  });
});
