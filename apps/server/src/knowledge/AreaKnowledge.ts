import {
  type VerifiedIdentity,
  type KnowledgeDocument,
  type KnowledgeDocumentSummary,
  type KnowledgeSearchHit,
  type AreaRequest,
  type TeamPrincipal,
  type AreaId,
  AreaKnowledgeError,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HashMap from "effect/HashMap";
import * as Ref from "effect/Ref";
import * as SecureRandom from "effect/crypto/SecureRandom";

import * as EnterpriseStore from "../enterprise/EnterpriseStore.ts";
import { GENERAL_AREA, KnowledgeRepo } from "./KnowledgeRepo.ts";

const normalizeEmail = EnterpriseStore.normalizeEmail;

export interface AreaKnowledgeService {
  readonly getPrincipal: (identity: VerifiedIdentity) => Effect.Effect<TeamPrincipal>;

  /** The principal of an enrolled member's email, or null when the email cannot enter. */
  readonly getMemberPrincipal: (email: string) => Effect.Effect<TeamPrincipal | null>;

  readonly listDocuments: (
    principal: TeamPrincipal,
  ) => Effect.Effect<ReadonlyArray<KnowledgeDocumentSummary>>;

  /** Text over path, headings and body, among the documents the principal may read. */
  readonly searchDocuments: (
    principal: TeamPrincipal,
    query: string,
  ) => Effect.Effect<ReadonlyArray<KnowledgeSearchHit>>;

  readonly readDocument: (
    principal: TeamPrincipal,
    documentId: string,
  ) => Effect.Effect<KnowledgeDocument, AreaKnowledgeError>;

  readonly requestAreaAccess: (
    principal: TeamPrincipal,
    areaId: AreaId,
  ) => Effect.Effect<AreaRequest, AreaKnowledgeError>;

  readonly resolveRequest: (
    adminPrincipal: TeamPrincipal,
    requestId: string,
    status: "approved" | "denied",
  ) => Effect.Effect<AreaRequest, AreaKnowledgeError>;

  readonly revokeAreaAccess: (
    adminPrincipal: TeamPrincipal,
    email: string,
    areaId: AreaId,
  ) => Effect.Effect<void, AreaKnowledgeError>;
}

export class AreaKnowledge extends Context.Service<AreaKnowledge, AreaKnowledgeService>()(
  "t3/knowledge/AreaKnowledge",
) {}

const MAX_HITS = 20;
const SNIPPET_CHARS = 160;

/** Path matches outrank headings, which outrank body text. */
const scoreDocument = (doc: KnowledgeDocument, terms: ReadonlyArray<string>) => {
  const path = doc.id.toLowerCase();
  const lines = doc.content.split("\n");
  const headings = lines
    .filter((line) => line.startsWith("#"))
    .join("\n")
    .toLowerCase();
  const body = doc.content.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (!path.includes(term) && !body.includes(term)) return null;
    score += (path.includes(term) ? 3 : 0) + (headings.includes(term) ? 2 : 0) + 1;
  }
  const first = terms[0]!;
  const line = lines.find((l) => l.toLowerCase().includes(first)) ?? doc.title;
  return { score, snippet: line.trim().slice(0, SNIPPET_CHARS) };
};

const canReadDocument = (principal: TeamPrincipal, areaId: AreaId): boolean =>
  areaId === GENERAL_AREA || principal.areaIds.includes(areaId);

