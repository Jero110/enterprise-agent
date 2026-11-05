import * as Schema from "effect/Schema";
import { TrimmedNonEmptyString } from "./baseSchemas.ts";

export const KnowledgeProposeInput = Schema.Struct({
  kind: Schema.Literals(["create", "update", "move-scope", "delete", "area-access", "upload"]),
  scope: TrimmedNonEmptyString,
  path: Schema.String,
  content: Schema.optional(Schema.String),
  targetScope: Schema.optional(TrimmedNonEmptyString),
  recipient: Schema.optional(TrimmedNonEmptyString),
  reason: TrimmedNonEmptyString,
  evidence: Schema.Array(TrimmedNonEmptyString),
});
export type KnowledgeProposeInput = typeof KnowledgeProposeInput.Type;

export const KnowledgeProposal = Schema.Struct({
  ...KnowledgeProposeInput.fields,
  id: Schema.String,
  proposedBy: Schema.String,
  createdAt: Schema.String,
  status: Schema.Literals([
    "pending",
    "applied",
    "rejected",
    "reverted",
    "approved-awaiting-processing",
  ]),
  baseContentHash: Schema.String,
  baseVersion: Schema.String,
  targetVersion: Schema.String,
  resolvedBy: Schema.optional(Schema.String),
  resolvedAt: Schema.optional(Schema.String),
  rejectionReason: Schema.optional(Schema.String),
  commit: Schema.optional(Schema.String),
  revertCommit: Schema.optional(Schema.String),
  reviewers: Schema.optional(
    Schema.Array(
      Schema.Struct({
        email: Schema.String,
        role: Schema.Literals(["admin", "lead", "recipient"]),
      }),
    ),
  ),
  canDecide: Schema.optional(Schema.Boolean),
});
export type KnowledgeProposal = typeof KnowledgeProposal.Type;
export const KnowledgeProposalInboxInput = Schema.Struct({
  countOnly: Schema.optional(Schema.Boolean),
});
export type KnowledgeProposalInboxInput = typeof KnowledgeProposalInboxInput.Type;
export const KnowledgeProposalInbox = Schema.Struct({
  proposals: Schema.Array(KnowledgeProposal),
  pendingCount: Schema.Number,
});
export type KnowledgeProposalInbox = typeof KnowledgeProposalInbox.Type;
export const KnowledgeProposalDecision = Schema.Struct({
  id: TrimmedNonEmptyString,
  action: Schema.Literals(["approve", "reject", "revert"]),
  reason: Schema.optional(TrimmedNonEmptyString),
});
export type KnowledgeProposalDecision = typeof KnowledgeProposalDecision.Type;
