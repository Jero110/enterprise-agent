import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Sqlite from "../persistence/Sqlite.ts";
import { acmeSeedPath } from "./EnterpriseStore.testkit.ts";
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
const layerAt = (baseDir: string, dbPath: string) =>
  AreaKnowledge.layer.pipe(
    Layer.provideMerge(KnowledgeProposals.layer),
    Layer.provideMerge(KnowledgeRepo.layer),
    Layer.provideMerge(ProcessRunner.layer),
    Layer.provideMerge(
      EnterpriseStore.layer.pipe(Layer.provideMerge(Sqlite.layerFromPath(dbPath))),
    ),
    Layer.provideMerge(ServerConfig.layerTest(process.cwd(), baseDir)),
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
  it.effect("keeps uploaded bytes after hub restart and rechecks reviewer grants on read", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-upload-restart-" });
      const dbPath = path.join(baseDir, "enterprise.sqlite");
      const bytes = new TextEncoder().encode("persisted");
      const staged = yield* Effect.gen(function* () {
        const store = yield* EnterpriseStore.EnterpriseStore;
        yield* store.seed(yield* EnterpriseStore.loadSeedFile(acmeSeedPath));
        const proposals = yield* KnowledgeProposals.KnowledgeProposals;
        return yield* proposals.uploadEncoded(BRUNO, {
          scope: "ledger",
          reason: "Review",
          files: [
            {
              name: "evidence.txt",
              relativePath: "raw/cx/evidence.txt",
              mimeType: "text/plain",
              base64: Buffer.from(bytes).toString("base64"),
            },
            {
              name: "evidence.txt",
              relativePath: "raw/ventas/evidence.txt",
              mimeType: "text/plain",
              base64: Buffer.from("second").toString("base64"),
            },
          ],
        });
      }).pipe(Effect.provide(layerAt(baseDir, dbPath)));
      yield* Effect.gen(function* () {
        const proposals = yield* KnowledgeProposals.KnowledgeProposals;
        const store = yield* EnterpriseStore.EnterpriseStore;
        const fileId = staged.files![0]!.id;
        expect(staged.files?.map(({ name, relativePath }) => ({ name, relativePath }))).toEqual([
          { name: "evidence.txt", relativePath: "raw/cx/evidence.txt" },
          { name: "evidence.txt", relativePath: "raw/ventas/evidence.txt" },
        ]);
        expect(
          (yield* proposals.inbox(ANA)).proposals.find((proposal) => proposal.id === staged.id)
            ?.files,
        ).toMatchObject(staged.files!);
        expect((yield* proposals.inbox(ANA)).proposals.map((p) => p.id)).toContain(staged.id);
        expect(Array.from((yield* proposals.readAttachment(ANA, staged.id, fileId)).bytes)).toEqual(
          Array.from(bytes),
        );
        expect(
          new TextDecoder().decode(
            (yield* proposals.readAttachment(ANA, staged.id, staged.files![1]!.id)).bytes,
          ),
        ).toBe("second");
        yield* store.moveMember(ANA, "frontend");
        expect(yield* codeOf(proposals.readAttachment(ANA, staged.id, fileId))).toBe(
          "proposal_not_found",
        );
        expect((yield* proposals.readAttachment(BRUNO, staged.id, fileId)).name).toBe(
          "evidence.txt",
        );
      }).pipe(Effect.provide(layerAt(baseDir, dbPath)));
    }).pipe(Effect.provide(NodeServices.layer)),
  );
  it.effect("stages actual files without changing knowledge on approval or rejection", () =>
    Effect.gen(function* () {
      const proposals = yield* KnowledgeProposals.KnowledgeProposals;
      const repo = yield* KnowledgeRepo.KnowledgeRepo;
      const before = yield* repo.documents;
      const bytes = new TextEncoder().encode("sample PDF bytes");
      const upload = yield* proposals.upload(BRUNO, {
        scope: "personal",
        recipient: ANA,
        reason: "Review this",
        files: [
          { name: "brief.pdf", mimeType: "application/pdf", bytes },
          {
            name: "notes.txt",
            mimeType: "text/plain",
            bytes: new TextEncoder().encode("review notes"),
          },
        ],
      });
      expect(upload).toMatchObject({
        kind: "upload",
        status: "pending",
        path: "",
        files: [
          { name: "brief.pdf", mimeType: "application/pdf", sizeBytes: bytes.length },
          { name: "notes.txt", mimeType: "text/plain", sizeBytes: 12 },
        ],
      });
      expect(
        new TextDecoder().decode(
          (yield* proposals.readAttachment(ANA, upload.id, upload.files![1]!.id)).bytes,
        ),
      ).toBe("review notes");
      expect((yield* proposals.inbox(ANA)).proposals.map((p) => p.id)).toContain(upload.id);
      expect(
        Array.from((yield* proposals.readAttachment(ANA, upload.id, upload.files![0]!.id)).bytes),
      ).toEqual(Array.from(bytes));
      expect(yield* codeOf(proposals.readAttachment(GERRY, upload.id, upload.files![0]!.id))).toBe(
        "proposal_not_found",
      );
      expect(yield* codeOf(proposals.readAttachment(ANA, upload.id, "arbitrary"))).toBe(
        "proposal_not_found",
      );
      expect((yield* proposals.decide(ANA, { id: upload.id, action: "approve" })).status).toBe(
        "approved-awaiting-processing",
      );
      expect(yield* repo.documents).toEqual(before);
      const rejected = yield* proposals.upload(BRUNO, {
        scope: "ledger",
        reason: "Review",
        files: [{ name: "ledger.txt", mimeType: "text/plain", bytes }],
      });
      expect(
        (yield* proposals.decide(ANA, { id: rejected.id, action: "reject", reason: "No" })).status,
      ).toBe("rejected");
      expect(yield* repo.documents).toEqual(before);
      const store = yield* EnterpriseStore.EnterpriseStore;
      yield* store.revokeMember(ANA);
      expect(yield* codeOf(proposals.readAttachment(ANA, upload.id, upload.files![0]!.id))).toBe(
        "access_denied",
      );
      expect((yield* proposals.readAttachment(BRUNO, upload.id, upload.files![0]!.id)).name).toBe(
        "brief.pdf",
      );
    }).pipe(Effect.provide(layer)),
  );

  it.effect("does not approve a proposed upload when a staged file disappeared", () =>
    Effect.gen(function* () {
      const proposals = yield* KnowledgeProposals.KnowledgeProposals;
      const fs = yield* FileSystem.FileSystem;
      const config = yield* ServerConfig.ServerConfig;
      const p = yield* proposals.upload(BRUNO, {
        scope: "ledger",
        reason: "Review",
        files: [{ name: "gone.txt", mimeType: "text/plain", bytes: new Uint8Array([1]) }],
      });
      yield* fs.remove(`${config.baseDir}/enterprise/proposal-uploads/${p.id}/${p.files![0]!.id}`);
      expect(yield* codeOf(proposals.decide(ANA, { id: p.id, action: "approve" }))).toBe(
        "invalid_proposal",
      );
      expect((yield* proposals.inbox(ANA)).proposals.find((item) => item.id === p.id)?.status).toBe(
        "pending",
      );
    }).pipe(Effect.provide(layer)),
  );

  it.effect("rejects inaccessible targets, malformed batches and traversal names", () =>
    Effect.gen(function* () {
      const proposals = yield* KnowledgeProposals.KnowledgeProposals;
      const bytes = new Uint8Array([1]);
      const valid = {
        scope: "ledger",
        reason: "Review",
        files: [{ name: "a.pdf", mimeType: "application/pdf", bytes }],
      };
      for (const input of [
        { ...valid, scope: "global" },
        { ...valid, scope: "personal", recipient: "absent@example.com" },
        { ...valid, scope: "frontend" },
        { ...valid, files: [] },
        { ...valid, files: [{ ...valid.files[0]!, name: "../attack.html" }] },
        ...[
          "../attack.html",
          "/absolute/a.pdf",
          "raw/./a.pdf",
          "raw//a.pdf",
          "raw\\a.pdf",
          "raw/a/../a.pdf",
        ].map((relativePath) => ({ ...valid, files: [{ ...valid.files[0]!, relativePath }] })),
        { ...valid, files: [{ ...valid.files[0]!, bytes: new Uint8Array(10_485_761) }] },
        {
          ...valid,
          files: Array.from({ length: 4 }, (_, index) => ({
            ...valid.files[0]!,
            name: `${index}.pdf`,
            bytes: new Uint8Array(9 * 1024 * 1024),
          })),
        },
      ]) {
        expect(yield* codeOf(proposals.upload(BRUNO, input))).not.toBe("ok");
      }
    }).pipe(Effect.provide(layer)),
  );
  it.effect("rejects malformed encoded uploads before creating a proposal", () =>
    Effect.gen(function* () {
      const proposals = yield* KnowledgeProposals.KnowledgeProposals;
      const store = yield* EnterpriseStore.EnterpriseStore;
      const before = (yield* store.listProposals).length;
      for (const base64 of ["!!!", "YQ=", "YQ==YQ==", "A".repeat(14_000_000)]) {
        expect(
          yield* codeOf(
            proposals.uploadEncoded(BRUNO, {
              scope: "ledger",
              reason: "Review",
              files: [{ name: "a.txt", mimeType: "text/plain", base64 }],
            }),
          ),
        ).toBe("invalid_proposal");
      }
      expect((yield* store.listProposals).length).toBe(before);
    }).pipe(Effect.provide(layer)),
  );
  it.effect("does not duplicate identical pending create proposals", () =>
    Effect.gen(function* () {
      const proposals = yield* KnowledgeProposals.KnowledgeProposals;
      const first = yield* proposals.propose(BRUNO, create);
      const second = yield* proposals.propose(BRUNO, create);
      expect(second.id).toBe(first.id);
      expect((yield* proposals.inbox(ANA)).pendingCount).toBe(1);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("persists a proposal, scopes the inbox and commits approval with provenance", () =>
    Effect.gen(function* () {
      const proposals = yield* KnowledgeProposals.KnowledgeProposals;
      const repo = yield* KnowledgeRepo.KnowledgeRepo;
      const p = yield* proposals.propose(BRUNO, create);
      const second = yield* proposals.propose(BRUNO, {
        ...create,
        path: "areas/ledger/second.md",
      });
      expect(p).toMatchObject({ baseContentHash: "absent" });
      expect((yield* proposals.inbox(ANA)).proposals.map((p) => p.id)).toContain(p.id);
      expect((yield* proposals.inbox(BRUNO)).proposals.map((proposal) => proposal.id)).toContain(
        p.id,
      );
      expect((yield* proposals.inbox(BRUNO)).pendingCount).toBe(0);
      expect((yield* proposals.inbox(BRUNO)).proposals[0]).toMatchObject({
        canDecide: false,
        reviewers: expect.arrayContaining([{ email: ANA, role: "lead" }]),
      });
      expect((yield* proposals.inbox(GERRY)).proposals).toEqual([]);
      expect(yield* codeOf(proposals.decide(GERRY, { id: p.id, action: "approve" }))).toBe(
        "access_denied",
      );
      expect(yield* codeOf(proposals.decide(BRUNO, { id: p.id, action: "approve" }))).toBe(
        "access_denied",
      );
      const applied = yield* proposals.decide(ANA, { id: p.id, action: "approve" });
      expect(applied.status).toBe("applied");
      const secondApplied = yield* proposals.decide(ANA, { id: second.id, action: "approve" });
      expect(secondApplied.commit).toBeDefined();
      expect(secondApplied.commit).not.toBe(applied.commit);
      expect((yield* repo.documents).find((d) => d.id === create.path)?.content).toBe(
        create.content,
      );
      const config = yield* ServerConfig.ServerConfig;
      const runner = yield* ProcessRunner.ProcessRunner;
      const log = yield* runner.run({
        command: "git",
        args: ["log", "-2", "--format=%B"],
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
    "shows personal proposals only to their recipient and author, and reserves decisions for recipient",
    () =>
      Effect.gen(function* () {
        const proposals = yield* KnowledgeProposals.KnowledgeProposals;
        const upload = yield* proposals.upload(BRUNO, {
          scope: "personal",
          recipient: ANA,
          reason: "Review",
          files: [{ name: "note.txt", mimeType: "text/plain", bytes: new Uint8Array([1]) }],
        });
        expect((yield* proposals.inbox(BRUNO)).proposals).toMatchObject([
          {
            id: upload.id,
            canDecide: false,
            reviewers: [{ email: ANA, role: "recipient" }],
          },
        ]);
        expect((yield* proposals.inbox(ANA)).pendingCount).toBe(1);
        expect((yield* proposals.inbox(GERRY)).proposals).toEqual([]);
        expect(yield* codeOf(proposals.decide(GERRY, { id: upload.id, action: "approve" }))).toBe(
          "proposal_not_found",
        );
        expect(
          yield* codeOf(proposals.decide(GERRY, { id: "not-a-proposal", action: "approve" })),
        ).toBe("proposal_not_found");
        expect(yield* codeOf(proposals.decide(ADMIN, { id: upload.id, action: "approve" }))).toBe(
          "proposal_not_found",
        );
        expect(yield* codeOf(proposals.decide(BRUNO, { id: upload.id, action: "approve" }))).toBe(
          "access_denied",
        );
        expect((yield* proposals.decide(ANA, { id: upload.id, action: "approve" })).status).toBe(
          "approved-awaiting-processing",
        );
        expect((yield* proposals.inbox(BRUNO)).proposals[0]?.status).toBe(
          "approved-awaiting-processing",
        );
      }).pipe(Effect.provide(layer)),
  );

  it.effect("uses independent area roles for review and rechecks grants on every decision", () =>
    Effect.gen(function* () {
      const proposals = yield* KnowledgeProposals.KnowledgeProposals;
      const store = yield* EnterpriseStore.EnterpriseStore;
      yield* store.grantArea({ email: ANA, areaId: "frontend", role: "member", grantedBy: ADMIN });
      const ledger = yield* proposals.propose(BRUNO, create);
      const frontend = yield* proposals.propose(ANA, {
        ...create,
        scope: "frontend",
        path: "areas/frontend/context.md",
      });
      expect((yield* proposals.inbox(ANA)).proposals.map((p) => p.id)).toContain(frontend.id);
      expect((yield* proposals.inbox(ANA)).pendingCount).toBe(1);
      expect(yield* codeOf(proposals.decide(ANA, { id: frontend.id, action: "approve" }))).toBe(
        "access_denied",
      );
      yield* store.grantArea({ email: ANA, areaId: "frontend", role: "lead", grantedBy: ADMIN });
      expect((yield* proposals.inbox(ANA)).pendingCount).toBe(2);
      yield* store.revokeArea(ANA, "frontend");
      expect((yield* proposals.inbox(ANA)).proposals.map((p) => p.id)).not.toContain(frontend.id);
      expect(yield* codeOf(proposals.decide(ANA, { id: frontend.id, action: "approve" }))).toBe(
        "access_denied",
      );
      yield* proposals.decide(ADMIN, { id: frontend.id, action: "approve" });
      yield* proposals.decide(ANA, { id: ledger.id, action: "approve" });
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
    "holds area-access pending until lead approval and supports admin revocation by revert",
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
        expect((yield* proposals.inbox(GERRY)).proposals).toMatchObject([
          { id: p.id, canDecide: false },
        ]);
        expect((yield* proposals.inbox(ANA)).proposals).toMatchObject([
          { id: p.id, canDecide: true },
        ]);
        yield* proposals.decide(ANA, { id: p.id, action: "approve" });
        expect((yield* store.listGrants(GERRY)).map((g) => g.areaId)).toContain("ledger");
        expect(
          yield* codeOf(proposals.propose(GERRY, { ...create, path: "areas/ledger/grant.md" })),
        ).toBe("ok");
        expect(
          yield* codeOf(
            proposals.propose(GERRY, {
              ...create,
              kind: "update",
              path: "areas/ledger/missing.md",
            }),
          ),
        ).toBe("invalid_proposal");
        yield* proposals.decide(ADMIN, { id: p.id, action: "revert" });
        expect(
          yield* codeOf(
            proposals.propose(GERRY, { ...create, path: "areas/ledger/after-revert.md" }),
          ),
        ).toBe("access_denied");
        expect(yield* store.listGrants(GERRY)).toEqual([]);
      }).pipe(Effect.provide(layer)),
  );
});
