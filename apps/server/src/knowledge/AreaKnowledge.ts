import {
  type VerifiedIdentity,
  type KnowledgeDocument,
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

const DOCUMENTS: ReadonlyArray<KnowledgeDocument> = [
  {
    id: "doc-general",
    areaId: "general",
    title: "General Company Context",
    content: `# General Company Context

This document contains general information available to all team members.

## Team Guidelines

- Be respectful and collaborative
- Document your work
- Ask questions when unsure`,
  },
  {
    id: "doc-ledger",
    areaId: "ledger",
    title: "Ledger Area Context",
    content: `# Ledger Area Context

This document is restricted to the Ledger team.

## Scope

Ledger owns the transaction ledger services: balance reads, transaction history and the ledger writer.`,
  },
  {
    id: "doc-frontend",
    areaId: "frontend",
    title: "Frontend Area Context",
    content: `# Frontend Area Context

This document is restricted to the Frontend team.

## Scope

Frontend owns the web UI that customers use to sign in, view balances and send payments.`,
  },
];

const GENERAL_AREA = "general";

const normalizeEmail = EnterpriseStore.normalizeEmail;

export interface AreaKnowledgeService {
  readonly getPrincipal: (identity: VerifiedIdentity) => Effect.Effect<TeamPrincipal>;

  readonly listDocuments: (
    principal: TeamPrincipal,
  ) => Effect.Effect<ReadonlyArray<KnowledgeDocument>>;

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

const canReadDocument = (principal: TeamPrincipal, areaId: AreaId): boolean =>
  areaId === GENERAL_AREA || principal.areaIds.includes(areaId);

export const layer = Layer.effect(
  AreaKnowledge,
  Effect.gen(function* () {
    const store = yield* EnterpriseStore.EnterpriseStore;
    const secureRandom = yield* SecureRandom.SecureRandom;
    const requestsRef = yield* Ref.make<HashMap.HashMap<string, AreaRequest>>(HashMap.empty());

    const getPrincipal: AreaKnowledgeService["getPrincipal"] = Effect.fn(
      "AreaKnowledge.getPrincipal",
    )(function* (identity) {
      const isAnonymousDev = identity.source === "anonymous-dev";
      const member = (yield* store.canEnter(identity.email))
        ? yield* store.getMember(identity.email)
        : null;
      const isAdmin = member?.role === "admin";

      const areaIds: AreaId[] = [];
      if (isAdmin) {
        areaIds.push(...(yield* store.listTeams).map((team) => team.id));
      } else if (member) {
        if (member.teamId !== null) areaIds.push(member.teamId);
        areaIds.push(...(yield* store.listGrants(member.email)).map((grant) => grant.areaId));
      }

      return {
        email: identity.email,
        displayName: identity.displayName,
        isAdmin,
        areaIds: [...new Set(areaIds)],
        isAnonymousDev,
      } satisfies TeamPrincipal;
    });

    const listDocuments: AreaKnowledgeService["listDocuments"] = (principal) =>
      Effect.succeed(DOCUMENTS.filter((doc) => canReadDocument(principal, doc.areaId)));

    const readDocument: AreaKnowledgeService["readDocument"] = Effect.fn(
      "AreaKnowledge.readDocument",
    )(function* (principal, documentId) {
      const doc = DOCUMENTS.find((d) => d.id === documentId);

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
      listDocuments,
      readDocument,
      requestAreaAccess,
      resolveRequest,
      revokeAreaAccess,
    } satisfies AreaKnowledgeService;
  }),
);
