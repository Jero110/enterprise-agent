import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

/** `general` or a team id. */
export const AreaId = TrimmedNonEmptyString;
export type AreaId = typeof AreaId.Type;

export const AreaRequestStatus = Schema.Literals(["pending", "approved", "denied"]);
export type AreaRequestStatus = typeof AreaRequestStatus.Type;

export const KnowledgeLayer = Schema.Literals(["metrics", "business", "ai", "data"]);
export type KnowledgeLayer = typeof KnowledgeLayer.Type;

export const KnowledgeNodeMetadata = Schema.Struct({
  description: Schema.String,
  layer: KnowledgeLayer,
  private: Schema.Boolean,
  links: Schema.Array(Schema.String),
});

export const PersonalKnowledgeKind = Schema.Literals(["skill", "node"]);

export const KnowledgeGraphNode = Schema.Struct({
  id: TrimmedNonEmptyString,
  areaId: AreaId,
  title: TrimmedNonEmptyString,
  ...KnowledgeNodeMetadata.fields,
  accessible: Schema.Boolean,
  itemKind: Schema.optionalKey(PersonalKnowledgeKind),
  content: Schema.optionalKey(Schema.String),
});
export const KnowledgeGraph = Schema.Struct({ nodes: Schema.Array(KnowledgeGraphNode) });
export type KnowledgeGraph = typeof KnowledgeGraph.Type;

export const KnowledgeDocument = Schema.Struct({
  id: TrimmedNonEmptyString,
  areaId: AreaId,
  title: TrimmedNonEmptyString,
  content: Schema.String,
  itemKind: Schema.optionalKey(PersonalKnowledgeKind),
  description: Schema.optionalKey(Schema.String),
  layer: Schema.optionalKey(KnowledgeLayer),
  private: Schema.optionalKey(Schema.Boolean),
  links: Schema.optionalKey(Schema.Array(Schema.String)),
});
export type KnowledgeDocument = typeof KnowledgeDocument.Type;

/** What a list shows: no body. `id` is the document's path in the knowledge repo. */
export const KnowledgeDocumentSummary = Schema.Struct({
  id: TrimmedNonEmptyString,
  areaId: AreaId,
  title: TrimmedNonEmptyString,
});
export type KnowledgeDocumentSummary = typeof KnowledgeDocumentSummary.Type;

export const KnowledgeShareGrantee = Schema.Struct({
  kind: Schema.Literals(["member", "area"]),
  target: TrimmedNonEmptyString,
});
export type KnowledgeShareGrantee = typeof KnowledgeShareGrantee.Type;
export const PersonalKnowledgeItem = Schema.Struct({
  kind: PersonalKnowledgeKind,
  title: TrimmedNonEmptyString,
  description: Schema.String,
  layer: KnowledgeLayer,
  content: Schema.String.check(Schema.isMaxLength(200_000)),
});
export const KnowledgePublishPersonalInput = Schema.Struct({
  path: TrimmedNonEmptyString,
  item: PersonalKnowledgeItem,
});
export type KnowledgePublishPersonalInput = typeof KnowledgePublishPersonalInput.Type;
export const KnowledgeShareInput = Schema.Struct({
  path: TrimmedNonEmptyString,
  grantee: KnowledgeShareGrantee,
});
export type KnowledgeShareInput = typeof KnowledgeShareInput.Type;
export const KnowledgeShareRevokeInput = Schema.Struct({
  path: TrimmedNonEmptyString,
  grantee: KnowledgeShareGrantee,
});
export type KnowledgeShareRevokeInput = typeof KnowledgeShareRevokeInput.Type;
export const KnowledgeSharing = Schema.Struct({
  sharedByMe: Schema.Array(
    Schema.Struct({
      ...KnowledgeDocumentSummary.fields,
      itemKind: Schema.optionalKey(PersonalKnowledgeKind),
      grants: Schema.Array(KnowledgeShareGrantee),
    }),
  ),
  sharedWithMe: Schema.Array(
    Schema.Struct({
      ...KnowledgeDocumentSummary.fields,
      itemKind: Schema.optionalKey(PersonalKnowledgeKind),
    }),
  ),
});
export type KnowledgeSharing = typeof KnowledgeSharing.Type;

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

const EnterpriseCliKnowledgeOffset = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
export const EnterpriseCliKnowledgeListInput = Schema.Struct({
  cursor: Schema.optionalKey(EnterpriseCliKnowledgeOffset),
});
export const EnterpriseCliKnowledgeListResult = Schema.Struct({
  ...KnowledgeDocumentList.fields,
  nextCursor: Schema.NullOr(EnterpriseCliKnowledgeOffset),
});
export const EnterpriseCliKnowledgeGetInput = Schema.Struct({
  ...KnowledgeGetInput.fields,
  textOffset: Schema.optionalKey(EnterpriseCliKnowledgeOffset),
});
export const EnterpriseCliKnowledgeGetResult = Schema.Struct({
  ...KnowledgeDocument.fields,
  nextTextOffset: Schema.NullOr(EnterpriseCliKnowledgeOffset),
});

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
