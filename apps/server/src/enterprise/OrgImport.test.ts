import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it, describe } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as SecureRandom from "effect/crypto/SecureRandom";

import * as ServerConfig from "../config.ts";
import { layerKnowledge } from "../knowledge/KnowledgeRepo.testkit.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import { acmeSeedPath } from "./EnterpriseStore.testkit.ts";
import * as EnterpriseHub from "./EnterpriseHub.ts";
import * as EnterpriseStore from "./EnterpriseStore.ts";
import * as OrgImport from "./OrgImport.ts";

const JERO = "jeronimo.deli@gmail.com";
const ANA = "ent.test.ana@gmail.com";
const fixturePath = (name: string) => new URL(`./fixtures/${name}`, import.meta.url).pathname;

// Only the admin exists, so the import alone must rebuild the Acme org.
const layerAdminOnly = Layer.effectDiscard(
  Effect.gen(function* () {
    const store = yield* EnterpriseStore.EnterpriseStore;
    yield* store.seed({
      enterprise: { name: "Acme Bank", token: "ACME-BANK-DEV-2026" },
      teams: [{ id: "platform", name: "Platform" }],
      members: [{ email: JERO, displayName: "Jero", teamId: "platform", role: "admin" }],
    });
  }),
).pipe(Layer.provideMerge(EnterpriseStore.layer), Layer.provideMerge(Sqlite.layerMemory));

const layer = EnterpriseHub.layer.pipe(
  Layer.provideMerge(layerKnowledge),
  Layer.provideMerge(layerAdminOnly),
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-org-import-" })),
  Layer.provideMerge(
    Layer.mergeAll(NodeServices.layer, NodeCrypto.layer, SecureRandom.layerWebCrypto),
  ),
);

const hubAsAdmin = Effect.gen(function* () {
  const hub = yield* EnterpriseHub.EnterpriseHub;
  yield* hub.enroll("jero", { email: JERO });
  return hub;
});

const loadAcme = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  return {
    organization: yield* fs.readFileString(fixturePath("acme-bank.organization.yaml")),
    areas: yield* fs.readFileString(fixturePath("acme-bank.areas.yaml")),
  };
}).pipe(Effect.orDie);

const codeOf = <A>(effect: Effect.Effect<A, { readonly code: string }>) =>
  Effect.map(Effect.result(effect), (result) =>
    Result.isFailure(result) ? result.failure.code : "ok",
  );

const snapshot = Effect.gen(function* () {
  const store = yield* EnterpriseStore.EnterpriseStore;
  return {
    teams: (yield* store.listTeams).map(({ id, name, description }) => ({ id, name, description })),
    members: (yield* store.listMembers).map(({ authorizedAt: _, ...member }) => member),
  };
});

