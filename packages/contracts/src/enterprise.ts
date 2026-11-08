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

export const EnterpriseStatus = Schema.Struct({ identity: Schema.NullOr(EnterpriseIdentity) });
export type EnterpriseStatus = typeof EnterpriseStatus.Type;

export const EnterpriseLoginInput = Schema.Struct({
  email: TrimmedNonEmptyString,
  token: TrimmedNonEmptyString,
});
export type EnterpriseLoginInput = typeof EnterpriseLoginInput.Type;

export const EnterpriseConnectInput = Schema.Union([
  Schema.Struct({ link: PeerLinkCreateInput, ...EnterpriseLoginInput.fields }),
  Schema.Struct({ hubUrl: TrimmedNonEmptyString, ...EnterpriseLoginInput.fields }),
]);
export type EnterpriseConnectInput = typeof EnterpriseConnectInput.Type;

export const EnterpriseBootstrapResult = Schema.Struct({
  identity: EnterpriseHubIdentity,
  environmentId: EnvironmentId,
  label: Schema.String,
  environmentToken: TrimmedNonEmptyString,
  mcpToken: TrimmedNonEmptyString,
  mcpExpiresAt: Schema.DateTimeUtcFromString,
});
export type EnterpriseBootstrapResult = typeof EnterpriseBootstrapResult.Type;

export const EnterpriseConnectResult = Schema.Struct({
  ...EnterpriseIdentity.fields,
  environmentAccess: Schema.optionalKey(
    Schema.Struct({
      environmentId: EnvironmentId,
      label: Schema.String,
      httpBaseUrl: TrimmedNonEmptyString,
      token: TrimmedNonEmptyString,
    }),
  ),
});
export type EnterpriseConnectResult = typeof EnterpriseConnectResult.Type;

export const EnterpriseDisconnectResult = Schema.Struct({ disconnected: Schema.Boolean });
export type EnterpriseDisconnectResult = typeof EnterpriseDisconnectResult.Type;

export const EnterpriseMemberSummary = Schema.Struct({
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
});
export type EnterpriseOrgMember = typeof EnterpriseOrgMember.Type;

export const EnterpriseOrgTeam = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  /** The caller belongs to this team or holds an approved grant to its area. */
  access: Schema.Literals(["member", "granted", "none"]),
  members: Schema.Array(EnterpriseOrgMember),
});
export type EnterpriseOrgTeam = typeof EnterpriseOrgTeam.Type;

export const EnterpriseOrg = Schema.Struct({ teams: Schema.Array(EnterpriseOrgTeam) });
export type EnterpriseOrg = typeof EnterpriseOrg.Type;

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
    }),
  ),
});
export type ThreadContextCard = typeof ThreadContextCard.Type;

export const ThreadContext = Schema.Struct({ cards: Schema.Array(ThreadContextCard) });
export type ThreadContext = typeof ThreadContext.Type;

export const ThreadContextSetInput = Schema.Struct({
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
  ]),
  message: Schema.String,
}) {}
