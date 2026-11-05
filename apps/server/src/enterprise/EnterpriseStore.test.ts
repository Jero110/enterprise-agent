import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { expect, it, describe } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as SqlClient from "effect/sql/SqlClient";

import * as ServerConfig from "../config.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import { acmeSeedPath } from "./EnterpriseStore.testkit.ts";
import * as EnterpriseStore from "./EnterpriseStore.ts";

const baseLayer = Layer.mergeAll(NodeServices.layer, NodeCrypto.layer, SecureRandom.layerWebCrypto);

const layerMemoryStore = EnterpriseStore.layer.pipe(
  Layer.provideMerge(Sqlite.layerMemory),
  Layer.provideMerge(baseLayer),
);

const layerStoreAt = (dbPath: string) =>
  EnterpriseStore.layer.pipe(
    Layer.provideMerge(Sqlite.layerFromPath(dbPath)),
    Layer.provideMerge(baseLayer),
  );

const seedAcme = Effect.gen(function* () {
  const store = yield* EnterpriseStore.EnterpriseStore;
  yield* store.seed(yield* EnterpriseStore.loadSeedFile(acmeSeedPath));
  return store;
});

describe("EnterpriseStore", () => {
  it.effect("seeding twice yields 20 members, 5 teams, roles and team sizes", () =>
    Effect.gen(function* () {
      const store = yield* seedAcme;
      yield* seedAcme;

      const members = yield* store.listMembers;
      const teams = yield* store.listTeams;
      expect(members).toHaveLength(20);
      expect(teams).toHaveLength(5);

      const sizes = Object.fromEntries(
        teams.map((team) => [team.name, members.filter((m) => m.teamId === team.id).length]),
      );
      expect(sizes).toEqual({ Ledger: 6, Frontend: 5, Accounts: 4, Platform: 3, Risk: 2 });

      const roleOf = (email: string) => members.find((m) => m.email === email)?.role;
      expect(roleOf("jeronimo.deli@gmail.com")).toBe("admin");
      expect(roleOf("ent.test.ana@gmail.com")).toBe("lead");
      expect(roleOf("ent.test.bruno@gmail.com")).toBe("member");
      expect(members.filter((m) => m.role === "lead")).toHaveLength(5);
    }).pipe(Effect.provide(layerMemoryStore)),
  );

  it.effect("reseeding does not undo what an admin changed", () =>
    Effect.gen(function* () {
      const store = yield* seedAcme;
      yield* store.revokeMember("ent.test.bruno@gmail.com");
      yield* store.moveMember("ent.test.ana@gmail.com", "risk");
      yield* seedAcme;

      expect(yield* store.canEnter("ent.test.bruno@gmail.com")).toBe(false);
      expect((yield* store.getMember("ent.test.ana@gmail.com"))?.teamId).toBe("risk");
    }).pipe(Effect.provide(layerMemoryStore)),
  );

  it.effect("enrollment and membership survive a store re-open on the same file", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-enterprise-store-" });
      const dbPath = path.join(dir, "state.sqlite");

      yield* Effect.gen(function* () {
        const store = yield* seedAcme;
        yield* store.moveMember("ent.test.bruno@gmail.com", "frontend");
        yield* store.saveProposal({
          id: "durable-request",
          kind: "area-access",
          scope: "ledger",
          path: "",
          reason: "Need Ledger context",
          evidence: ["thread:gerry/1"],
          proposedBy: "ent.test.gerry@gmail.com",
          createdAt: "2026-01-01T00:00:00.000Z",
          status: "pending",
          baseVersion: "",
          targetVersion: "",
        });
        yield* store.enroll({ environmentId: "env-ana", email: "ent.test.ana@gmail.com" });
        yield* store.grantArea({
          email: "ent.test.gerry@gmail.com",
          areaId: "ledger",
          grantedBy: "jeronimo.deli@gmail.com",
        });
      }).pipe(Effect.provide(layerStoreAt(dbPath)), Effect.scoped);

      yield* Effect.gen(function* () {
        const store = yield* EnterpriseStore.EnterpriseStore;
        expect(yield* store.listMembers).toHaveLength(20);
        expect((yield* store.getMember("ent.test.bruno@gmail.com"))?.teamId).toBe("frontend");
        expect((yield* store.getEnrollment("env-ana"))?.email).toBe("ent.test.ana@gmail.com");
        expect(yield* store.listGrants("ent.test.gerry@gmail.com")).toHaveLength(1);
        expect(yield* store.listProposals).toMatchObject([
          { id: "durable-request", status: "pending", evidence: ["thread:gerry/1"] },
        ]);
        expect(yield* store.verifyToken("ACME-BANK-DEV-2026")).toBe(true);
      }).pipe(Effect.provide(layerStoreAt(dbPath)), Effect.scoped);
    }).pipe(Effect.scoped, Effect.provide(baseLayer)),
  );

  it.effect("revoking an email makes canEnter false at once, and authorizing restores it", () =>
    Effect.gen(function* () {
      const store = yield* seedAcme;
      expect(yield* store.canEnter("ent.test.ana@gmail.com")).toBe(true);
      expect(yield* store.canEnter(" Ent.Test.Ana@gmail.com ")).toBe(true);
      expect(yield* store.canEnter("ent.test.intruso@gmail.com")).toBe(false);

      yield* store.revokeMember("ent.test.ana@gmail.com");
      expect(yield* store.canEnter("ent.test.ana@gmail.com")).toBe(false);

      yield* store.upsertMember({
        email: "ent.test.ana@gmail.com",
        displayName: "Ana",
        teamId: "ledger",
        role: "lead",
        authorizedBy: "jeronimo.deli@gmail.com",
      });
      expect(yield* store.canEnter("ent.test.ana@gmail.com")).toBe(true);
    }).pipe(Effect.provide(layerMemoryStore)),
  );

  it.effect("stores the token hashed; a wrong token never matches", () =>
    Effect.gen(function* () {
      const store = yield* seedAcme;
      const sql = yield* SqlClient.SqlClient;
      const rows = yield* sql<{ token_salt: string; token_hash: string }>`
        SELECT token_salt, token_hash FROM enterprise
      `;
      expect(rows).toHaveLength(1);
      expect(JSON.stringify(rows)).not.toContain("ACME-BANK-DEV-2026");

      expect(yield* store.verifyToken("ACME-BANK-DEV-2026")).toBe(true);
      expect(yield* store.verifyToken("ACME-BANK-DEV-2027")).toBe(false);
      expect(yield* store.verifyToken("")).toBe(false);
      expect(yield* store.verifyToken(rows[0]!.token_hash)).toBe(false);
    }).pipe(Effect.provide(layerMemoryStore)),
  );

  it.effect("the hub layer seeds from the configured T3CODE_ENTERPRISE_SEED file", () =>
    Effect.gen(function* () {
      const store = yield* EnterpriseStore.EnterpriseStore;
      expect(yield* store.listMembers).toHaveLength(20);
    }).pipe(
      Effect.provide(
        EnterpriseStore.layerHub.pipe(
          Layer.provideMerge(Sqlite.layerMemory),
          Layer.provideMerge(
            Layer.effect(
              ServerConfig.ServerConfig,
              Effect.gen(function* () {
                const config = yield* ServerConfig.ServerConfig;
                return { ...config, enterpriseHub: true, enterpriseSeedPath: acmeSeedPath };
              }),
            ).pipe(
              Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-enterprise-" })),
            ),
          ),
          Layer.provideMerge(baseLayer),
        ),
      ),
    ),
  );
});
