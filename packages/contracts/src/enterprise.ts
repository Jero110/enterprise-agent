import * as Schema from "effect/Schema";

import { EnvironmentId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { PeerLinkCreateInput } from "./peerLink.ts";
import { TeamMemberRole } from "./teamIdentity.ts";
import { ModelSelection } from "./modelSelection.ts";

/** Who the hub says a session is: its member, team and role. */
export const EnterpriseHubIdentity = Schema.Struct({
  email: TrimmedNonEmptyString,
  displayName: TrimmedNonEmptyString,
  teamId: Schema.NullOr(TrimmedNonEmptyString),
  teamName: Schema.NullOr(Schema.String),
  role: TeamMemberRole,
});
export type EnterpriseHubIdentity = typeof EnterpriseHubIdentity.Type;

/** The hub identity of a connected IDE, with the hub it came from. */
export const EnterpriseIdentity = Schema.Struct({
  ...EnterpriseHubIdentity.fields,
  hubEnvironmentId: EnvironmentId,
});
export type EnterpriseIdentity = typeof EnterpriseIdentity.Type;

export const EnterpriseIngestStartInput = Schema.Struct({
  folder: TrimmedNonEmptyString,
  modelSelection: ModelSelection,
});
export type EnterpriseIngestStartInput = typeof EnterpriseIngestStartInput.Type;

export const EnterpriseIngestStartResult = Schema.Struct({
  runId: Schema.String,
  threadId: Schema.String,
});
export type EnterpriseIngestStartResult = typeof EnterpriseIngestStartResult.Type;

export const EnterpriseStatus = Schema.Struct({
  identity: Schema.NullOr(EnterpriseIdentity),
  configured: Schema.optionalKey(Schema.Boolean),
});
export type EnterpriseStatus = typeof EnterpriseStatus.Type;

export const EnterpriseLoginInput = Schema.Struct({
  email: TrimmedNonEmptyString,
  token: Schema.optionalKey(TrimmedNonEmptyString),
});
export type EnterpriseLoginInput = typeof EnterpriseLoginInput.Type;

export const EnterpriseConnectInput = Schema.Union([
  Schema.Struct({ link: PeerLinkCreateInput, ...EnterpriseLoginInput.fields }),
  Schema.Struct({ hubUrl: TrimmedNonEmptyString, ...EnterpriseLoginInput.fields }),
  EnterpriseLoginInput,
]);
export type EnterpriseConnectInput = typeof EnterpriseConnectInput.Type;

export const EnterpriseBootstrapResult = Schema.Struct({
  identity: EnterpriseHubIdentity,
  environmentId: EnvironmentId,
  label: Schema.String,
  mcpToken: TrimmedNonEmptyString,
  mcpExpiresAt: Schema.DateTimeUtcFromString,
});
export type EnterpriseBootstrapResult = typeof EnterpriseBootstrapResult.Type;

export const EnterpriseConnectResult = Schema.Struct({
  ...EnterpriseIdentity.fields,
});
export type EnterpriseConnectResult = typeof EnterpriseConnectResult.Type;

export const EnterpriseDisconnectResult = Schema.Struct({ disconnected: Schema.Boolean });
export type EnterpriseDisconnectResult = typeof EnterpriseDisconnectResult.Type;

export const EnterpriseMemberSummary = Schema.Struct({
  /** Additional areas; team membership continues to grant its own area. */
  areaIds: Schema.optionalKey(Schema.Array(TrimmedNonEmptyString)),
  email: TrimmedNonEmptyString,
  displayName: TrimmedNonEmptyString,
  teamId: Schema.NullOr(TrimmedNonEmptyString),
  role: TeamMemberRole,
  /** False once an admin revoked the email. */
  active: Schema.Boolean,
});
export type EnterpriseMemberSummary = typeof EnterpriseMemberSummary.Type;

export const EnterpriseTeamSummary = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
});
export type EnterpriseTeamSummary = typeof EnterpriseTeamSummary.Type;

export const EnterpriseMembers = Schema.Struct({
  members: Schema.Array(EnterpriseMemberSummary),
  teams: Schema.Array(EnterpriseTeamSummary),
});
export type EnterpriseMembers = typeof EnterpriseMembers.Type;

/** Authorizes the email, or changes its display name, team and role, and un-revokes it. */
export const EnterpriseAuthorizeMemberInput = Schema.Struct({
  /** Omit to preserve grants; an empty array removes all additional areas. */
  areaIds: Schema.optionalKey(Schema.Array(TrimmedNonEmptyString)),
  email: TrimmedNonEmptyString,
  displayName: TrimmedNonEmptyString,
  teamId: Schema.NullOr(TrimmedNonEmptyString),
  role: TeamMemberRole,
});
export type EnterpriseAuthorizeMemberInput = typeof EnterpriseAuthorizeMemberInput.Type;

export const EnterpriseRevokeMemberInput = Schema.Struct({ email: TrimmedNonEmptyString });
export type EnterpriseRevokeMemberInput = typeof EnterpriseRevokeMemberInput.Type;

