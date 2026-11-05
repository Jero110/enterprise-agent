import * as Schema from "effect/Schema";

import { EnvironmentId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { PeerLinkCreateInput } from "./peerLink.ts";
import { TeamMemberRole } from "./teamIdentity.ts";

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

export const EnterpriseStatus = Schema.Struct({ identity: Schema.NullOr(EnterpriseIdentity) });
export type EnterpriseStatus = typeof EnterpriseStatus.Type;

export const EnterpriseConnectInput = Schema.Struct({
  /** Links this environment to the hub's `/mcp` (T0: peer links carry member↔hub). */
  link: PeerLinkCreateInput,
  email: TrimmedNonEmptyString,
  token: TrimmedNonEmptyString,
});
export type EnterpriseConnectInput = typeof EnterpriseConnectInput.Type;

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

export class EnterpriseError extends Schema.TaggedError<EnterpriseError>()("EnterpriseError", {
  code: Schema.Literals([
    "invalid_token",
    "not_authorized",
    "admin_required",
    "not_connected",
    "hub_unreachable",
    "unknown_team",
  ]),
  message: Schema.String,
}) {}
