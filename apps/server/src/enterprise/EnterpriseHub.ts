import {
  EnterpriseError,
  type EnterpriseAuthorizeMemberInput,
  type EnterpriseHubIdentity,
  type EnterpriseMembers,
  type EnterpriseRevokeMemberInput,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as EnterpriseStore from "./EnterpriseStore.ts";

/**
 * The hub never sees a member's environment id, so calls are keyed by the MCP
 * caller's `sessionId`, which `enroll` binds to an email (stored as the
 * enrollment's `environmentId`). Access is re-read on each call, so a revoke bites at once.
 */
export class EnterpriseHub extends Context.Service<
  EnterpriseHub,
  {
    readonly enroll: (
      sessionId: string,
      input: { readonly email: string; readonly token: string },
    ) => Effect.Effect<EnterpriseHubIdentity, EnterpriseError>;
    readonly whoami: (sessionId: string) => Effect.Effect<EnterpriseHubIdentity, EnterpriseError>;
    readonly disconnect: (sessionId: string) => Effect.Effect<boolean>;
    readonly listMembers: (sessionId: string) => Effect.Effect<EnterpriseMembers, EnterpriseError>;
    readonly authorize: (
      sessionId: string,
      input: EnterpriseAuthorizeMemberInput,
    ) => Effect.Effect<EnterpriseMembers, EnterpriseError>;
    readonly revoke: (
      sessionId: string,
      input: EnterpriseRevokeMemberInput,
    ) => Effect.Effect<EnterpriseMembers, EnterpriseError>;
  }
>()("t3/enterprise/EnterpriseHub") {}

const notAuthorized = new EnterpriseError({
  code: "not_authorized",
  message: "This email is not authorized for this enterprise. Ask an admin to authorize it.",
});

const make = Effect.gen(function* () {
  const store = yield* EnterpriseStore.EnterpriseStore;

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

  const enroll: EnterpriseHub["Service"]["enroll"] = Effect.fn("EnterpriseHub.enroll")(
    function* (sessionId, input) {
      // The token is checked first so a stranger cannot probe which emails exist.
      if (!(yield* store.verifyToken(input.token))) {
        return yield* new EnterpriseError({
          code: "invalid_token",
          message: "The enterprise token is wrong.",
        });
      }
      const identity = yield* identityOf(input.email);
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

  return EnterpriseHub.of({ enroll, whoami, disconnect, listMembers, authorize, revoke });
});

export const layer = Layer.effect(EnterpriseHub, make);
