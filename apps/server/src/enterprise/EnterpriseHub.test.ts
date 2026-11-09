import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it, describe } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Result from "effect/Result";
import * as SecureRandom from "effect/crypto/SecureRandom";

import * as ServerConfig from "../config.ts";
import { layerKnowledge } from "../knowledge/KnowledgeRepo.testkit.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import { acmeSeedPath, layerSeededStore } from "./EnterpriseStore.testkit.ts";
import * as EnterpriseStore from "./EnterpriseStore.ts";
import * as EnterpriseHub from "./EnterpriseHub.ts";

const TOKEN = "ACME-BANK-DEV-2026";
const ANA = "ent.test.ana@gmail.com";
const JERO = "jeronimo.deli@gmail.com";
const EX = "ent.test.ex@gmail.com";

const layer = EnterpriseHub.layer.pipe(
  Layer.provideMerge(layerKnowledge),
  Layer.provideMerge(layerSeededStore),
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-enterprise-hub-" })),
  Layer.provideMerge(
    Layer.mergeAll(NodeServices.layer, NodeCrypto.layer, SecureRandom.layerWebCrypto),
  ),
);

const codeOf = <A>(effect: Effect.Effect<A, { readonly code: string }>) =>
  Effect.map(Effect.result(effect), (result) =>
    Result.isFailure(result) ? result.failure.code : "ok",
  );

