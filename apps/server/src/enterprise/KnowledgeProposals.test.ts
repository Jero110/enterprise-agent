import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as ServerConfig from "../config.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as KnowledgeRepo from "../knowledge/KnowledgeRepo.ts";
import * as AreaKnowledge from "../knowledge/AreaKnowledge.ts";
import { layerSeededStore } from "./EnterpriseStore.testkit.ts";
import * as EnterpriseStore from "./EnterpriseStore.ts";
import * as KnowledgeProposals from "./KnowledgeProposals.ts";

const ANA = "ent.test.ana@gmail.com";
const BRUNO = "ent.test.bruno@gmail.com";
const GERRY = "ent.test.gerry@gmail.com";
const ADMIN = "jeronimo.deli@gmail.com";
const layer = AreaKnowledge.layer.pipe(
  Layer.provideMerge(KnowledgeProposals.layer),
  Layer.provideMerge(KnowledgeRepo.layer),
  Layer.provideMerge(ProcessRunner.layer),
  Layer.provideMerge(layerSeededStore),
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-proposals-" })),
  Layer.provideMerge(
    Layer.mergeAll(NodeServices.layer, NodeCrypto.layer, SecureRandom.layerWebCrypto),
  ),
);
const codeOf = <A>(effect: Effect.Effect<A, { readonly code: string }>) =>
  Effect.map(Effect.result(effect), (result) =>
    Result.isFailure(result) ? result.failure.code : "ok",
  );
const create = {
  kind: "create",
  scope: "ledger",
  path: "areas/ledger/x.md",
  content: "# Ledger note\nOriginal",
  reason: "Document settlement",
  evidence: ["thread:bruno/1"],
} as const;

