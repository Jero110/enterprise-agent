import {
  type VerifiedIdentity,
  type KnowledgeDocument,
  type AreaMembership,
  type AreaRequest,
  type TeamPrincipal,
  type AreaId,
  AreaKnowledgeError,
  PREAUTHORIZED_ADMIN_EMAIL,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HashMap from "effect/HashMap";
import * as Ref from "effect/Ref";
import * as SecureRandom from "effect/crypto/SecureRandom";

import * as TeamIdentity from "../auth/TeamIdentity.ts";

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
- Ask questions when unsure

## Project Overview

T3 Code is a minimal GUI for coding agents. We support multiple providers including Codex, Claude, Cursor, Grok, and OpenCode.

## Contact

For general questions, reach out to the team on our internal channels.`,
  },
  {
    id: "doc-auth",
    areaId: "auth",
    title: "Authentication Area Context",
    content: `# Authentication Area Context

This document is restricted to the Auth team area.

## Authentication Architecture

Our authentication system uses:
- Google OAuth for identity verification
- Server-side token validation
- Session-based access control

## Admin Responsibilities

Administrators can:
- Authorize new team members
- Manage area permissions
- View usage statistics

## Security Notes

Never expose credentials in logs or client code.`,
  },
  {
    id: "doc-no-mail",
    areaId: "no-mail",
    title: "No-Mail Area Context",
    content: `# No-Mail Area Context

This document is restricted to the No-Mail team area.

## Offline Development

This area covers development scenarios without email verification:
- Local development testing
- Anonymous dev identity (Gerry)
- Isolated environment testing

## Testing Guidelines

When testing with anonymous identity:
- Use only for local development
- Never use in production
- Verify area permissions work correctly`,
  },
];

interface AreaKnowledgeState {
  readonly memberships: HashMap.HashMap<string, AreaMembership>;
  readonly requests: HashMap.HashMap<string, AreaRequest>;
}

const makeInitialState = (): AreaKnowledgeState => ({
  memberships: HashMap.empty(),
  requests: HashMap.empty(),
});

const normalizeEmail = (email: string): string => email.toLowerCase().trim();

const membershipKey = (email: string, areaId: AreaId): string =>
  `${normalizeEmail(email)}:${areaId}`;

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
  areaId === "general" || principal.areaIds.includes(areaId);

export const layer = Layer.effect(
  AreaKnowledge,
  Effect.gen(function* () {
    yield* TeamIdentity.TeamIdentity;
    const secureRandom = yield* SecureRandom.SecureRandom;
    const stateRef = yield* Ref.make(makeInitialState());

    const getPrincipal: AreaKnowledgeService["getPrincipal"] = Effect.fn(
      "AreaKnowledge.getPrincipal",
    )(function* (identity) {
      const state = yield* Ref.get(stateRef);
      const email = normalizeEmail(identity.email);
      const isAdmin = normalizeEmail(PREAUTHORIZED_ADMIN_EMAIL) === email;
      const isAnonymousDev = identity.source === "anonymous-dev";

      const baseAreas: AreaId[] = [];

      if (isAdmin) {
        baseAreas.push("auth");
      }

      if (isAnonymousDev) {
        baseAreas.push("no-mail");
      }

      const grantedAreas: AreaId[] = [];
      for (const [key, membership] of HashMap.entries(state.memberships)) {
        if (key.startsWith(`${email}:`)) {
          grantedAreas.push(membership.areaId);
        }
      }

      const areaIds = [...new Set([...baseAreas, ...grantedAreas])];

      return {
        email: identity.email,
        displayName: identity.displayName,
        isAdmin,
        areaIds,
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

      const state = yield* Ref.get(stateRef);
      for (const [, request] of HashMap.entries(state.requests)) {
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

      yield* Ref.update(stateRef, (s) => ({
        ...s,
        requests: HashMap.set(s.requests, id, request),
      }));

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

      const state = yield* Ref.get(stateRef);
      const request = HashMap.get(state.requests, requestId);

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

      let newMemberships = state.memberships;

      if (status === "approved") {
        const key = membershipKey(request.value.email, request.value.areaId);
        const membership: AreaMembership = {
          email: request.value.email,
          areaId: request.value.areaId,
          grantedAt: now,
          grantedBy: adminPrincipal.email,
        };
        newMemberships = HashMap.set(newMemberships, key, membership);
      }

      yield* Ref.update(stateRef, (s) => ({
        ...s,
        requests: HashMap.set(s.requests, requestId, updatedRequest),
        memberships: newMemberships,
      }));

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

      const key = membershipKey(email, areaId);

      yield* Ref.update(stateRef, (s) => ({
        ...s,
        memberships: HashMap.remove(s.memberships, key),
      }));
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
