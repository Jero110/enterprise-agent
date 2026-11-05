import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

/** `general` or a team id. */
export const AreaId = TrimmedNonEmptyString;
export type AreaId = typeof AreaId.Type;

export const AreaRequestStatus = Schema.Literals(["pending", "approved", "denied"]);
export type AreaRequestStatus = typeof AreaRequestStatus.Type;

export const KnowledgeDocument = Schema.Struct({
  id: TrimmedNonEmptyString,
  areaId: AreaId,
  title: TrimmedNonEmptyString,
  content: Schema.String,
});
export type KnowledgeDocument = typeof KnowledgeDocument.Type;

export const AreaMembership = Schema.Struct({
  email: TrimmedNonEmptyString,
  areaId: AreaId,
  grantedAt: Schema.DateTimeUtc,
  grantedBy: TrimmedNonEmptyString,
});
export type AreaMembership = typeof AreaMembership.Type;

export const AreaRequest = Schema.Struct({
  id: TrimmedNonEmptyString,
  email: TrimmedNonEmptyString,
  areaId: AreaId,
  status: AreaRequestStatus,
  requestedAt: Schema.DateTimeUtc,
  resolvedAt: Schema.optionalKey(Schema.DateTimeUtc),
  resolvedBy: Schema.optionalKey(TrimmedNonEmptyString),
});
export type AreaRequest = typeof AreaRequest.Type;

export class AreaKnowledgeError extends Schema.TaggedError<AreaKnowledgeError>()(
  "AreaKnowledgeError",
  {
    code: Schema.Literals([
      "document_not_found",
      "access_denied",
      "admin_required",
      "request_not_found",
      "already_has_access",
      "request_already_exists",
    ]),
    message: Schema.String,
  },
) {}

export const TeamPrincipal = Schema.Struct({
  email: TrimmedNonEmptyString,
  displayName: TrimmedNonEmptyString,
  isAdmin: Schema.Boolean,
  areaIds: Schema.Array(AreaId),
  isAnonymousDev: Schema.Boolean,
});
export type TeamPrincipal = typeof TeamPrincipal.Type;