describe("KnowledgeProposals", () => {
  it.effect("persists a proposal, scopes the inbox and commits approval with provenance", () =>
    Effect.gen(function* () {
      const proposals = yield* KnowledgeProposals.KnowledgeProposals;
      const repo = yield* KnowledgeRepo.KnowledgeRepo;
      const p = yield* proposals.propose(BRUNO, create);
      expect(p).toMatchObject({ baseContentHash: "absent" });
      expect((yield* proposals.inbox(ANA)).proposals.map((p) => p.id)).toContain(p.id);
      expect((yield* proposals.inbox(GERRY)).proposals).toEqual([]);
      expect(yield* codeOf(proposals.decide(GERRY, { id: p.id, action: "approve" }))).toBe(
        "access_denied",
      );
      const applied = yield* proposals.decide(ANA, { id: p.id, action: "approve" });
      expect(applied.status).toBe("applied");
      expect((yield* repo.documents).find((d) => d.id === create.path)?.content).toBe(
        create.content,
      );
      const config = yield* ServerConfig.ServerConfig;
      const runner = yield* ProcessRunner.ProcessRunner;
      const log = yield* runner.run({
        command: "git",
        args: ["log", "-1", "--format=%B"],
        cwd: `${config.baseDir}/enterprise/knowledge`,
      });
      for (const trailer of [
        `Proposal-Id: ${p.id}`,
        `Proposed-By: ${BRUNO}`,
        `Approved-By: ${ANA}`,
        "Evidence: thread:bruno/1",
      ])
        expect(log.stdout).toContain(trailer);
      expect(
        (yield* (yield* EnterpriseStore.EnterpriseStore).listProposals).find(
          (row) => row.id === p.id,
        )?.status,
      ).toBe("applied");
    }).pipe(Effect.provide(layer)),
  );

  it.effect(
    "requires admin for a move to global, rejects without changes and reverts content",
    () =>
      Effect.gen(function* () {
        const proposals = yield* KnowledgeProposals.KnowledgeProposals;
        const repo = yield* KnowledgeRepo.KnowledgeRepo;
        const p = yield* proposals.propose(BRUNO, create);
        yield* proposals.decide(ANA, { id: p.id, action: "approve" });
        const update = yield* proposals.propose(BRUNO, {
          ...create,
          kind: "update",
          content: "# Changed",
        });
        yield* proposals.decide(ANA, { id: update.id, action: "reject", reason: "Not ready" });
        expect((yield* repo.documents).find((d) => d.id === create.path)?.content).toBe(
          create.content,
        );
        const update2 = yield* proposals.propose(BRUNO, {
          ...create,
          kind: "update",
          content: "# Changed",
        });
        yield* proposals.decide(ANA, { id: update2.id, action: "approve" });
        expect((yield* proposals.decide(ANA, { id: update2.id, action: "revert" })).status).toBe(
          "reverted",
        );
        expect((yield* repo.documents).find((d) => d.id === create.path)?.content).toBe(
          create.content,
        );
        const deletion = yield* proposals.propose(BRUNO, { ...create, kind: "delete" });
        yield* proposals.decide(ANA, { id: deletion.id, action: "approve" });
        expect((yield* repo.documents).find((d) => d.id === create.path)).toBeUndefined();
        yield* proposals.decide(ANA, { id: deletion.id, action: "revert" });
        expect((yield* repo.documents).find((d) => d.id === create.path)?.content).toBe(
          create.content,
        );
        const crossArea = yield* proposals.propose(BRUNO, {
          ...create,
          kind: "move-scope",
          targetScope: "frontend",
        });
        expect(yield* codeOf(proposals.decide(ANA, { id: crossArea.id, action: "approve" }))).toBe(
          "access_denied",
        );
        expect(
          yield* codeOf(proposals.decide(GERRY, { id: crossArea.id, action: "approve" })),
        ).toBe("access_denied");
        yield* proposals.decide(ADMIN, {
          id: crossArea.id,
          action: "reject",
          reason: "Keep in Ledger",
        });
        const move = yield* proposals.propose(BRUNO, {
          ...create,
          kind: "move-scope",
          targetScope: "global",
        });
        expect(yield* codeOf(proposals.decide(ANA, { id: move.id, action: "approve" }))).toBe(
          "access_denied",
        );
        yield* proposals.decide(ADMIN, { id: move.id, action: "approve" });
        expect((yield* repo.documents).find((d) => d.id === "global/x.md")?.content).toBe(
          create.content,
        );
        expect((yield* repo.documents).find((d) => d.id === create.path)).toBeUndefined();
        const knowledge = yield* AreaKnowledge.AreaKnowledge;
        const gerry = (yield* knowledge.getMemberPrincipal(GERRY))!;
        expect((yield* knowledge.searchDocuments(gerry, "Original")).map((d) => d.id)).toContain(
          "global/x.md",
        );
        const backToArea = yield* proposals.propose(ANA, {
          kind: "move-scope",
          scope: "global",
          path: "global/x.md",
          targetScope: "ledger",
          reason: "Return area-specific context",
          evidence: [],
        });
        expect(yield* codeOf(proposals.decide(ANA, { id: backToArea.id, action: "approve" }))).toBe(
          "access_denied",
        );
        yield* proposals.decide(ADMIN, { id: backToArea.id, action: "approve" });
      }).pipe(Effect.provide(layer)),
  );

  it.effect("checks the persisted content snapshot even when git history has not changed", () =>
    Effect.gen(function* () {
      const proposals = yield* KnowledgeProposals.KnowledgeProposals;
      const fs = yield* FileSystem.FileSystem;
      const store = yield* EnterpriseStore.EnterpriseStore;
      const config = yield* ServerConfig.ServerConfig;
      const file = `${config.baseDir}/enterprise/knowledge/${create.path}`;
      const created = yield* proposals.propose(BRUNO, create);
      yield* proposals.decide(ANA, { id: created.id, action: "approve" });
      const snapshot = "# Uncommitted source";
      yield* fs.writeFileString(file, snapshot);
      const update = yield* proposals.propose(BRUNO, {
        ...create,
        kind: "update",
        content: "# Proposed replacement",
      });
      expect(update).toMatchObject({
        baseContentHash: "60f2230529c281ee1587c1e9503896b380968823ed02f982aa211f9b63c3f948",
      });
      yield* fs.writeFileString(file, create.content);
      expect(yield* codeOf(proposals.decide(ANA, { id: update.id, action: "approve" }))).toBe(
        "conflict",
      );
      expect((yield* store.listProposals).find((p) => p.id === update.id)?.status).toBe("pending");
      expect(yield* fs.readFileString(file)).toBe(create.content);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("recovers a pending proposal whose approval commit already exists", () =>
    Effect.gen(function* () {
      const proposals = yield* KnowledgeProposals.KnowledgeProposals;
      const repo = yield* KnowledgeRepo.KnowledgeRepo;
      const store = yield* EnterpriseStore.EnterpriseStore;
      const proposal = yield* proposals.propose(BRUNO, create);
      const commit = yield* repo.apply(proposal, ANA);
      expect((yield* store.listProposals).find((p) => p.id === proposal.id)?.status).toBe(
        "pending",
      );
      const recovered = yield* proposals.decide(ANA, { id: proposal.id, action: "approve" });
      expect(recovered).toMatchObject({ status: "applied", commit });
      expect((yield* store.listProposals).find((p) => p.id === proposal.id)?.commit).toBe(commit);
      const config = yield* ServerConfig.ServerConfig;
      const runner = yield* ProcessRunner.ProcessRunner;
      const count = yield* runner.run({
        command: "git",
        args: ["rev-list", "--count", "HEAD"],
        cwd: `${config.baseDir}/enterprise/knowledge`,
      });
      expect(count.stdout.trim()).toBe("2");
    }).pipe(Effect.provide(layer)),
  );

  it.effect("serializes concurrent approvals and refuses stale same-file snapshots", () =>
    Effect.gen(function* () {
      const proposals = yield* KnowledgeProposals.KnowledgeProposals;
      const p = yield* proposals.propose(BRUNO, create);
      yield* proposals.decide(ANA, { id: p.id, action: "approve" });
      const a = yield* proposals.propose(BRUNO, { ...create, kind: "update", content: "First" });
      const b = yield* proposals.propose(BRUNO, { ...create, kind: "update", content: "Second" });
      const outcomes = yield* Effect.forEach(
        [a, b],
        (p) => codeOf(proposals.decide(ANA, { id: p.id, action: "approve" })),
        { concurrency: "unbounded" },
      );
      expect(outcomes.toSorted()).toEqual(["conflict", "ok"]);
      expect(yield* codeOf(proposals.decide(ANA, { id: p.id, action: "revert" }))).toBe("conflict");
      const unrelated = yield* proposals.propose(BRUNO, {
        ...create,
        path: "areas/ledger/unrelated.md",
      });
      expect(yield* codeOf(proposals.decide(ANA, { id: unrelated.id, action: "approve" }))).toBe(
        "ok",
      );
    }).pipe(Effect.provide(layer)),
  );

  it.effect(
    "holds area-access pending until admin approval and supports revocation by revert",
    () =>
      Effect.gen(function* () {
        const proposals = yield* KnowledgeProposals.KnowledgeProposals;
        const store = yield* EnterpriseStore.EnterpriseStore;
        const p = yield* proposals.propose(GERRY, {
          kind: "area-access",
          scope: "ledger",
          path: "",
          reason: "Work with Ledger",
          evidence: [],
        });
        expect(yield* store.listGrants(GERRY)).toEqual([]);
        expect(yield* codeOf(proposals.decide(ANA, { id: p.id, action: "approve" }))).toBe(
          "access_denied",
        );
        yield* proposals.decide(ADMIN, { id: p.id, action: "approve" });
        expect((yield* store.listGrants(GERRY)).map((g) => g.areaId)).toContain("ledger");
        for (const input of [
          { ...create, path: "areas/ledger/grant.md" },
          { ...create, kind: "update" as const, path: "areas/ledger/README.md" },
          { ...create, kind: "delete" as const, path: "areas/ledger/README.md" },
          {
            ...create,
            kind: "move-scope" as const,
            path: "areas/ledger/README.md",
            targetScope: "frontend",
          },
        ])
          expect(yield* codeOf(proposals.propose(GERRY, input))).toBe("access_denied");
        yield* proposals.decide(ADMIN, { id: p.id, action: "revert" });
        expect(yield* store.listGrants(GERRY)).toEqual([]);
      }).pipe(Effect.provide(layer)),
  );
});
