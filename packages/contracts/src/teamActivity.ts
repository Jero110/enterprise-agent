import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

export const Team = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  createdAt: Schema.DateTimeUtc,
  createdBy: TrimmedNonEmptyString,
});
export type Team = typeof Team.Type;

export const TeamMemberInfo = Schema.Struct({
  email: TrimmedNonEmptyString,
  displayName: TrimmedNonEmptyString,
  teamId: Schema.optionalKey(TrimmedNonEmptyString),
  teamName: Schema.optionalKey(TrimmedNonEmptyString),
  isAdmin: Schema.Boolean,
  isAnonymousDev: Schema.Boolean,
});
export type TeamMemberInfo = typeof TeamMemberInfo.Type;

export const UsagePeriod = Schema.Literals(["today", "week", "all-time"]);
export type UsagePeriod = typeof UsagePeriod.Type;

export const UsageStats = Schema.Struct({
  conversations: Schema.Number,
  tokens: Schema.Number,
  period: UsagePeriod,
});
export type UsageStats = typeof UsageStats.Type;

export const MemberUsage = Schema.Struct({
  email: TrimmedNonEmptyString,
  today: UsageStats,
  week: UsageStats,
  allTime: UsageStats,
});
export type MemberUsage = typeof MemberUsage.Type;

export const TeamActivity = Schema.Struct({
  environmentId: TrimmedNonEmptyString,
  memberId: TrimmedNonEmptyString,
  memberDisplayName: TrimmedNonEmptyString,
  activeAgentCount: Schema.Number,
  openConversationCount: Schema.Number,
});
export type TeamActivity = typeof TeamActivity.Type;

export const PublicationStatus = Schema.Literals(["unpublished", "published"]);
export type PublicationStatus = typeof PublicationStatus.Type;

export const ThreadPublication = Schema.Struct({
  threadId: TrimmedNonEmptyString,
  status: PublicationStatus,
  teamId: Schema.optionalKey(TrimmedNonEmptyString),
  publishedAt: Schema.optionalKey(Schema.DateTimeUtc),
  publishedBy: Schema.optionalKey(TrimmedNonEmptyString),
});
export type ThreadPublication = typeof ThreadPublication.Type;

export const ThreadMetadata = Schema.Struct({
  threadId: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  ownerEmail: TrimmedNonEmptyString,
  ownerDisplayName: TrimmedNonEmptyString,
  status: Schema.Literals(["active", "idle", "archived"]),
  publicationStatus: PublicationStatus,
});
export type ThreadMetadata = typeof ThreadMetadata.Type;

export const CrossEnvironmentGrant = Schema.Struct({
  id: TrimmedNonEmptyString,
  grantorEnvironmentId: TrimmedNonEmptyString,
  grantorEmail: TrimmedNonEmptyString,
  granteeEmail: TrimmedNonEmptyString,
  scopes: Schema.Array(Schema.Literals(["message", "start-agent"])),
  grantedAt: Schema.DateTimeUtc,
  revokedAt: Schema.optionalKey(Schema.DateTimeUtc),
});
export type CrossEnvironmentGrant = typeof CrossEnvironmentGrant.Type;

export class TeamActivityError extends Schema.TaggedError<TeamActivityError>()(
  "TeamActivityError",
  {
    code: Schema.Literals([
      "admin_required",
      "team_not_found",
      "member_not_found",
      "thread_not_found",
      "access_denied",
      "grant_not_found",
      "already_published",
      "not_published",
    ]),
    message: Schema.String,
  },
) {}
