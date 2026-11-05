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
import * as ProcessRunner from "../processRunner.ts";
import * as KnowledgeRepo from "./KnowledgeRepo.ts";

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
    Layer.provideMerge(KnowledgeRepo.layer),
    Layer.provideMerge(ProcessRunner.layer),
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
        expect(areaIds).toEqual(["general", "accounts", "frontend", "ledger", "platform", "risk"]);
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
        const doc = yield* knowledge.readDocument(principal, "areas/ledger/README.md");

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
        const result = yield* knowledge
          .readDocument(principal, "areas/frontend/README.md")
          .pipe(Effect.exit);

        expect(Exit.isFailure(result)).toBe(true);
      }).pipe(Effect.provide(layerAreaKnowledge())),
    );

    it.effect("anonymous dev cannot read a team document even by direct id", () =>
      Effect.gen(function* () {
        const knowledge = yield* AreaKnowledge.AreaKnowledge;
        const identity = yield* TeamIdentity.TeamIdentity;

        const anonIdentity = yield* identity.getAnonymousDevIdentity();
        const principal = yield* knowledge.getPrincipal(anonIdentity);
        const result = yield* knowledge
          .readDocument(principal, "areas/ledger/README.md")
          .pipe(Effect.exit);

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

        const authResult = yield* knowledge
          .readDocument(principal, "areas/ledger/README.md")
          .pipe(Effect.exit);
        const noMailResult = yield* knowledge
          .readDocument(principal, "global/no-mail.md")
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

        const result = yield* knowledge
          .readDocument(principal, "areas/ledger/README.md")
          .pipe(Effect.exit);
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
        const doc = yield* knowledge.readDocument(updatedPrincipal, "areas/ledger/README.md");

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
        const doc = yield* knowledge.readDocument(grantedPrincipal, "areas/ledger/README.md");
        expect(doc.areaId).toBe("ledger");

        yield* knowledge.revokeAreaAccess(adminPrincipal, "ent.test.gerry@gmail.com", "ledger");

        const revokedPrincipal = yield* knowledge.getPrincipal(userIdentity);
        const result = yield* knowledge
          .readDocument(revokedPrincipal, "areas/ledger/README.md")
          .pipe(Effect.exit);
        expect(Exit.isFailure(result)).toBe(true);
      }).pipe(Effect.provide(layerAreaKnowledge())),
    );
  });

  describe("enterprise knowledge repo", () => {
    const ANA = "ent.test.ana@gmail.com";
    const GERRY = "ent.test.gerry@gmail.com";

    it.effect("the repo is a git repo with a starter commit, global/ and a README per team", () =>
      Effect.gen(function* () {
        const knowledge = yield* AreaKnowledge.AreaKnowledge;
        const config = yield* ServerConfig.ServerConfig;
        const runner = yield* ProcessRunner.ProcessRunner;
        const admin = yield* knowledge.getMemberPrincipal(PREAUTHORIZED_ADMIN_EMAIL);
        const ids = (yield* knowledge.listDocuments(admin!)).map((doc) => doc.id);
        expect(ids).toEqual([
          "global/overview.md",
          "areas/accounts/README.md",
          "areas/frontend/README.md",
          "areas/ledger/README.md",
          "areas/platform/README.md",
          "areas/risk/README.md",
        ]);
        const log = yield* runner.run({
          command: "git",
          args: ["log", "--format=%s"],
          cwd: `${config.baseDir}/enterprise/knowledge`,
        });
        expect(log.stdout.trim()).toBe("chore(knowledge): starter set");
      }).pipe(Effect.provide(layerAreaKnowledge())),
    );

    it.effect("Ana (Ledger) lists, searches and gets only global/ and areas/ledger/", () =>
      Effect.gen(function* () {
        const knowledge = yield* AreaKnowledge.AreaKnowledge;
        const ana = (yield* knowledge.getMemberPrincipal(ANA))!;
        expect((yield* knowledge.listDocuments(ana)).map((doc) => doc.id)).toEqual([
          "global/overview.md",
          "areas/ledger/README.md",
        ]);
        const hits = yield* knowledge.searchDocuments(ana, "frontend");
        // The overview names the frontend service; Frontend's own README stays out.
        expect(hits.map((hit) => hit.id)).toEqual(["global/overview.md"]);
        expect(
          (yield* knowledge.searchDocuments(ana, "ledgerwriter")).map((hit) => hit.id),
        ).toEqual(["areas/ledger/README.md", "global/overview.md"]);
        expect((yield* knowledge.readDocument(ana, "areas/ledger/README.md")).areaId).toBe(
          "ledger",
        );
        const denied = yield* knowledge
          .readDocument(ana, "areas/frontend/README.md")
          .pipe(Effect.flip);
        expect(denied.code).toBe("access_denied");
      }).pipe(Effect.provide(layerAreaKnowledge())),
    );

    it.effect("search matches headings and paths, not only the body", () =>
      Effect.gen(function* () {
        const knowledge = yield* AreaKnowledge.AreaKnowledge;
        const admin = (yield* knowledge.getMemberPrincipal(PREAUTHORIZED_ADMIN_EMAIL))!;
        expect((yield* knowledge.searchDocuments(admin, "Teams"))[0]?.id).toBe(
          "global/overview.md",
        );
        expect((yield* knowledge.searchDocuments(admin, "areas/risk"))[0]?.id).toBe(
          "areas/risk/README.md",
        );
        expect(yield* knowledge.searchDocuments(admin, "nothing-like-this")).toEqual([]);
      }).pipe(Effect.provide(layerAreaKnowledge())),
    );

    it.effect(
      "an approved grant makes Ledger readable for Gerry and a revoke removes it at once",
      () =>
        Effect.gen(function* () {
          const knowledge = yield* AreaKnowledge.AreaKnowledge;
          const admin = (yield* knowledge.getMemberPrincipal(PREAUTHORIZED_ADMIN_EMAIL))!;
          const canRead = Effect.gen(function* () {
            const gerry = (yield* knowledge.getMemberPrincipal(GERRY))!;
            return (yield* knowledge.listDocuments(gerry)).some(
              (doc) => doc.id === "areas/ledger/README.md",
            );
          });
          expect(yield* canRead).toBe(false);
          const request = yield* knowledge.requestAreaAccess(
            (yield* knowledge.getMemberPrincipal(GERRY))!,
            "ledger",
          );
          expect(yield* canRead).toBe(false);
          yield* knowledge.resolveRequest(admin, request.id, "approved");
          expect(yield* canRead).toBe(true);
          yield* knowledge.revokeAreaAccess(admin, GERRY, "ledger");
          expect(yield* canRead).toBe(false);
        }).pipe(Effect.provide(layerAreaKnowledge())),
    );
  });
});
