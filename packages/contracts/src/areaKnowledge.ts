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

/** What a list shows: no body. `id` is the document's path in the knowledge repo. */
export const KnowledgeDocumentSummary = Schema.Struct({
  id: TrimmedNonEmptyString,
  areaId: AreaId,
  title: TrimmedNonEmptyString,
});
export type KnowledgeDocumentSummary = typeof KnowledgeDocumentSummary.Type;

export const KnowledgeDocumentList = Schema.Struct({
  documents: Schema.Array(KnowledgeDocumentSummary),
});
export type KnowledgeDocumentList = typeof KnowledgeDocumentList.Type;

export const KnowledgeSearchInput = Schema.Struct({ query: TrimmedNonEmptyString });
export type KnowledgeSearchInput = typeof KnowledgeSearchInput.Type;

export const KnowledgeSearchHit = Schema.Struct({
  ...KnowledgeDocumentSummary.fields,
  snippet: Schema.String,
});
export type KnowledgeSearchHit = typeof KnowledgeSearchHit.Type;

export const KnowledgeSearchResult = Schema.Struct({ hits: Schema.Array(KnowledgeSearchHit) });
export type KnowledgeSearchResult = typeof KnowledgeSearchResult.Type;

export const KnowledgeGetInput = Schema.Struct({ path: TrimmedNonEmptyString });
export type KnowledgeGetInput = typeof KnowledgeGetInput.Type;

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