export const layer = Layer.effect(
  AreaKnowledge,
  Effect.gen(function* () {
    const store = yield* EnterpriseStore.EnterpriseStore;
    const secureRandom = yield* SecureRandom.SecureRandom;
    const requestsRef = yield* Ref.make<HashMap.HashMap<string, AreaRequest>>(HashMap.empty());

    const repo = yield* KnowledgeRepo;

    const principalOf = Effect.fn("AreaKnowledge.principalOf")(function* (
      email: string,
      displayName: string,
      isAnonymousDev: boolean,
    ) {
      const member = (yield* store.canEnter(email)) ? yield* store.getMember(email) : null;
      const isAdmin = member?.role === "admin";

      const areaIds: AreaId[] = [];
      if (isAdmin) {
        areaIds.push(...(yield* store.listTeams).map((team) => team.id));
      } else if (member) {
        if (member.teamId !== null) areaIds.push(member.teamId);
        areaIds.push(...(yield* store.listGrants(member.email)).map((grant) => grant.areaId));
      }

      return {
        email,
        displayName,
        isAdmin,
        areaIds: [...new Set(areaIds)],
        isAnonymousDev,
      } satisfies TeamPrincipal;
    });

    const getPrincipal: AreaKnowledgeService["getPrincipal"] = (identity) =>
      principalOf(identity.email, identity.displayName, identity.source === "anonymous-dev");

    const getMemberPrincipal: AreaKnowledgeService["getMemberPrincipal"] = Effect.fn(
      "AreaKnowledge.getMemberPrincipal",
    )(function* (email) {
      const member = (yield* store.canEnter(email)) ? yield* store.getMember(email) : null;
      return member === null ? null : yield* principalOf(member.email, member.displayName, false);
    });

    const readable = (principal: TeamPrincipal) =>
      Effect.map(repo.documents, (docs) =>
        docs.filter((doc) => canReadDocument(principal, doc.areaId)),
      );

    const listDocuments: AreaKnowledgeService["listDocuments"] = (principal) =>
      Effect.map(readable(principal), (docs) =>
        docs.map(({ id, areaId, title }) => ({ id, areaId, title })),
      );

    const searchDocuments: AreaKnowledgeService["searchDocuments"] = (principal, query) =>
      Effect.map(readable(principal), (docs) => {
        const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
        if (terms.length === 0) return [];
        return docs
          .flatMap((doc) => {
            const match = scoreDocument(doc, terms);
            return match === null
              ? []
              : [
                  {
                    score: match.score,
                    hit: {
                      id: doc.id,
                      areaId: doc.areaId,
                      title: doc.title,
                      snippet: match.snippet,
                    },
                  },
                ];
          })
          .toSorted((a, b) => b.score - a.score || a.hit.id.localeCompare(b.hit.id))
          .slice(0, MAX_HITS)
          .map((entry) => entry.hit);
      });

    const readDocument: AreaKnowledgeService["readDocument"] = Effect.fn(
      "AreaKnowledge.readDocument",
    )(function* (principal, documentId) {
      const doc = (yield* repo.documents).find((d) => d.id === documentId);

      if (!doc) {
        return yield* new AreaKnowledgeError({
          code: "document_not_found",
          message: "Document not found.",
        });
      }

      if (!canReadDocument(principal, doc.areaId)) {
        return yield* new AreaKnowledgeError({
          code: "access_denied",
          message: "You do not have access to this document.",
        });
      }

      return doc;
    });

    const requestAreaAccess: AreaKnowledgeService["requestAreaAccess"] = Effect.fn(
      "AreaKnowledge.requestAreaAccess",
    )(function* (principal, areaId) {
      if (principal.areaIds.includes(areaId)) {
        return yield* new AreaKnowledgeError({
          code: "already_has_access",
          message: "You already have access to this area.",
        });
      }

      for (const [, request] of HashMap.entries(yield* Ref.get(requestsRef))) {
        if (
          normalizeEmail(request.email) === normalizeEmail(principal.email) &&
          request.areaId === areaId &&
          request.status === "pending"
        ) {
          return yield* new AreaKnowledgeError({
            code: "request_already_exists",
            message: "You already have a pending request for this area.",
          });
        }
      }

      const now = yield* DateTime.now;
      const id = yield* secureRandom.uuidV4();

      const request: AreaRequest = {
        id,
        email: principal.email,
        areaId,
        status: "pending",
        requestedAt: now,
      };

      yield* Ref.update(requestsRef, HashMap.set(id, request));

      return request;
    });

    const resolveRequest: AreaKnowledgeService["resolveRequest"] = Effect.fn(
      "AreaKnowledge.resolveRequest",
    )(function* (adminPrincipal, requestId, status) {
      if (!adminPrincipal.isAdmin) {
        return yield* new AreaKnowledgeError({
          code: "admin_required",
          message: "Only administrators can resolve area requests.",
        });
      }

      const request = HashMap.get(yield* Ref.get(requestsRef), requestId);

      if (request._tag === "None") {
        return yield* new AreaKnowledgeError({
          code: "request_not_found",
          message: "Request not found.",
        });
      }

      const now = yield* DateTime.now;
      const updatedRequest: AreaRequest = {
        ...request.value,
        status,
        resolvedAt: now,
        resolvedBy: adminPrincipal.email,
      };

      if (status === "approved") {
        yield* store.grantArea({
          email: request.value.email,
          areaId: request.value.areaId,
          grantedBy: adminPrincipal.email,
        });
      }

      yield* Ref.update(requestsRef, HashMap.set(requestId, updatedRequest));

      return updatedRequest;
    });

    const revokeAreaAccess: AreaKnowledgeService["revokeAreaAccess"] = Effect.fn(
      "AreaKnowledge.revokeAreaAccess",
    )(function* (adminPrincipal, email, areaId) {
      if (!adminPrincipal.isAdmin) {
        return yield* new AreaKnowledgeError({
          code: "admin_required",
          message: "Only administrators can revoke area access.",
        });
      }

      yield* store.revokeArea(email, areaId);
    });

    return {
      getPrincipal,
      getMemberPrincipal,
      listDocuments,
      searchDocuments,
      readDocument,
      requestAreaAccess,
      resolveRequest,
      revokeAreaAccess,
    } satisfies AreaKnowledgeService;
  }),
);
