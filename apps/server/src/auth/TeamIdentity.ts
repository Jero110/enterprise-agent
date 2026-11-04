import {
  type VerifiedIdentity,
  type TeamMember,
  TeamIdentityError,
  type TeamMemberRole,
  PREAUTHORIZED_ADMIN_EMAIL,
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

interface TeamIdentityState {
  readonly authorizedMembers: HashMap.HashMap<string, TeamMember>;
  readonly sessions: HashMap.HashMap<SessionId, VerifiedIdentity>;
}

const makeInitialState = (): TeamIdentityState => ({
  authorizedMembers: HashMap.empty(),
  sessions: HashMap.empty(),
});

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

const normalizeEmail = (email: string): string => email.toLowerCase().trim();

const isPreauthorizedAdmin = (email: string): boolean =>
  normalizeEmail(email) === normalizeEmail(PREAUTHORIZED_ADMIN_EMAIL);

export const layer = Layer.effect(
  TeamIdentity,
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const secureRandom = yield* SecureRandom.SecureRandom;
    const stateRef = yield* Ref.make(makeInitialState());

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
      if (isPreauthorizedAdmin(identity.email)) {
        return true;
      }

      const state = yield* Ref.get(stateRef);
      return HashMap.has(state.authorizedMembers, normalizeEmail(identity.email));
    });

    const getMemberRole: TeamIdentityService["getMemberRole"] = Effect.fn(
      "TeamIdentity.getMemberRole",
    )(function* (email) {
      const normalizedEmail = normalizeEmail(email);

      if (isPreauthorizedAdmin(normalizedEmail)) {
        return "admin" as const;
      }

      const state = yield* Ref.get(stateRef);
      const member = HashMap.get(state.authorizedMembers, normalizedEmail);
      if (member._tag === "Some") {
        return member.value.role;
      }
      return null;
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

      const normalizedEmail = normalizeEmail(input.email);
      const state = yield* Ref.get(stateRef);

      if (HashMap.has(state.authorizedMembers, normalizedEmail)) {
        return yield* new TeamIdentityError({
          code: "already_authorized",
          message: `Email ${input.email} is already authorized.`,
        });
      }

      const now = yield* DateTime.now;
      const member: TeamMember = {
        email: normalizedEmail,
        displayName: input.displayName,
        role: input.role,
        ...(input.teamId !== undefined ? { teamId: input.teamId } : {}),
        authorizedAt: now,
        authorizedBy: actor.email,
      };

      yield* Ref.update(stateRef, (s) => ({
        ...s,
        authorizedMembers: HashMap.set(s.authorizedMembers, normalizedEmail, member),
      }));

      return member;
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

      const normalizedEmail = normalizeEmail(email);

      if (isPreauthorizedAdmin(normalizedEmail)) {
        return yield* new TeamIdentityError({
          code: "not_authorized",
          message: "Cannot deauthorize the preauthorized admin.",
        });
      }

      yield* Ref.update(stateRef, (s) => ({
        ...s,
        authorizedMembers: HashMap.remove(s.authorizedMembers, normalizedEmail),
      }));
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

      yield* Ref.update(stateRef, (s) => ({
        ...s,
        sessions: HashMap.set(s.sessions, sessionId, identity),
      }));

      return sessionId;
    });

    const getSessionIdentity: TeamIdentityService["getSessionIdentity"] = Effect.fn(
      "TeamIdentity.getSessionIdentity",
    )(function* (sessionId) {
      const state = yield* Ref.get(stateRef);
      const identity = HashMap.get(state.sessions, sessionId);

      if (identity._tag === "None") {
        return yield* new TeamIdentityError({
          code: "not_authorized",
          message: "Session not found or has been revoked.",
        });
      }

      return identity.value;
    });

    const revokeSession: TeamIdentityService["revokeSession"] = Effect.fn(
      "TeamIdentity.revokeSession",
    )(function* (sessionId) {
      yield* Ref.update(stateRef, (s) => ({
        ...s,
        sessions: HashMap.remove(s.sessions, sessionId),
      }));
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
