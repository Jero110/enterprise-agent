import {
  EnterpriseError,
  type KnowledgeProposeInput,
  type KnowledgeProposal,
  type KnowledgeProposalInbox,
  type KnowledgeProposalDecision,
  type KnowledgeProposalInboxInput,
  type KnowledgeUploadInput,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as ServerConfig from "../config.ts";
import * as Semaphore from "effect/Semaphore";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as EnterpriseStore from "./EnterpriseStore.ts";
import * as KnowledgeRepo from "../knowledge/KnowledgeRepo.ts";

export class KnowledgeProposals extends Context.Service<
  KnowledgeProposals,
  {
    readonly propose: (
      email: string,
      input: KnowledgeProposeInput,
      ingestion?: boolean,
    ) => Effect.Effect<KnowledgeProposal, EnterpriseError>;
    readonly upload: (
      email: string,
      input: {
        readonly scope: string;
        readonly recipient?: string;
        readonly reason: string;
        readonly files: ReadonlyArray<{
          readonly name: string;
          readonly mimeType: string;
          readonly bytes: Uint8Array;
        }>;
      },
    ) => Effect.Effect<KnowledgeProposal, EnterpriseError>;
    readonly uploadEncoded: (
      email: string,
      input: KnowledgeUploadInput,
    ) => Effect.Effect<KnowledgeProposal, EnterpriseError>;
    readonly readAttachment: (
      email: string,
      proposalId: string,
      fileId: string,
    ) => Effect.Effect<
      { readonly name: string; readonly mimeType: string; readonly bytes: Uint8Array },
      EnterpriseError
    >;
    readonly inbox: (
      email: string,
      input?: KnowledgeProposalInboxInput,
    ) => Effect.Effect<KnowledgeProposalInbox, EnterpriseError>;
    readonly decide: (
      email: string,
      input: KnowledgeProposalDecision,
    ) => Effect.Effect<KnowledgeProposal, EnterpriseError>;
  }
>()("t3/enterprise/KnowledgeProposals") {}

const canApprove = (
  member: EnterpriseStore.EnterpriseMember,
  grants: ReadonlyArray<EnterpriseStore.EnterpriseAreaGrant>,
  proposal: KnowledgeProposal,
) => {
  if (proposal.scope === "personal") return proposal.recipient === member.email;
  if (member.role === "admin") return true;
  if (proposal.scope === "global") return false;
  const lead = (areaId: string) =>
    (member.teamId === areaId && member.role === "lead") ||
    grants.some((grant) => grant.areaId === areaId && grant.role === "lead");
  return (
    lead(proposal.scope) &&
    (proposal.targetScope === undefined || proposal.targetScope === proposal.scope)
  );
};
const invalid = new EnterpriseError({
  code: "invalid_proposal",
  message: "Invalid proposal: check scope, markdown path, content, reason and target scope.",
});
const denied = new EnterpriseError({
  code: "access_denied",
  message: "You cannot act on this proposal.",
});

export const layer = Layer.effect(
  KnowledgeProposals,
  Effect.gen(function* () {
    const store = yield* EnterpriseStore.EnterpriseStore;
    const repo = yield* KnowledgeRepo.KnowledgeRepo;
    const random = yield* SecureRandom.SecureRandom;
    const mutex = yield* Semaphore.make(1);
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const config = yield* ServerConfig.ServerConfig;
    const uploadDir = path.join(config.baseDir, "enterprise", "proposal-uploads");
    const missing = new EnterpriseError({
      code: "proposal_not_found",
      message: "Proposal not found.",
    });
    const uploadInvalid = new EnterpriseError({
      code: "invalid_proposal",
      message: "Invalid upload batch.",
    });
    const memberOf = Effect.fn("KnowledgeProposals.memberOf")(function* (email: string) {
      const member = yield* store.getMember(email);
      if (member === null || !(yield* store.canEnter(email))) return yield* denied;
      return member;
    });
    const now = DateTime.now.pipe(Effect.map(DateTime.formatIso));
    const propose = Effect.fn("KnowledgeProposals.propose")(function* (
      email: string,
      input: KnowledgeProposeInput,
      ingestion = false,
    ) {
      const member = yield* memberOf(email);
      if (!input.reason.trim() || input.evidence.some((e) => !e.trim() || /[\r\n]/.test(e)))
        return yield* invalid;
      if (input.scope !== "global" && (yield* store.getTeam(input.scope)) === null)
        return yield* invalid;
      if (input.kind === "upload" || input.recipient !== undefined) return yield* invalid;
      if (ingestion && (input.kind === "create" || input.kind === "update")) {
        const node = KnowledgeRepo.documentOf(input.path, input.content ?? "");
        if (
          node.layer === undefined ||
          node.areaId !== (input.scope === "global" ? "general" : input.scope)
        )
          return yield* invalid;
      }
      if (input.kind === "area-access") {
        if (
          input.scope === "global" ||
          input.path !== "" ||
          member.role === "admin" ||
          member.teamId === input.scope ||
          (yield* store.listGrants(member.email)).some((g) => g.areaId === input.scope)
        )
          return yield* invalid;
        if (
          (yield* store.listProposals).some(
            (p) =>
              p.kind === "area-access" &&
              p.proposedBy === member.email &&
              p.scope === input.scope &&
              p.status === "pending",
          )
        )
          return yield* new EnterpriseError({
            code: "conflict",
            message: "An access request for this area is already pending.",
          });
      } else {
        const prefix = input.scope === "global" ? "global/" : `areas/${input.scope}/`;
        const relative = input.path.slice(prefix.length);
        if (
          !input.path.startsWith(prefix) ||
          !relative.endsWith(".md") ||
          relative
            .split("/")
            .some(
              (part) =>
                !part ||
                part === "." ||
                part === ".." ||
                part.startsWith(".") ||
                /[\\\r\n\0]/.test(part),
            )
        )
          return yield* invalid;
        if (
          member.role !== "admin" &&
          input.scope !== "global" &&
          member.teamId !== input.scope &&
          !(yield* store.listGrants(member.email)).some((grant) => grant.areaId === input.scope)
        )
          return yield* denied;
        const docs = yield* repo.documents;
        const doc = docs.find((d) => d.id === input.path);
        if (input.kind === "create" ? doc !== undefined : doc === undefined) return yield* invalid;
        if (
          (input.kind === "create" || input.kind === "update") &&
          (input.content === undefined || input.content === doc?.content)
        )
          return yield* invalid;
        if (input.kind === "move-scope") {
          if (
            !input.targetScope ||
            input.targetScope === input.scope ||
            (input.targetScope !== "global" && (yield* store.getTeam(input.targetScope)) === null)
          )
            return yield* invalid;
          const target =
            (input.targetScope === "global" ? "global/" : `areas/${input.targetScope}/`) + relative;
          if (docs.some((d) => d.id === target))
            return yield* new EnterpriseError({
              code: "conflict",
              message: "The destination document already exists.",
            });
        } else if (input.targetScope !== undefined) return yield* invalid;
      }
      if (input.kind === "create") {
        const pending = yield* store.listProposals;
        const existing = pending.find(
          (proposal) =>
            proposal.status === "pending" &&
            proposal.kind === "create" &&
            proposal.proposedBy === member.email &&
            proposal.scope === input.scope &&
            proposal.path === input.path &&
            proposal.content === input.content &&
            (ingestion
              ? proposal.evidence.some((e) => e.startsWith("ingestion:"))
              : proposal.reason === input.reason &&
                JSON.stringify(proposal.evidence) === JSON.stringify(input.evidence)),
        );
        if (existing !== undefined) return existing;
        if (
          ingestion &&
          pending.some(
            (proposal) =>
              proposal.status === "pending" &&
              proposal.kind === "create" &&
              proposal.path === input.path,
          )
        )
          return yield* new EnterpriseError({
            code: "conflict",
            message: "A create proposal for this document is already pending.",
          });
      }
      const target =
        input.kind === "move-scope"
          ? (input.targetScope === "global" ? "global/" : `areas/${input.targetScope}/`) +
            input.path.slice(
              (input.scope === "global" ? "global/" : `areas/${input.scope}/`).length,
            )
          : null;
      const proposal: KnowledgeProposal = {
        ...input,
        id: yield* random.uuidV4(),
        proposedBy: member.email,
        createdAt: yield* now,
        status: "pending",
        baseContentHash:
          input.kind === "area-access" ? "absent" : yield* repo.contentHash(input.path),
        baseVersion: input.kind === "area-access" ? "" : yield* repo.version(input.path),
        targetVersion: target === null ? "" : yield* repo.version(target),
      };
      yield* store.saveProposal(proposal);
      return proposal;
    }, mutex.withPermits(1));
    const upload = Effect.fn("KnowledgeProposals.upload")(function* (
      email: string,
      input: {
        readonly scope: string;
        readonly recipient?: string;
        readonly reason: string;
        readonly files: ReadonlyArray<{
          readonly name: string;
          readonly mimeType: string;
          readonly bytes: Uint8Array;
        }>;
      },
    ) {
      const member = yield* memberOf(email);
      if (
        !input.reason.trim() ||
        input.reason.length > 2_000 ||
        input.files.length < 1 ||
        input.files.length > 20 ||
        input.files.reduce((size, file) => size + file.bytes.byteLength, 0) > 40 * 1024 * 1024 ||
        input.files.some(
          (file) =>
            !file.name ||
            file.name.length > 255 ||
            file.name === "." ||
            file.name === ".." ||
            /[\\/\r\n\0]/.test(file.name) ||
            !file.mimeType ||
            file.mimeType.length > 128 ||
            file.bytes.byteLength < 1 ||
            file.bytes.byteLength > 10 * 1024 * 1024,
        )
      )
        return yield* uploadInvalid;
      if (input.scope === "personal") {
        const recipient = input.recipient && (yield* store.getMember(input.recipient));
        if (!recipient || !(yield* store.canEnter(recipient.email))) return yield* denied;
      } else {
        if (input.recipient !== undefined) return yield* uploadInvalid;
        if (input.scope !== "global" && (yield* store.getTeam(input.scope)) === null)
          return yield* uploadInvalid;
        if (
          member.role !== "admin" &&
          (input.scope === "global" ||
            (member.teamId !== input.scope &&
              !(yield* store.listGrants(member.email)).some(
                (grant) => grant.areaId === input.scope,
              )))
        )
          return yield* denied;
      }
      const id = yield* random.uuidV4();
      const files = yield* Effect.forEach(input.files, (file) =>
        Effect.map(random.uuidV4(), (fileId) => ({
          id: fileId,
          name: file.name,
          mimeType: file.mimeType,
          sizeBytes: file.bytes.byteLength,
        })),
      );
      const directory = path.join(uploadDir, id);
      const proposal: KnowledgeProposal = {
        id,
        kind: "upload",
        scope: input.scope,
        ...(input.scope === "personal" ? { recipient: input.recipient!.trim().toLowerCase() } : {}),
        path: "",
        reason: input.reason.trim(),
        evidence: [],
        files,
        proposedBy: member.email,
        createdAt: yield* now,
        status: "pending",
        baseContentHash: "absent",
        baseVersion: "",
        targetVersion: "",
      };
      yield* fs.makeDirectory(directory, { recursive: true }).pipe(Effect.orDie);
      yield* Effect.forEach(
        input.files,
        (file, index) => fs.writeFile(path.join(directory, files[index]!.id), file.bytes),
        { discard: true },
      ).pipe(
        Effect.mapError(
          () =>
            new EnterpriseError({
              code: "knowledge_write_failed",
              message: "Could not store the uploaded files.",
            }),
        ),
        Effect.tapError(() =>
          fs.remove(directory, { recursive: true, force: true }).pipe(Effect.ignore),
        ),
      );
      yield* store
        .saveProposal(proposal)
        .pipe(
          Effect.tapError(() =>
            fs.remove(directory, { recursive: true, force: true }).pipe(Effect.ignore),
          ),
        );
      return proposal;
    }, mutex.withPermits(1));
    const uploadEncoded = Effect.fn("KnowledgeProposals.uploadEncoded")(function* (
      email: string,
      input: KnowledgeUploadInput,
    ) {
      if (
        input.files.length < 1 ||
        input.files.length > 20 ||
        input.files.some(
          (file) =>
            file.base64.length > 13_981_016 ||
            !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.base64),
        )
      )
        return yield* uploadInvalid;
      const files = input.files.map((file) => ({
        name: file.name,
        mimeType: file.mimeType,
        bytes: Uint8Array.from(Buffer.from(file.base64, "base64")),
      }));
      if (
        files.reduce((total, file) => total + file.bytes.byteLength, 0) > 40 * 1024 * 1024 ||
        files.some(
          (file, i) => Buffer.from(file.bytes).toString("base64") !== input.files[i]!.base64,
        )
      )
        return yield* uploadInvalid;
      return yield* upload(email, {
        scope: input.scope,
        ...(input.recipient === undefined ? {} : { recipient: input.recipient }),
        reason: input.reason,
        files,
      });
    });
    const readAttachment = Effect.fn("KnowledgeProposals.readAttachment")(function* (
      email: string,
      proposalId: string,
      fileId: string,
    ) {
      const member = yield* memberOf(email);
      const proposal = (yield* store.listProposals).find(
        (p) => p.id === proposalId && p.kind === "upload",
      );
      if (
        !proposal ||
        (proposal.proposedBy !== member.email &&
          !canApprove(member, yield* store.listGrants(member.email), proposal))
      )
        return yield* missing;
      const file = proposal.files?.find((f) => f.id === fileId);
      if (!file) return yield* missing;
      const bytes = yield* fs
        .readFile(path.join(uploadDir, proposal.id, file.id))
        .pipe(Effect.mapError(() => missing));
      if (bytes.byteLength !== file.sizeBytes) return yield* missing;
      return { name: file.name, mimeType: file.mimeType, bytes };
    });
    const inbox = Effect.fn("KnowledgeProposals.inbox")(function* (
      email: string,
      input: KnowledgeProposalInboxInput = {},
    ) {
      const member = yield* memberOf(email);
      const grants = yield* store.listGrants(member.email);
      const visible = (yield* store.listProposals).filter(
        (p) =>
          (p.scope === "global" ||
            p.scope === "personal" ||
            (p.kind === "area-access" && p.proposedBy === member.email) ||
            member.role === "admin" ||
            member.teamId === p.scope ||
            grants.some((grant) => grant.areaId === p.scope)) &&
          (p.proposedBy === member.email || canApprove(member, grants, p)),
      );
      const pendingCount = visible.filter(
        (p) => p.status === "pending" && canApprove(member, grants, p),
      ).length;
      if (input.countOnly) return { proposals: [], pendingCount };
      const members = (yield* store.listMembers).filter((m) => m.authorized && !m.revoked);
      const allGrants = yield* store.listAreaGrants;
      const grantsByEmail = Map.groupBy(allGrants, (grant) => grant.email);
      const reviewers = (p: KnowledgeProposal) =>
        p.scope === "personal"
          ? members
              .filter((m) => m.email === p.recipient)
              .map((m) => ({ email: m.email, role: "recipient" as const }))
          : members.flatMap((m) =>
              canApprove(m, grantsByEmail.get(m.email) ?? [], p)
                ? [
                    {
                      email: m.email,
                      role: (m.role === "admin" ? "admin" : "lead") as "admin" | "lead",
                    },
                  ]
                : [],
            );
      return {
        proposals: visible.map((p) => ({
          ...p,
          reviewers: reviewers(p),
          canDecide: p.status === "pending" && canApprove(member, grants, p),
        })),
        pendingCount,
      };
    });
    const decide = Effect.fn("KnowledgeProposals.decide")(
      function* (email: string, input: KnowledgeProposalDecision) {
        const member = yield* memberOf(email);
        const proposal = (yield* store.listProposals).find((p) => p.id === input.id);
        if (!proposal)
          return yield* new EnterpriseError({
            code: "proposal_not_found",
            message: "Proposal not found.",
          });
        if (!canApprove(member, yield* store.listGrants(member.email), proposal)) {
          if (proposal.scope === "personal" && proposal.proposedBy !== member.email)
            return yield* new EnterpriseError({
              code: "proposal_not_found",
              message: "Proposal not found.",
            });
          return yield* denied;
        }
        if (
          input.action === "revert" ? proposal.status !== "applied" : proposal.status !== "pending"
        )
          return yield* new EnterpriseError({
            code: "conflict",
            message: "This proposal has already been resolved.",
          });
        let updated: KnowledgeProposal;
        if (input.action === "approve" && proposal.kind === "upload") {
          for (const file of proposal.files ?? []) {
            const info = yield* fs
              .stat(path.join(uploadDir, proposal.id, file.id))
              .pipe(Effect.orElseSucceed(() => null));
            if (info?.type !== "File" || Number(info.size) !== file.sizeBytes)
              return yield* uploadInvalid;
          }
          if (!proposal.files?.length) return yield* uploadInvalid;
        }
        if (input.action === "reject") {
          if (!input.reason?.trim()) return yield* invalid;
          updated = {
            ...proposal,
            status: "rejected",
            rejectionReason: input.reason.trim(),
            resolvedBy: member.email,
            resolvedAt: yield* now,
          };
        } else if (input.action === "approve") {
          if (proposal.kind === "upload") {
            updated = {
              ...proposal,
              status: "approved-awaiting-processing",
              resolvedBy: member.email,
              resolvedAt: yield* now,
            };
            yield* store.saveProposal(updated);
            return updated;
          }
          const commit = yield* repo.apply(proposal, member.email).pipe(
            Effect.catchIf(
              (error) => error.code === "conflict",
              (error) =>
                repo.findApprovalCommit(proposal.id).pipe(
                  Effect.filterOrFail(
                    (commit) => commit !== null,
                    () => error,
                  ),
                ),
            ),
          );
          if (proposal.kind === "area-access")
            yield* store.grantArea({
              email: proposal.proposedBy,
              areaId: proposal.scope,
              grantedBy: member.email,
            });
          updated = {
            ...proposal,
            status: "applied",
            commit,
            resolvedBy: member.email,
            resolvedAt: yield* now,
          };
        } else {
          const revertCommit = yield* repo.revert(proposal, member.email);
          if (proposal.kind === "area-access")
            yield* store.revokeArea(proposal.proposedBy, proposal.scope);
          updated = {
            ...proposal,
            status: "reverted",
            revertCommit,
            resolvedBy: member.email,
            resolvedAt: yield* now,
          };
        }
        yield* store.saveProposal(updated);
        return updated;
      },
      mutex.withPermits(1),
      Effect.uninterruptible,
    );
    return KnowledgeProposals.of({ propose, upload, uploadEncoded, readAttachment, inbox, decide });
  }),
);
