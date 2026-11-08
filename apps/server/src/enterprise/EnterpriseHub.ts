import {
  EnterpriseError,
  type KnowledgeProposeInput,
  type KnowledgeProposal,
  type KnowledgeProposalInbox,
  type KnowledgeProposalDecision,
  type KnowledgeProposalInboxInput,
  type KnowledgeUploadInput,
  type KnowledgeAttachmentInput,
  type KnowledgeAttachment,
  type EnterpriseAuthorizeMemberInput,
  type EnterpriseHubIdentity,
  type EnterpriseMembers,
  type EnterpriseOrg,
  type EnterpriseRevokeMemberInput,
  type KnowledgeDocument,
  type KnowledgeDocumentList,
  type KnowledgeGetInput,
  type KnowledgeSearchInput,
  type KnowledgeSearchResult,
} from "@t3tools/contracts";
import { teamMemberKey } from "@t3tools/shared/teamMemberKey";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as AreaKnowledge from "../knowledge/AreaKnowledge.ts";
import * as EnterpriseStore from "./EnterpriseStore.ts";
import * as KnowledgeProposals from "./KnowledgeProposals.ts";

/**
 * The hub never sees a member's environment id, so calls are keyed by the MCP
 * caller's `sessionId`, which `enroll` binds to an email (stored as the
 * enrollment's `environmentId`). Access is re-read on each call, so a revoke bites at once.
 */
export class EnterpriseHub extends Context.Service<
  EnterpriseHub,
  {
    readonly ingestionInbox: (
      threadId: string,
      input: KnowledgeProposalInboxInput,
    ) => Effect.Effect<KnowledgeProposalInbox, EnterpriseError>;
    readonly ingestionList: (
      threadId: string,
    ) => Effect.Effect<KnowledgeDocumentList, EnterpriseError>;
    readonly ingestionGet: (
      threadId: string,
      input: KnowledgeGetInput,
    ) => Effect.Effect<KnowledgeDocument, EnterpriseError>;
    readonly ingestionPropose: (
      threadId: string,
      input: KnowledgeProposeInput,
    ) => Effect.Effect<KnowledgeProposal, EnterpriseError>;
    readonly knowledgePropose: (
      sessionId: string,
      input: KnowledgeProposeInput,
    ) => Effect.Effect<KnowledgeProposal, EnterpriseError>;
    readonly proposalUpload: (
      sessionId: string,
      input: KnowledgeUploadInput,
    ) => Effect.Effect<KnowledgeProposal, EnterpriseError>;
    readonly proposalAttachment: (
      sessionId: string,
      input: KnowledgeAttachmentInput,
    ) => Effect.Effect<KnowledgeAttachment, EnterpriseError>;
    readonly proposalInbox: (
      sessionId: string,
      input: KnowledgeProposalInboxInput,
    ) => Effect.Effect<KnowledgeProposalInbox, EnterpriseError>;
    readonly proposalDecide: (
      sessionId: string,
      input: KnowledgeProposalDecision,
    ) => Effect.Effect<KnowledgeProposal, EnterpriseError>;
    readonly authenticate: (input: {
      readonly email: string;
      readonly token?: string | undefined;
    }) => Effect.Effect<EnterpriseHubIdentity, EnterpriseError>;
    readonly enroll: (
      sessionId: string,
      input: { readonly email: string; readonly token?: string | undefined },
    ) => Effect.Effect<EnterpriseHubIdentity, EnterpriseError>;
    readonly whoami: (sessionId: string) => Effect.Effect<EnterpriseHubIdentity, EnterpriseError>;
    readonly disconnect: (sessionId: string) => Effect.Effect<boolean>;
    readonly listMembers: (sessionId: string) => Effect.Effect<EnterpriseMembers, EnterpriseError>;
    /** Teams with their active members, for any enrolled member; the caller's access is marked. */
    readonly org: (sessionId: string) => Effect.Effect<EnterpriseOrg, EnterpriseError>;
    readonly authorize: (
      sessionId: string,
      input: EnterpriseAuthorizeMemberInput,
    ) => Effect.Effect<EnterpriseMembers, EnterpriseError>;
    readonly revoke: (
      sessionId: string,
      input: EnterpriseRevokeMemberInput,
    ) => Effect.Effect<EnterpriseMembers, EnterpriseError>;
    /** Knowledge calls are scoped by the enrolled member's team and grants, re-read each call. */
    readonly knowledgeList: (
      sessionId: string,
    ) => Effect.Effect<KnowledgeDocumentList, EnterpriseError>;
    readonly knowledgeSearch: (
      sessionId: string,
      input: KnowledgeSearchInput,
    ) => Effect.Effect<KnowledgeSearchResult, EnterpriseError>;
    readonly knowledgeGet: (
      sessionId: string,
      input: KnowledgeGetInput,
    ) => Effect.Effect<KnowledgeDocument, EnterpriseError>;
  }
>()("t3/enterprise/EnterpriseHub") {}

const notAuthorized = new EnterpriseError({
  code: "not_authorized",
  message: "This email is not authorized for this enterprise. Ask an admin to authorize it.",
});

