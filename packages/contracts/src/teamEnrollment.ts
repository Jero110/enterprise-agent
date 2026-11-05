import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

export const InvitationStatus = Schema.Literals(["active", "revoked", "expired", "redeemed"]);
export type InvitationStatus = typeof InvitationStatus.Type;

export const TeamInvitation = Schema.Struct({
  id: TrimmedNonEmptyString,
  teamId: TrimmedNonEmptyString,
  teamName: TrimmedNonEmptyString,
  secret: TrimmedNonEmptyString,
  status: InvitationStatus,
  createdBy: TrimmedNonEmptyString,
  createdAt: Schema.DateTimeUtc,
  expiresAt: Schema.DateTimeUtc,
  maxUses: Schema.Number,
  uses: Schema.Number,
});
export type TeamInvitation = typeof TeamInvitation.Type;

export const EnrollmentStatus = Schema.Literals(["enrolled", "pending", "none"]);
export type EnrollmentStatus = typeof EnrollmentStatus.Type;

export const TeamEnrollment = Schema.Struct({
  environmentId: TrimmedNonEmptyString,
  teamId: TrimmedNonEmptyString,
  teamName: TrimmedNonEmptyString,
  enrolledAt: Schema.DateTimeUtc,
  enrolledBy: TrimmedNonEmptyString,
});
export type TeamEnrollment = typeof TeamEnrollment.Type;

export class TeamEnrollmentError extends Schema.TaggedError<TeamEnrollmentError>()(
  "TeamEnrollmentError",
  {
    code: Schema.Literals([
      "invitation_not_found",
      "invitation_expired",
      "invitation_revoked",
      "invitation_exhausted",
      "already_enrolled",
      "admin_required",
      "not_enrolled",
      "not_authorized",
      "team_mismatch",
    ]),
    message: Schema.String,
  },
) {}

export const CreateInvitationInput = Schema.Struct({
  teamId: TrimmedNonEmptyString,
  teamName: TrimmedNonEmptyString,
  maxUses: Schema.optional(Schema.Number),
  expiresInHours: Schema.optional(Schema.Number),
});
export type CreateInvitationInput = typeof CreateInvitationInput.Type;

export const RedeemInvitationInput = Schema.Struct({
  secret: TrimmedNonEmptyString,
});
export type RedeemInvitationInput = typeof RedeemInvitationInput.Type;

export const EnrollmentResult = Schema.Struct({
  teamId: TrimmedNonEmptyString,
  teamName: TrimmedNonEmptyString,
  status: EnrollmentStatus,
});
export type EnrollmentResult = typeof EnrollmentResult.Type;