describe("OrgImport", () => {
  it.effect("importing the Acme files reproduces the seed's teams, members and leads", () =>
    Effect.gen(function* () {
      const hub = yield* hubAsAdmin;
      const acme = yield* loadAcme;
      const store = yield* EnterpriseStore.EnterpriseStore;
      const seed = yield* EnterpriseStore.loadSeedFile(acmeSeedPath);

      const preview = yield* hub.orgImport("jero", acme, false);
      expect(preview.applied).toBe(false);
      expect(preview.changes.filter((c) => c.change === "added")).toHaveLength(4 + 19);
      expect(yield* store.listMembers).toHaveLength(1);

      const applied = yield* hub.orgImport("jero", acme, true);
      expect(applied.applied).toBe(true);
      expect(applied.changes).toEqual(preview.changes);

      const teams = yield* store.listTeams;
      expect(teams.map((t) => t.id).toSorted()).toEqual(seed.teams.map((t) => t.id).toSorted());
      const members = yield* store.listMembers;
      expect(
        members.map((m) => ({
          email: m.email,
          displayName: m.displayName,
          teamId: m.teamId,
          role: m.role,
        })),
      ).toEqual(seed.members.toSorted((a, b) => a.email.localeCompare(b.email)));
      expect(members.find((m) => m.email === "ent.test.bruno@gmail.com")?.reportsTo).toBe(ANA);
      expect(members.find((m) => m.email === ANA)?.reportsTo).toBe(JERO);

      const before = yield* snapshot;
      const again = yield* hub.orgImport("jero", acme, true);
      expect(again.changes).toEqual([]);
      expect(yield* snapshot).toEqual(before);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("invalid files return typed errors and change nothing", () =>
    Effect.gen(function* () {
      const hub = yield* hubAsAdmin;
      const acme = yield* loadAcme;
      yield* hub.orgImport("jero", acme, true);
      const before = yield* snapshot;
      const org = acme.organization;
      const cases: ReadonlyArray<[string, { organization: string; areas: string }]> = [
        ["org_invalid_yaml", { ...acme, organization: "people: [\n  - email: {" }],
        ["org_invalid", { ...acme, organization: "people:\n  - name: Nobody\n" }],
        ["org_unknown_area", { ...acme, organization: org.replace("area: risk", "area: mars") }],
        [
          "org_duplicate_lead",
          {
            ...acme,
            organization: org.replace(
              "name: Bruno\n    area: ledger\n    role: member",
              "name: Bruno\n    area: ledger\n    role: lead",
            ),
          },
        ],
        [
          "org_reports_to_cycle",
          {
            ...acme,
            organization: org.replace(
              "name: Jero\n    area: platform\n    role: admin\n",
              "name: Jero\n    area: platform\n    role: admin\n    reportsTo: ent.test.bruno@gmail.com\n",
            ),
          },
        ],
        [
          "org_duplicate_email",
          {
            ...acme,
            organization: org.replace("ent.test.carla@gmail.com", "ENT.test.bruno@gmail.com"),
          },
        ],
        [
          "org_unknown_person",
          { ...acme, organization: org.replace(`reportsTo: ${ANA}`, "reportsTo: ghost@x.com") },
        ],
        ["org_invalid", { ...acme, areas: `${acme.areas}  - id: platform\n    name: Twice\n` }],
        ["org_invalid", { ...acme, areas: "areas:\n  - id: general\n    name: General\n" }],
        // The importing admin cannot drop or demote themselves.
        ["org_invalid", { ...acme, organization: org.replace("role: admin", "role: member") }],
      ];
      for (const [code, input] of cases) {
        expect([code, yield* codeOf(hub.orgImport("jero", input, true))]).toEqual([code, code]);
        expect(yield* codeOf(hub.orgImport("jero", input, false))).toBe(code);
      }
      expect(yield* snapshot).toEqual(before);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("non-admins can neither preview nor apply", () =>
    Effect.gen(function* () {
      const hub = yield* hubAsAdmin;
      const acme = yield* loadAcme;
      yield* hub.orgImport("jero", acme, true);
      yield* hub.enroll("ana", { email: ANA });
      expect(yield* codeOf(hub.orgImport("ana", acme, false))).toBe("admin_required");
      expect(yield* codeOf(hub.orgImport("ana", acme, true))).toBe("admin_required");
      expect(yield* codeOf(hub.orgImport("nobody", acme, false))).toBe("not_connected");
    }).pipe(Effect.provide(layer)),
  );

  it.effect("a changed file moves, renames and revokes, and lists each change", () =>
    Effect.gen(function* () {
      const hub = yield* hubAsAdmin;
      const acme = yield* loadAcme;
      const store = yield* EnterpriseStore.EnterpriseStore;
      yield* hub.orgImport("jero", acme, true);
      const organization = acme.organization
        .replace(/  - email: ent\.test\.sofi@gmail\.com\n(    .*\n)+/, "")
        .replace("name: Hugo\n    area: frontend", "name: Hugo\n    area: ledger")
        .replace(
          `name: Hugo\n    area: ledger\n    role: member\n    reportsTo: ent.test.gerry@gmail.com`,
          `name: Hugo\n    area: ledger\n    role: member\n    reportsTo: ${ANA}`,
        );
      const areas = acme.areas.replace(
        "name: Risk",
        "name: Risk & Compliance\n    description: Fraud and credit risk.",
      );
      const result = yield* hub.orgImport("jero", { organization, areas }, true);
      expect(result.changes).toEqual([
        {
          kind: "area",
          change: "changed",
          id: "risk",
          name: "Risk & Compliance",
          fields: ["name", "description"],
        },
        {
          kind: "person",
          change: "changed",
          id: "ent.test.hugo@gmail.com",
          name: "Hugo",
          fields: ["area", "reportsTo"],
        },
        {
          kind: "person",
          change: "removed",
          id: "ent.test.sofi@gmail.com",
          name: "Sofi",
          fields: [],
        },
      ]);
      expect(yield* store.canEnter("ent.test.sofi@gmail.com")).toBe(false);
      expect((yield* store.getMember("ent.test.hugo@gmail.com"))?.teamId).toBe("ledger");
      // Re-adding a revoked person brings them back.
      const back = yield* hub.orgImport("jero", acme, true);
      expect(back.changes.find((c) => c.id === "ent.test.sofi@gmail.com")?.change).toBe("added");
      expect(yield* store.canEnter("ent.test.sofi@gmail.com")).toBe(true);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("the org chart shows each area's lead and reports-to without emails", () =>
    Effect.gen(function* () {
      const hub = yield* hubAsAdmin;
      const acme = yield* loadAcme;
      yield* hub.orgImport("jero", acme, true);
      const org = yield* hub.org("jero");
      const ledger = org.teams.find((t) => t.id === "ledger");
      const ana = ledger?.members.find((m) => m.displayName === "Ana");
      const bruno = ledger?.members.find((m) => m.displayName === "Bruno");
      expect(ledger?.lead).toEqual({ memberKey: ana?.memberKey, displayName: "Ana" });
      expect(bruno?.reportsTo).toBe(ana?.memberKey);
      const jero = org.teams.flatMap((t) => t.members).find((m) => m.displayName === "Jero");
      expect(ana?.reportsTo).toBe(jero?.memberKey);
      expect(jero?.reportsTo).toBeNull();
      expect(JSON.stringify(org)).not.toContain("@");
    }).pipe(Effect.provide(layer)),
  );

  it.effect("the downloadable templates are themselves a valid import", () =>
    Effect.gen(function* () {
      const plan = yield* OrgImport.parse(OrgImport.template);
      expect(plan.areas.map((area) => area.id)).toEqual(["payments", "risk"]);
      expect(plan.people.find((person) => person.role === "lead")?.reportsTo).toBe(
        "maria@example.com",
      );
    }),
  );
});
