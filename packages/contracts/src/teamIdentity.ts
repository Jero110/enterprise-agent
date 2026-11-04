import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

export const TeamMemberRole = Schema.Literals(["admin", "member"]);
export type TeamMemberRole = typeof TeamMemberRole.Type;

export const VerifiedIdentitySource = Schema.Literals(["google", "anonymous-dev"]);
export type VerifiedIdentitySource = typeof VerifiedIdentitySource.Type;

export const VerifiedIdentity = Schema.Struct({
  email: TrimmedNonEmptyString,
  displayName: TrimmedNonEmptyString,
  source: VerifiedIdentitySource,
  subject: TrimmedNonEmptyString,
  verifiedAt: Schema.DateTimeUtc,
});
export type VerifiedIdentity = typeof VerifiedIdentity.Type;

export const TeamMember = Schema.Struct({
  email: TrimmedNonEmptyString,
  displayName: TrimmedNonEmptyString,
  role: TeamMemberRole,
  teamId: Schema.optionalKey(TrimmedNonEmptyString),
  authorizedAt: Schema.DateTimeUtc,
  authorizedBy: TrimmedNonEmptyString,
});
export type TeamMember = typeof TeamMember.Type;

export class TeamIdentityError extends Schema.TaggedError<TeamIdentityError>()(
  "TeamIdentityError",
  {
    code: Schema.Literals([
      "not_authorized",
      "admin_required",
      "invalid_token",
      "anonymous_not_allowed",
      "already_authorized",
    ]),
    message: Schema.String,
  },
) {}

export const AuthorizeMemberInput = Schema.Struct({
  email: TrimmedNonEmptyString,
  displayName: TrimmedNonEmptyString,
  role: TeamMemberRole,
  teamId: Schema.optionalKey(TrimmedNonEmptyString),
});
export type AuthorizeMemberInput = typeof AuthorizeMemberInput.Type;

export const DeauthorizeMemberInput = Schema.Struct({
  email: TrimmedNonEmptyString,
});
export type DeauthorizeMemberInput = typeof DeauthorizeMemberInput.Type;

export const PREAUTHORIZED_ADMIN_EMAIL = "jeronimo.deli@gmail.com";
export const ANONYMOUS_DEV_EMAIL = "gerry@dev.local";
export const ANONYMOUS_DEV_DISPLAY_NAME = "Gerry";