/** The org chart any enrolled member may read: names and roles, no emails. */
export const EnterpriseOrgMember = Schema.Struct({
  memberKey: Schema.optionalKey(TrimmedNonEmptyString),
  displayName: TrimmedNonEmptyString,
  role: TeamMemberRole,
  isMe: Schema.Boolean,
  /** The `memberKey` of the person this member reports to. */
  reportsTo: Schema.optionalKey(Schema.NullOr(TrimmedNonEmptyString)),
});
export type EnterpriseOrgMember = typeof EnterpriseOrgMember.Type;

export const EnterpriseOrgTeam = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  /** The caller belongs to this team or holds an approved grant to its area. */
  access: Schema.Literals(["member", "granted", "none"]),
  members: Schema.Array(EnterpriseOrgMember),
  description: Schema.optionalKey(Schema.String),
  /** The area's lead, who approves access to it; may sit in another team. */
  lead: Schema.optionalKey(
    Schema.NullOr(
      Schema.Struct({ memberKey: TrimmedNonEmptyString, displayName: TrimmedNonEmptyString }),
    ),
  ),
});
export type EnterpriseOrgTeam = typeof EnterpriseOrgTeam.Type;

export const EnterpriseOrg = Schema.Struct({ teams: Schema.Array(EnterpriseOrgTeam) });
export type EnterpriseOrg = typeof EnterpriseOrg.Type;

/** The two YAML files an admin fills in: `organization.yaml` and `areas.yaml`. */
export const EnterpriseOrgFiles = Schema.Struct({
  organization: Schema.String.check(Schema.isMaxLength(1_000_000)),
  areas: Schema.String.check(Schema.isMaxLength(1_000_000)),
});
export type EnterpriseOrgFiles = typeof EnterpriseOrgFiles.Type;

export const EnterpriseOrgChange = Schema.Struct({
  kind: Schema.Literals(["area", "person"]),
  change: Schema.Literals(["added", "changed", "removed"]),
  /** Area id or person email; only admins ever see an import. */
  id: TrimmedNonEmptyString,
  name: Schema.String,
  /** Changed fields, e.g. `area`, `role`, `reportsTo`; empty for added and removed. */
  fields: Schema.Array(Schema.String),
});
export type EnterpriseOrgChange = typeof EnterpriseOrgChange.Type;

export const EnterpriseOrgImportResult = Schema.Struct({
  applied: Schema.Boolean,
  changes: Schema.Array(EnterpriseOrgChange),
});
export type EnterpriseOrgImportResult = typeof EnterpriseOrgImportResult.Type;

/** Knowledge levels a conversation can switch off; the individual level has no source yet. */
export const ThreadKnowledgeScope = Schema.Literals(["general", "area"]);
export type ThreadKnowledgeScope = typeof ThreadKnowledgeScope.Type;

export const ThreadContextInput = Schema.Struct({ threadId: TrimmedNonEmptyString });
export type ThreadContextInput = typeof ThreadContextInput.Type;

export const ThreadContextCard = Schema.Struct({
  scope: ThreadKnowledgeScope,
  /** False once the conversation's access to this level was turned off. */
  enabled: Schema.Boolean,
  documents: Schema.Array(
    Schema.Struct({
      path: TrimmedNonEmptyString,
      title: TrimmedNonEmptyString,
      areaId: TrimmedNonEmptyString,
      /** True when an agent turn of this conversation read the document. */
      loaded: Schema.Boolean,
      /** The area choice, independent of the whole-level switch. */
      enabled: Schema.optionalKey(Schema.Boolean),
    }),
  ),
});
export type ThreadContextCard = typeof ThreadContextCard.Type;

export const ThreadContext = Schema.Struct({ cards: Schema.Array(ThreadContextCard) });
export type ThreadContext = typeof ThreadContext.Type;

export const ThreadContextSetInput = Schema.Struct({
  /** Select one area within the area level; omit to switch the whole level. */
  areaId: Schema.optionalKey(TrimmedNonEmptyString),
  threadId: TrimmedNonEmptyString,
  scope: ThreadKnowledgeScope,
  enabled: Schema.Boolean,
});
export type ThreadContextSetInput = typeof ThreadContextSetInput.Type;

export class EnterpriseError extends Schema.TaggedError<EnterpriseError>()("EnterpriseError", {
  code: Schema.Literals([
    "invalid_token",
    "not_authorized",
    "admin_required",
    "not_connected",
    "hub_unreachable",
    "unknown_team",
    "document_not_found",
    "access_denied",
    "invalid_proposal",
    "ingestion_failed",
    "proposal_not_found",
    "conflict",
    "knowledge_write_failed",
    "thread_not_found",
    "snapshot_unavailable",
    "org_invalid_yaml",
    "org_invalid",
    "org_unknown_area",
    "org_unknown_person",
    "org_duplicate_email",
    "org_duplicate_lead",
    "org_reports_to_cycle",
  ]),
  message: Schema.String,
}) {}
