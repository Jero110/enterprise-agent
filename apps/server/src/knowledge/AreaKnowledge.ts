import {
  type VerifiedIdentity,
  type KnowledgeDocument,
  type KnowledgeGraph,
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
import * as KnowledgeProposals from "../enterprise/KnowledgeProposals.ts";

import * as EnterpriseStore from "../enterprise/EnterpriseStore.ts";
import { GENERAL_AREA, KnowledgeRepo } from "./KnowledgeRepo.ts";

export interface AreaKnowledgeService {
  readonly getPrincipal: (identity: VerifiedIdentity) => Effect.Effect<TeamPrincipal>;

  /** The principal of an enrolled member's email, or null when the email cannot enter. */
  readonly getMemberPrincipal: (email: string) => Effect.Effect<TeamPrincipal | null>;

  readonly graph: (principal: TeamPrincipal) => Effect.Effect<KnowledgeGraph>;

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
  principal.isAdmin || areaId === GENERAL_AREA || principal.areaIds.includes(areaId);

export const layer = Layer.effect(
  AreaKnowledge,
  Effect.gen(function* () {
    const store = yield* EnterpriseStore.EnterpriseStore;
    const proposals = yield* KnowledgeProposals.KnowledgeProposals;

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

    const graph = Effect.fn("AreaKnowledge.graph")(function* (principal: TeamPrincipal) {
      const current = yield* getMemberPrincipal(principal.email);
      if (current === null) return { nodes: [] };
      return {
        nodes: (yield* repo.documents).map((doc) => {
          const accessible = canReadDocument(current, doc.areaId);
          return {
            id: doc.id,
            areaId: doc.areaId,
            title: doc.title,
            description: doc.description ?? "",
            layer: doc.layer ?? ("business" as const),
            private: doc.private ?? doc.areaId !== GENERAL_AREA,
            links: doc.links ?? [],
            accessible,
            ...(accessible ? { content: doc.content } : {}),
          };
        }),
      };
    });

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
      const current = yield* getMemberPrincipal(principal.email);
      if (current?.areaIds.includes(areaId))
        return yield* new AreaKnowledgeError({
          code: "already_has_access",
          message: "You already have access to this area.",
        });
      const proposal = yield* proposals
        .propose(principal.email, {
          kind: "area-access",
          scope: areaId,
          path: "",
          reason: "Request area knowledge access",
          evidence: [],
        })
        .pipe(
          Effect.mapError(
            (error) =>
              new AreaKnowledgeError({
                code: error.code === "conflict" ? "request_already_exists" : "access_denied",
                message: error.message,
              }),
          ),
        );
      return {
        id: proposal.id,
        email: proposal.proposedBy,
        areaId: proposal.scope,
        status: "pending",
        requestedAt: DateTime.makeUnsafe(proposal.createdAt),
      };
    });

    const resolveRequest: AreaKnowledgeService["resolveRequest"] = Effect.fn(
      "AreaKnowledge.resolveRequest",
    )(function* (principal, requestId, status) {
      const request = (yield* store.listProposals).find(
        (p) => p.id === requestId && p.kind === "area-access",
      );
      if (!request)
        return yield* new AreaKnowledgeError({
          code: "request_not_found",
          message: "Request not found.",
        });
      const proposal = yield* proposals
        .decide(principal.email, {
          id: requestId,
          action: status === "approved" ? "approve" : "reject",
          reason: "Area access request denied",
        })
        .pipe(
          Effect.mapError(
            (error) =>
              new AreaKnowledgeError({
                code: error.code === "access_denied" ? "admin_required" : "request_not_found",
                message: error.message,
              }),
          ),
        );
      return {
        id: proposal.id,
        email: proposal.proposedBy,
        areaId: proposal.scope,
        status,
        requestedAt: DateTime.makeUnsafe(proposal.createdAt),
        resolvedAt: DateTime.makeUnsafe(proposal.resolvedAt!),
        resolvedBy: proposal.resolvedBy!,
      };
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
      graph,
      listDocuments,
      searchDocuments,
      readDocument,
      requestAreaAccess,
      resolveRequest,
      revokeAreaAccess,
    } satisfies AreaKnowledgeService;
  }),
);
