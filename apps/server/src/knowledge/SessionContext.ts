import {
  type KnowledgeDocument,
  type KnowledgeDocumentSummary,
  type TeamPrincipal,
  type VerifiedIdentity,
  AreaKnowledgeError,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as AreaKnowledge from "./AreaKnowledge.ts";

export interface SessionContextService {
  readonly listAuthorizedDocuments: (
    identity: VerifiedIdentity,
  ) => Effect.Effect<ReadonlyArray<KnowledgeDocumentSummary>>;
  readonly readAuthorizedDocument: (
    identity: VerifiedIdentity,
    documentId: string,
  ) => Effect.Effect<KnowledgeDocument, AreaKnowledgeError>;
  readonly listForPrincipal: (
    principal: TeamPrincipal,
  ) => Effect.Effect<ReadonlyArray<KnowledgeDocumentSummary>>;
  readonly readForPrincipal: (
    principal: TeamPrincipal,
    documentId: string,
  ) => Effect.Effect<KnowledgeDocument, AreaKnowledgeError>;
}

export class SessionContext extends Context.Service<SessionContext, SessionContextService>()(
  "t3/knowledge/SessionContext",
) {}

/**
 * The MCP adapter calls readAuthorizedDocument instead of accessing fixture files,
 * so agent reads follow the same permission check as the session context panel.
 */
export const layer = Layer.effect(
  SessionContext,
  Effect.gen(function* () {
    const knowledge = yield* AreaKnowledge.AreaKnowledge;

    const listForPrincipal: SessionContextService["listForPrincipal"] = knowledge.listDocuments;
    const readForPrincipal: SessionContextService["readForPrincipal"] = knowledge.readDocument;

    const listAuthorizedDocuments: SessionContextService["listAuthorizedDocuments"] = Effect.fn(
      "SessionContext.listAuthorizedDocuments",
    )(function* (identity) {
      const principal = yield* knowledge.getPrincipal(identity);
      return yield* knowledge.listDocuments(principal);
    });

    const readAuthorizedDocument: SessionContextService["readAuthorizedDocument"] = Effect.fn(
      "SessionContext.readAuthorizedDocument",
    )(function* (identity, documentId) {
      const principal = yield* knowledge.getPrincipal(identity);
      return yield* knowledge.readDocument(principal, documentId);
    });

    return {
      listAuthorizedDocuments,
      readAuthorizedDocument,
      listForPrincipal,
      readForPrincipal,
    } satisfies SessionContextService;
  }),
);