describe("EnterpriseHub", () => {
  it.effect(
    "node access requests reach the area lead and bodies follow approval and revocation",
    () =>
      Effect.gen(function* () {
        const hub = yield* EnterpriseHub.EnterpriseHub;
        const store = yield* EnterpriseStore.EnterpriseStore;
        const riskLead = (yield* store.listMembers).find(
          (member) => member.teamId === "risk" && member.role === "lead",
        )!;
        yield* hub.enroll("ana", { email: ANA, token: TOKEN });
        yield* hub.enroll("risk-lead", { email: riskLead.email, token: TOKEN });
        yield* hub.enroll("unrelated", { email: "ent.test.bruno@gmail.com", token: TOKEN });
        expect(
          (yield* hub.knowledgeGraph("ana")).nodes.find((node) => node.areaId === "risk"),
        ).not.toHaveProperty("content");
        expect(yield* codeOf(hub.knowledgeRequestAccess("ana", { path: "../../risk" }))).toBe(
          "document_not_found",
        );
        const request = yield* hub.knowledgeRequestAccess("ana", { path: "areas/risk/README.md" });
        expect(
          (yield* hub.proposalInbox("risk-lead", {})).proposals.some((p) => p.id === request.id),
        ).toBe(true);
        expect(
          (yield* hub.proposalInbox("unrelated", {})).proposals.some((p) => p.id === request.id),
        ).toBe(false);
        yield* hub.proposalDecide("risk-lead", { id: request.id, action: "approve" });
        expect(
          (yield* hub.knowledgeGraph("ana")).nodes.find((node) => node.areaId === "risk"),
        ).toHaveProperty("content");
        yield* hub.proposalDecide("risk-lead", { id: request.id, action: "revert" });
        expect(
          (yield* hub.knowledgeGraph("ana")).nodes.find((node) => node.areaId === "risk"),
        ).not.toHaveProperty("content");
        expect(yield* codeOf(hub.knowledgeGet("ana", { path: "areas/risk/README.md" }))).toBe(
          "access_denied",
        );
      }).pipe(Effect.provide(layer)),
  );
  it.effect("attributes ingestion proposals only to registered admin threads", () =>
    Effect.gen(function* () {
      const hub = yield* EnterpriseHub.EnterpriseHub;
      const store = yield* EnterpriseStore.EnterpriseStore;
      const proposal = {
        kind: "create",
        scope: "global",
        path: "global/ingestion-test.md",
        content: "# Sources",
        reason: "Map sources",
        evidence: [],
      } as const;
      expect(yield* codeOf(hub.ingestionPropose("unknown", proposal))).toBe("access_denied");
      expect(yield* codeOf(hub.ingestionList("unknown"))).toBe("access_denied");
      yield* store.saveIngestionRun({
        id: "run-1",
        threadId: "thread-1",
        adminEmail: JERO,
        folder: "/source",
        status: "running",
      });
      expect(yield* hub.ingestionList("thread-1")).toHaveProperty("documents");
      const first = yield* hub.ingestionPropose("thread-1", proposal);
      expect(first).toMatchObject({
        proposedBy: JERO,
        evidence: ["ingestion:run-1"],
      });
      yield* store.saveIngestionRun({
        id: "run-repeat",
        threadId: "thread-repeat",
        adminEmail: JERO,
        folder: "/source",
        status: "running",
      });
      const repeated = yield* hub.ingestionPropose("thread-repeat", proposal);
      expect(repeated.id).toBe(first.id);
      expect(
        yield* codeOf(hub.ingestionPropose("thread-repeat", { ...proposal, content: "# Changed" })),
      ).toBe("conflict");
      yield* store.saveIngestionRun({
        id: "run-2",
        threadId: "thread-2",
        adminEmail: ANA,
        folder: "/source",
        status: "running",
      });
      expect(yield* codeOf(hub.ingestionPropose("thread-2", proposal))).toBe("access_denied");
      expect(yield* codeOf(hub.ingestionList("thread-2"))).toBe("access_denied");
      yield* store.saveIngestionRun({
        id: "run-1",
        threadId: "thread-1",
        adminEmail: JERO,
        folder: "/source",
        status: "failed",
      });
      expect(yield* codeOf(hub.ingestionList("thread-1"))).toBe("access_denied");
      expect(yield* codeOf(hub.ingestionPropose("thread-1", proposal))).toBe("access_denied");
    }).pipe(Effect.provide(layer)),
  );

  it.effect("an authorized email with the token binds the session to its member", () =>
    Effect.gen(function* () {
      const hub = yield* EnterpriseHub.EnterpriseHub;
      const identity = yield* hub.enroll("session-ana", { email: ANA, token: TOKEN });
      expect(identity).toMatchObject({
        email: ANA,
        displayName: "Ana",
        teamId: "ledger",
        teamName: "Ledger",
        role: "lead",
      });
      expect(yield* hub.whoami("session-ana")).toEqual(identity);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("rejects an email that was never authorized and a wrong token", () =>
    Effect.gen(function* () {
      const hub = yield* EnterpriseHub.EnterpriseHub;
      expect(
        yield* codeOf(hub.enroll("s1", { email: "ent.test.intruso@gmail.com", token: TOKEN })),
      ).toBe("not_authorized");
      expect(yield* codeOf(hub.enroll("s2", { email: ANA, token: "nope" }))).toBe("invalid_token");
      // A wrong token never reveals whether the email exists.
      expect(
        yield* codeOf(hub.enroll("s3", { email: "ent.test.intruso@gmail.com", token: "nope" })),
      ).toBe("invalid_token");
      expect(yield* codeOf(hub.whoami("s1"))).toBe("not_connected");
    }).pipe(Effect.provide(layer)),
  );

  it.effect("admin authorizes then revokes an email; the member's next call fails", () =>
    Effect.gen(function* () {
      const hub = yield* EnterpriseHub.EnterpriseHub;
      yield* hub.enroll("session-jero", { email: JERO, token: TOKEN });
      expect(yield* codeOf(hub.enroll("session-ex", { email: EX, token: TOKEN }))).toBe(
        "not_authorized",
      );

      yield* hub.authorize("session-jero", {
        email: EX,
        displayName: "Ex",
        teamId: "risk",
        role: "member",
      });
      expect(yield* hub.enroll("session-ex", { email: EX, token: TOKEN })).toMatchObject({
        teamId: "risk",
        role: "member",
      });

      const afterRevoke = yield* hub.revoke("session-jero", { email: EX });
      expect(afterRevoke.members.find((m) => m.email === EX)?.active).toBe(false);
      expect(yield* codeOf(hub.whoami("session-ex"))).toBe("not_authorized");
      expect(yield* codeOf(hub.enroll("session-ex", { email: EX, token: TOKEN }))).toBe(
        "not_authorized",
      );
    }).pipe(Effect.provide(layer)),
  );

  it.effect("admin sets another member's team and role through authorize", () =>
    Effect.gen(function* () {
      const hub = yield* EnterpriseHub.EnterpriseHub;
      yield* hub.enroll("session-jero", { email: JERO, token: TOKEN });
      const listed = yield* hub.authorize("session-jero", {
        email: "ent.test.bruno@gmail.com",
        displayName: "Bruno",
        teamId: "frontend",
        role: "lead",
      });
      expect(listed.members.find((m) => m.email === "ent.test.bruno@gmail.com")).toMatchObject({
        teamId: "frontend",
        role: "lead",
      });
      expect(
        yield* codeOf(
          hub.authorize("session-jero", {
            email: EX,
            displayName: "Ex",
            teamId: "ghost",
            role: "member",
          }),
        ),
      ).toBe("unknown_team");
      yield* hub.enroll("session-ana", { email: ANA, token: TOKEN });
      yield* hub.enroll("session-bruno", {
        email: "ent.test.bruno@gmail.com",
        token: TOKEN,
      });
      const store = yield* EnterpriseStore.EnterpriseStore;
      yield* store.grantArea({ email: ANA, areaId: "frontend", role: "member", grantedBy: JERO });
      const proposal = yield* hub.knowledgePropose("session-ana", {
        kind: "create",
        scope: "frontend",
        path: "areas/frontend/hub-review.md",
        content: "# Review",
        reason: "Cross-team update",
        evidence: [],
      });
      expect(
        yield* codeOf(hub.proposalDecide("session-ana", { id: proposal.id, action: "approve" })),
      ).toBe("access_denied");
      expect((yield* hub.proposalInbox("session-bruno", {})).pendingCount).toBe(1);
      yield* hub.authorize("session-jero", {
        email: "ent.test.bruno@gmail.com",
        displayName: "Bruno",
        teamId: "frontend",
        role: "member",
      });
      expect((yield* hub.proposalInbox("session-bruno", {})).pendingCount).toBe(0);
      expect(
        yield* codeOf(hub.proposalDecide("session-bruno", { id: proposal.id, action: "approve" })),
      ).toBe("access_denied");
      expect(
        (yield* hub.proposalDecide("session-jero", { id: proposal.id, action: "approve" })).status,
      ).toBe("applied");
    }).pipe(Effect.provide(layer)),
  );

  it.effect(
    "any enrolled member reads the org chart with their own access marked, without emails",
    () =>
      Effect.gen(function* () {
        const hub = yield* EnterpriseHub.EnterpriseHub;
        const store = yield* EnterpriseStore.EnterpriseStore;
        expect(yield* codeOf(hub.org("stranger"))).toBe("not_connected");
        yield* hub.enroll("session-ana", { email: ANA, token: TOKEN });
        yield* store.grantArea({ email: ANA, areaId: "frontend", grantedBy: JERO });
        const { teams } = yield* hub.org("session-ana");
        expect(teams.map((team) => [team.id, team.access])).toContainEqual(["ledger", "member"]);
        expect(teams.find((team) => team.id === "frontend")?.access).toBe("granted");
        expect(teams.find((team) => team.id === "risk")?.access).toBe("none");
        const ledger = teams.find((team) => team.id === "ledger");
        expect(ledger?.members).toHaveLength(6);
        expect(ledger?.members.filter((member) => member.isMe)).toEqual([
          {
            memberKey: expect.any(String),
            displayName: "Ana",
            role: "lead",
            isMe: true,
            reportsTo: null,
          },
        ]);
        expect(ledger?.lead?.displayName).toBe("Ana");
        // A lead grant names the lead of an area outside the member's own team.
        yield* store.revokeMember("ent.test.rosa@gmail.com");
        yield* store.grantArea({ email: ANA, areaId: "risk", role: "lead", grantedBy: JERO });
        const risk = (yield* hub.org("session-ana")).teams.find((team) => team.id === "risk");
        expect(risk?.lead?.displayName).toBe("Ana");
        expect(JSON.stringify(teams)).not.toContain("@");
      }).pipe(Effect.provide(layer)),
  );

  it.effect("admin assigns several areas without changing team or review privileges", () =>
    Effect.gen(function* () {
      const hub = yield* EnterpriseHub.EnterpriseHub;
      const store = yield* EnterpriseStore.EnterpriseStore;
      yield* hub.enroll("admin", { email: JERO });
      yield* hub.enroll("member", { email: ANA });
      yield* store.grantArea({ email: ANA, areaId: "frontend", role: "lead", grantedBy: JERO });
      const input = { email: ANA, displayName: "Ana", teamId: "ledger", role: "lead" } as const;
      const assigned = yield* hub.authorize("admin", {
        ...input,
        areaIds: ["frontend", "risk", "risk"],
      });
      expect(assigned.members.find((member) => member.email === ANA)).toMatchObject({
        teamId: "ledger",
        role: "lead",
        areaIds: ["frontend", "risk"],
      });
      expect((yield* store.listGrants(ANA)).map(({ areaId, role }) => ({ areaId, role }))).toEqual([
        { areaId: "frontend", role: "lead" },
        { areaId: "risk", role: "member" },
      ]);
      const paths = (yield* hub.knowledgeList("member")).documents.map((doc) => doc.id);
      expect(paths).toContain("global/overview.md");
      expect(paths).toContain("areas/ledger/README.md");
      expect(paths).toContain("areas/frontend/README.md");
      expect(paths).toContain("areas/risk/README.md");
      expect(yield* codeOf(hub.authorize("member", { ...input, areaIds: [] }))).toBe(
        "admin_required",
      );
      expect(
        yield* codeOf(
          hub.authorize("admin", {
            ...input,
            teamId: "risk",
            areaIds: ["ghost"],
          }),
        ),
      ).toBe("unknown_team");
      expect((yield* hub.whoami("member")).teamId).toBe("ledger");
      yield* hub.authorize("admin", input);
      expect(yield* store.listGrants(ANA)).toHaveLength(2);
      yield* hub.authorize("admin", { ...input, areaIds: [] });
      expect(yield* store.listGrants(ANA)).toEqual([]);
      expect(yield* codeOf(hub.knowledgeGet("member", { path: "areas/risk/README.md" }))).toBe(
        "access_denied",
      );
      expect((yield* hub.knowledgeList("member")).documents.map((doc) => doc.id)).toContain(
        "areas/ledger/README.md",
      );
      yield* hub.revoke("admin", { email: ANA });
      expect(yield* codeOf(hub.knowledgeList("member"))).toBe("not_authorized");
    }).pipe(Effect.provide(layer)),
  );

  it.effect("non-admins cannot call admin methods", () =>
    Effect.gen(function* () {
      const hub = yield* EnterpriseHub.EnterpriseHub;
      yield* hub.enroll("session-ana", { email: ANA, token: TOKEN });
      const input = { email: EX, displayName: "Ex", teamId: null, role: "member" } as const;
      expect(yield* codeOf(hub.listMembers("session-ana"))).toBe("admin_required");
      expect(yield* codeOf(hub.authorize("session-ana", input))).toBe("admin_required");
      expect(yield* codeOf(hub.revoke("session-ana", { email: "ent.test.bruno@gmail.com" }))).toBe(
        "admin_required",
      );
      // An unbound session is not even a member.
      expect(yield* codeOf(hub.listMembers("stranger"))).toBe("not_connected");
    }).pipe(Effect.provide(layer)),
  );

  it.effect("disconnect unbinds the session", () =>
    Effect.gen(function* () {
      const hub = yield* EnterpriseHub.EnterpriseHub;
      yield* hub.enroll("session-ana", { email: ANA, token: TOKEN });
      expect(yield* hub.disconnect("session-ana")).toBe(true);
      expect(yield* codeOf(hub.whoami("session-ana"))).toBe("not_connected");
      expect(yield* hub.disconnect("session-ana")).toBe(false);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("an admin cannot revoke themselves", () =>
    Effect.gen(function* () {
      const hub = yield* EnterpriseHub.EnterpriseHub;
      yield* hub.enroll("session-jero", { email: JERO, token: TOKEN });
      expect(yield* codeOf(hub.revoke("session-jero", { email: JERO }))).toBe("not_authorized");
    }).pipe(Effect.provide(layer)),
  );

  it.effect("a restarted hub keeps members bound without the token", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-enterprise-hub-" });
      const hubAt = EnterpriseHub.layer.pipe(
        Layer.provideMerge(layerKnowledge),
        Layer.provideMerge(EnterpriseStore.layer),
        Layer.provideMerge(
          ServerConfig.layerTest(process.cwd(), { prefix: "t3-enterprise-hub-restart-" }),
        ),
        Layer.provideMerge(Sqlite.layerFromPath(path.join(dir, "state.sqlite"))),
      );

      yield* Effect.gen(function* () {
        const store = yield* EnterpriseStore.EnterpriseStore;
        yield* store.seed(yield* EnterpriseStore.loadSeedFile(acmeSeedPath));
        const hub = yield* EnterpriseHub.EnterpriseHub;
        yield* hub.enroll("session-ana", { email: ANA, token: TOKEN });
      }).pipe(Effect.provide(hubAt), Effect.scoped);

      yield* Effect.gen(function* () {
        const hub = yield* EnterpriseHub.EnterpriseHub;
        expect(yield* hub.whoami("session-ana")).toMatchObject({ email: ANA, role: "lead" });
      }).pipe(Effect.provide(hubAt), Effect.scoped);
    }).pipe(
      Effect.scoped,
      Effect.provide(
        Layer.mergeAll(NodeServices.layer, NodeCrypto.layer, SecureRandom.layerWebCrypto),
      ),
    ),
  );
});
