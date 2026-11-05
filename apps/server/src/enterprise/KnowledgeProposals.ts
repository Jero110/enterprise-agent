import {
  EnterpriseError,
  type KnowledgeProposeInput,
  type KnowledgeProposal,
  type KnowledgeProposalInbox,
  type KnowledgeProposalDecision,
  type KnowledgeProposalInboxInput,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
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
    ) => Effect.Effect<KnowledgeProposal, EnterpriseError>;
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

const canApprove = (member: EnterpriseStore.EnterpriseMember, proposal: KnowledgeProposal) =>
  member.role === "admin" ||
  (member.role === "lead" &&
    proposal.kind !== "area-access" &&
    proposal.scope !== "global" &&
    member.teamId === proposal.scope &&
    (proposal.targetScope === undefined || proposal.targetScope === member.teamId));
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
    const memberOf = Effect.fn("KnowledgeProposals.memberOf")(function* (email: string) {
      const member = yield* store.getMember(email);
      if (member === null || !(yield* store.canEnter(email))) return yield* denied;
      return member;
    });
    const now = DateTime.now.pipe(Effect.map(DateTime.formatIso));
    const propose = Effect.fn("KnowledgeProposals.propose")(function* (
      email: string,
      input: KnowledgeProposeInput,
    ) {
      const member = yield* memberOf(email);
      if (!input.reason.trim() || input.evidence.some((e) => !e.trim() || /[\r\n]/.test(e)))
        return yield* invalid;
      if (input.scope !== "global" && (yield* store.getTeam(input.scope)) === null)
        return yield* invalid;
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
          !(yield* store.listGrants(member.email)).some((g) => g.areaId === input.scope)
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
        baseVersion: input.kind === "area-access" ? "" : yield* repo.version(input.path),
        targetVersion: target === null ? "" : yield* repo.version(target),
      };
      yield* store.saveProposal(proposal);
      return proposal;
    }, mutex.withPermits(1));
    const inbox = Effect.fn("KnowledgeProposals.inbox")(function* (
      email: string,
      input: KnowledgeProposalInboxInput = {},
    ) {
      const member = yield* memberOf(email);
      const proposals = (yield* store.listProposals).filter((p) => canApprove(member, p));
      return {
        proposals: input.countOnly ? [] : proposals,
        pendingCount: proposals.filter((p) => p.status === "pending").length,
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
        if (!canApprove(member, proposal)) return yield* denied;
        if (
          input.action === "revert" ? proposal.status !== "applied" : proposal.status !== "pending"
        )
          return yield* new EnterpriseError({
            code: "conflict",
            message: "This proposal has already been resolved.",
          });
        let updated: KnowledgeProposal;
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
          const commit = yield* repo.apply(proposal, member.email);
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
    return KnowledgeProposals.of({ propose, inbox, decide });
  }),
);
