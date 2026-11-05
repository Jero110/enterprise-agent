import {
  type VerifiedIdentity,
  type TeamMember,
  TeamIdentityError,
  type TeamMemberRole,
  ANONYMOUS_DEV_EMAIL,
  ANONYMOUS_DEV_DISPLAY_NAME,
  type AuthorizeMemberInput,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HashMap from "effect/HashMap";
import * as Ref from "effect/Ref";
import * as SecureRandom from "effect/crypto/SecureRandom";

import * as ServerConfig from "../config.ts";
import * as EnterpriseStore from "../enterprise/EnterpriseStore.ts";

const FAKE_TOKEN_PREFIX = "fake-google-token:";

export interface FakeGoogleTokenPayload {
  readonly email: string;
  readonly sub: string;
  readonly name: string;
}

export const createFakeGoogleToken = (payload: FakeGoogleTokenPayload): string =>
  `${FAKE_TOKEN_PREFIX}${JSON.stringify(payload)}`;

const parseFakeGoogleToken = (token: string): FakeGoogleTokenPayload | null => {
  if (!token.startsWith(FAKE_TOKEN_PREFIX)) return null;
  try {
    return JSON.parse(token.slice(FAKE_TOKEN_PREFIX.length)) as FakeGoogleTokenPayload;
  } catch {
    return null;
  }
};

type SessionId = string;

type Sessions = HashMap.HashMap<SessionId, VerifiedIdentity>;

export interface TeamIdentityService {
  readonly verifyGoogleToken: (input: {
    readonly token: string;
  }) => Effect.Effect<VerifiedIdentity, TeamIdentityError>;

  readonly canEnterTeam: (identity: VerifiedIdentity) => Effect.Effect<boolean>;

  readonly getMemberRole: (email: string) => Effect.Effect<TeamMemberRole | null>;

  readonly authorizeMember: (
    actor: VerifiedIdentity,
    input: AuthorizeMemberInput,
  ) => Effect.Effect<TeamMember, TeamIdentityError>;

  readonly deauthorizeMember: (
    actor: VerifiedIdentity,
    email: string,
  ) => Effect.Effect<void, TeamIdentityError>;

  readonly getAnonymousDevIdentity: () => Effect.Effect<VerifiedIdentity, TeamIdentityError>;

  readonly createSession: (identity: VerifiedIdentity) => Effect.Effect<SessionId>;

  readonly getSessionIdentity: (
    sessionId: SessionId,
  ) => Effect.Effect<VerifiedIdentity, TeamIdentityError>;

  readonly revokeSession: (sessionId: SessionId) => Effect.Effect<void>;
}

export class TeamIdentity extends Context.Service<TeamIdentity, TeamIdentityService>()(
  "t3/auth/TeamIdentity",
) {}

const normalizeEmail = EnterpriseStore.normalizeEmail;

const toTeamMember = (member: EnterpriseStore.EnterpriseMember): TeamMember => ({
  email: member.email,
  displayName: member.displayName,
  role: member.role,
  ...(member.teamId === null ? {} : { teamId: member.teamId }),
  authorizedAt: member.authorizedAt,
  authorizedBy: member.authorizedBy,
});

export const layer = Layer.effect(
  TeamIdentity,
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const secureRandom = yield* SecureRandom.SecureRandom;
    const store = yield* EnterpriseStore.EnterpriseStore;
    const sessionsRef = yield* Ref.make<Sessions>(HashMap.empty());

    const verifyGoogleToken: TeamIdentityService["verifyGoogleToken"] = Effect.fn(
      "TeamIdentity.verifyGoogleToken",
    )(function* (input) {
      const fakePayload = parseFakeGoogleToken(input.token);
      if (fakePayload) {
        const now = yield* DateTime.now;
        return {
          email: normalizeEmail(fakePayload.email),
          displayName: fakePayload.name,
          source: "google",
          subject: fakePayload.sub,
          verifiedAt: now,
        } satisfies VerifiedIdentity;
      }

      return yield* new TeamIdentityError({
        code: "invalid_token",
        message:
          "Real Google OIDC verification requires OAuth configuration. Use fake tokens for testing.",
      });
    });

    const canEnterTeam: TeamIdentityService["canEnterTeam"] = Effect.fn(
      "TeamIdentity.canEnterTeam",
    )(function* (identity) {
      return yield* store.canEnter(identity.email);
    });

    const getMemberRole: TeamIdentityService["getMemberRole"] = Effect.fn(
      "TeamIdentity.getMemberRole",
    )(function* (email) {
      if (!(yield* store.canEnter(email))) return null;
      const member = yield* store.getMember(email);
      return member?.role ?? null;
    });

    const authorizeMember: TeamIdentityService["authorizeMember"] = Effect.fn(
      "TeamIdentity.authorizeMember",
    )(function* (actor, input) {
      const actorRole = yield* getMemberRole(actor.email);
      if (actorRole !== "admin") {
        return yield* new TeamIdentityError({
          code: "admin_required",
          message: "Only administrators can authorize new members.",
        });
      }

      if (yield* store.canEnter(input.email)) {
        return yield* new TeamIdentityError({
          code: "already_authorized",
          message: `Email ${input.email} is already authorized.`,
        });
      }

      const member = yield* store.upsertMember({
        email: input.email,
        displayName: input.displayName,
        teamId: input.teamId ?? null,
        role: input.role,
        authorizedBy: actor.email,
      });
      return toTeamMember(member);
    });

    const deauthorizeMember: TeamIdentityService["deauthorizeMember"] = Effect.fn(
      "TeamIdentity.deauthorizeMember",
    )(function* (actor, email) {
      const actorRole = yield* getMemberRole(actor.email);
      if (actorRole !== "admin") {
        return yield* new TeamIdentityError({
          code: "admin_required",
          message: "Only administrators can deauthorize members.",
        });
      }

      if (normalizeEmail(email) === normalizeEmail(actor.email)) {
        return yield* new TeamIdentityError({
          code: "not_authorized",
          message: "Administrators cannot deauthorize themselves.",
        });
      }

      yield* store.revokeMember(email);
    });

    const isDevelopment = config.devUrl !== undefined;

    const getAnonymousDevIdentity: TeamIdentityService["getAnonymousDevIdentity"] = Effect.fn(
      "TeamIdentity.getAnonymousDevIdentity",
    )(function* () {
      if (!isDevelopment) {
        return yield* new TeamIdentityError({
          code: "anonymous_not_allowed",
          message: "Anonymous identity is only available in development mode.",
        });
      }

      const now = yield* DateTime.now;
      return {
        email: ANONYMOUS_DEV_EMAIL,
        displayName: ANONYMOUS_DEV_DISPLAY_NAME,
        source: "anonymous-dev",
        subject: "anonymous-dev-gerry",
        verifiedAt: now,
      } satisfies VerifiedIdentity;
    });

    const createSession: TeamIdentityService["createSession"] = Effect.fn(
      "TeamIdentity.createSession",
    )(function* (identity) {
      const sessionId = yield* secureRandom.uuidV4();

      yield* Ref.update(sessionsRef, HashMap.set(sessionId, identity));

      return sessionId;
    });

    const getSessionIdentity: TeamIdentityService["getSessionIdentity"] = Effect.fn(
      "TeamIdentity.getSessionIdentity",
    )(function* (sessionId) {
      const sessions = yield* Ref.get(sessionsRef);
      const identity = HashMap.get(sessions, sessionId);

      if (identity._tag === "None") {
        return yield* new TeamIdentityError({
          code: "not_authorized",
          message: "Session not found or has been revoked.",
        });
      }

      if (
        identity.value.source !== "anonymous-dev" &&
        !(yield* store.canEnter(identity.value.email))
      ) {
        return yield* new TeamIdentityError({
          code: "not_authorized",
          message: "This email is no longer authorized.",
        });
      }

      return identity.value;
    });

    const revokeSession: TeamIdentityService["revokeSession"] = Effect.fn(
      "TeamIdentity.revokeSession",
    )(function* (sessionId) {
      yield* Ref.update(sessionsRef, HashMap.remove(sessionId));
    });

    return {
      verifyGoogleToken,
      canEnterTeam,
      getMemberRole,
      authorizeMember,
      deauthorizeMember,
      getAnonymousDevIdentity,
      createSession,
      getSessionIdentity,
      revokeSession,
    } satisfies TeamIdentityService;
  }),
);