const make = Effect.gen(function* () {
  const store = yield* EnterpriseStore.EnterpriseStore;
  const knowledge = yield* AreaKnowledge.AreaKnowledge;
  const proposals = yield* KnowledgeProposals.KnowledgeProposals;

  const identityOf = Effect.fn("EnterpriseHub.identityOf")(function* (email: string) {
    const member = yield* store.getMember(email);
    if (member === null || !(yield* store.canEnter(email))) return yield* notAuthorized;
    const team = member.teamId === null ? null : yield* store.getTeam(member.teamId);
    return {
      email: member.email,
      displayName: member.displayName,
      teamId: member.teamId,
      teamName: team?.name ?? null,
      role: member.role,
    } satisfies EnterpriseHubIdentity;
  });

  const whoami: EnterpriseHub["Service"]["whoami"] = Effect.fn("EnterpriseHub.whoami")(
    function* (sessionId) {
      const enrollment = yield* store.getEnrollment(sessionId);
      if (enrollment === null) {
        return yield* new EnterpriseError({
          code: "not_connected",
          message:
            "This session is not connected to the enterprise. Connect with your email and token.",
        });
      }
      return yield* identityOf(enrollment.email);
    },
  );

  const authenticate: EnterpriseHub["Service"]["authenticate"] = Effect.fn(
    "EnterpriseHub.authenticate",
  )(function* (input) {
    // Email membership is the gate; a token is only checked when one is sent.
    if (input.token !== undefined && !(yield* store.verifyToken(input.token))) {
      return yield* new EnterpriseError({
        code: "invalid_token",
        message: "The enterprise token is wrong.",
      });
    }
    return yield* identityOf(input.email);
  });

  const enroll: EnterpriseHub["Service"]["enroll"] = Effect.fn("EnterpriseHub.enroll")(
    function* (sessionId, input) {
      const identity = yield* authenticate(input);
      yield* store.enroll({ environmentId: sessionId, email: identity.email });
      return identity;
    },
  );

  const disconnect: EnterpriseHub["Service"]["disconnect"] = (sessionId) =>
    store.unenroll(sessionId);

  const requireAdmin = Effect.fn("EnterpriseHub.requireAdmin")(function* (sessionId: string) {
    const identity = yield* whoami(sessionId);
    if (identity.role !== "admin") {
      return yield* new EnterpriseError({
        code: "admin_required",
        message: "Only enterprise admins can manage members.",
      });
    }
    return identity;
  });

  const members = Effect.fn("EnterpriseHub.members")(function* () {
    return {
      members: (yield* store.listMembers).map((member) => ({
        email: member.email,
        displayName: member.displayName,
        teamId: member.teamId,
        role: member.role,
        active: member.authorized && !member.revoked,
      })),
      teams: (yield* store.listTeams).map(({ id, name }) => ({ id, name })),
    } satisfies EnterpriseMembers;
  });

  const listMembers: EnterpriseHub["Service"]["listMembers"] = Effect.fn(
    "EnterpriseHub.listMembers",
  )(function* (sessionId) {
    yield* requireAdmin(sessionId);
    return yield* members();
  });

  const org: EnterpriseHub["Service"]["org"] = Effect.fn("EnterpriseHub.org")(
    function* (sessionId) {
      const me = yield* whoami(sessionId);
      const granted = new Set((yield* store.listGrants(me.email)).map((grant) => grant.areaId));
      const active = (yield* store.listMembers).filter(
        (member) => member.authorized && !member.revoked,
      );
      return {
        teams: (yield* store.listTeams).map((team) => ({
          id: team.id,
          name: team.name,
          access:
            me.teamId === team.id
              ? ("member" as const)
              : granted.has(team.id)
                ? ("granted" as const)
                : ("none" as const),
          members: active
            .filter((member) => member.teamId === team.id)
            .map((member) => ({
              displayName: member.displayName,
              memberKey: teamMemberKey(member.email),
              role: member.role,
              isMe: member.email === me.email,
            })),
        })),
      } satisfies EnterpriseOrg;
    },
  );

  const authorize: EnterpriseHub["Service"]["authorize"] = Effect.fn("EnterpriseHub.authorize")(
    function* (sessionId, input) {
      const admin = yield* requireAdmin(sessionId);
      if (input.teamId !== null && (yield* store.getTeam(input.teamId)) === null) {
        return yield* new EnterpriseError({
          code: "unknown_team",
          message: `There is no team "${input.teamId}".`,
        });
      }
      yield* store.upsertMember({ ...input, authorizedBy: admin.email });
      return yield* members();
    },
  );

  const revoke: EnterpriseHub["Service"]["revoke"] = Effect.fn("EnterpriseHub.revoke")(
    function* (sessionId, input) {
      const admin = yield* requireAdmin(sessionId);
      if (EnterpriseStore.normalizeEmail(input.email) === admin.email) {
        return yield* new EnterpriseError({
          code: "not_authorized",
          message: "Admins cannot revoke themselves.",
        });
      }
      yield* store.revokeMember(input.email);
      return yield* members();
    },
  );

  const principalOf = Effect.fn("EnterpriseHub.principalOf")(function* (sessionId: string) {
    const identity = yield* whoami(sessionId);
    const principal = yield* knowledge.getMemberPrincipal(identity.email);
    return principal === null ? yield* notAuthorized : principal;
  });

  const knowledgeList: EnterpriseHub["Service"]["knowledgeList"] = Effect.fn(
    "EnterpriseHub.knowledgeList",
  )(function* (sessionId) {
    return { documents: yield* knowledge.listDocuments(yield* principalOf(sessionId)) };
  });

  const knowledgeSearch: EnterpriseHub["Service"]["knowledgeSearch"] = Effect.fn(
    "EnterpriseHub.knowledgeSearch",
  )(function* (sessionId, input) {
    return { hits: yield* knowledge.searchDocuments(yield* principalOf(sessionId), input.query) };
  });

  const knowledgeGet: EnterpriseHub["Service"]["knowledgeGet"] = Effect.fn(
    "EnterpriseHub.knowledgeGet",
  )(function* (sessionId, input) {
    return yield* knowledge.readDocument(yield* principalOf(sessionId), input.path).pipe(
      Effect.mapError(
        ({ code, message }) =>
          new EnterpriseError({
            code: code === "access_denied" ? "access_denied" : "document_not_found",
            message,
          }),
      ),
    );
  });

  const ingestionIdentity = Effect.fn("EnterpriseHub.ingestionIdentity")(function* (
    threadId: string,
  ) {
    const run = yield* store.getIngestionRun(threadId);
    if (run === null || run.status !== "running")
      return yield* new EnterpriseError({
        code: "access_denied",
        message: "Only ingestion threads can propose as an admin.",
      });
    const member = yield* store.getMember(run.adminEmail);
    if (member?.role !== "admin" || !(yield* store.canEnter(run.adminEmail)))
      return yield* new EnterpriseError({
        code: "access_denied",
        message: "The ingestion admin no longer has access.",
      });
    return { run, member };
  });
  return EnterpriseHub.of({
    ingestionInbox: Effect.fn("EnterpriseHub.ingestionInbox")(function* (threadId, input) {
      const { member } = yield* ingestionIdentity(threadId);
      return yield* proposals.inbox(member.email, input);
    }),
    ingestionList: Effect.fn("EnterpriseHub.ingestionList")(function* (threadId) {
      const { member } = yield* ingestionIdentity(threadId);
      const principal = yield* knowledge.getMemberPrincipal(member.email);
      if (principal === null) return yield* notAuthorized;
      return { documents: yield* knowledge.listDocuments(principal) };
    }),
    ingestionGet: Effect.fn("EnterpriseHub.ingestionGet")(function* (threadId, input) {
      const { member } = yield* ingestionIdentity(threadId);
      const principal = yield* knowledge.getMemberPrincipal(member.email);
      if (principal === null) return yield* notAuthorized;
      return yield* knowledge.readDocument(principal, input.path).pipe(
        Effect.mapError(
          ({ code, message }) =>
            new EnterpriseError({
              code: code === "access_denied" ? "access_denied" : "document_not_found",
              message,
            }),
        ),
      );
    }),
    ingestionPropose: Effect.fn("EnterpriseHub.ingestionPropose")(function* (threadId, input) {
      const { run, member } = yield* ingestionIdentity(threadId);
      return yield* proposals.propose(
        member.email,
        {
          ...input,
          evidence: [...new Set([...input.evidence, `ingestion:${run.id}`])],
        },
        true,
      );
    }),
    knowledgePropose: Effect.fn("EnterpriseHub.knowledgePropose")(function* (sessionId, input) {
      return yield* proposals.propose((yield* whoami(sessionId)).email, input);
    }),
    proposalUpload: Effect.fn("EnterpriseHub.proposalUpload")(function* (sessionId, input) {
      return yield* proposals.uploadEncoded((yield* whoami(sessionId)).email, input);
    }),
    proposalAttachment: Effect.fn("EnterpriseHub.proposalAttachment")(function* (sessionId, input) {
      const file = yield* proposals.readAttachment(
        (yield* whoami(sessionId)).email,
        input.proposalId,
        input.fileId,
      );
      return {
        name: file.name,
        mimeType: file.mimeType,
        base64: Buffer.from(file.bytes).toString("base64"),
      };
    }),
    proposalInbox: Effect.fn("EnterpriseHub.proposalInbox")(function* (sessionId, input) {
      return yield* proposals.inbox((yield* whoami(sessionId)).email, input);
    }),
    proposalDecide: Effect.fn("EnterpriseHub.proposalDecide")(function* (sessionId, input) {
      return yield* proposals.decide((yield* whoami(sessionId)).email, input);
    }),
    authenticate,
    enroll,
    whoami,
    disconnect,
    listMembers,
    org,
    authorize,
    revoke,
    knowledgeList,
    knowledgeSearch,
    knowledgeGet,
  });
});

export const layer = Layer.effect(EnterpriseHub, make);
