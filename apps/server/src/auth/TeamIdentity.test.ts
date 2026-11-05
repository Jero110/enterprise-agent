import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { expect, it, describe } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Exit from "effect/Exit";
import * as SecureRandom from "effect/crypto/SecureRandom";

import { PREAUTHORIZED_ADMIN_EMAIL, ANONYMOUS_DEV_EMAIL } from "@t3tools/contracts";

import * as TeamIdentity from "./TeamIdentity.ts";
import { layerSeededStore } from "../enterprise/EnterpriseStore.testkit.ts";
import * as ServerConfig from "../config.ts";

const baseLayer = Layer.mergeAll(NodeServices.layer, NodeCrypto.layer, SecureRandom.layerWebCrypto);

const layerServerConfig = (overrides?: Partial<ServerConfig.ServerConfig["Service"]>) =>
  Layer.effect(
    ServerConfig.ServerConfig,
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      return {
        ...config,
        ...overrides,
      } satisfies ServerConfig.ServerConfig["Service"];
    }),
  ).pipe(
    Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-team-identity-test-" })),
    Layer.provide(baseLayer),
  );

const layerTeamIdentity = (overrides?: Partial<ServerConfig.ServerConfig["Service"]>) =>
  TeamIdentity.layer.pipe(
    Layer.provideMerge(layerSeededStore),
    Layer.provideMerge(layerServerConfig(overrides)),
    Layer.provideMerge(baseLayer),
  );

describe("TeamIdentity", () => {
  describe("verifyGoogleToken", () => {
    it.effect("rejects unverified/browser-submitted email", () =>
      Effect.gen(function* () {
        const service = yield* TeamIdentity.TeamIdentity;
        const result = yield* service
          .verifyGoogleToken({ token: "fake-token-from-browser" })
          .pipe(Effect.exit);

        expect(Exit.isFailure(result)).toBe(true);
      }).pipe(Effect.provide(layerTeamIdentity())),
    );

    it.effect("accepts valid token and extracts verified identity", () =>
      Effect.gen(function* () {
        const service = yield* TeamIdentity.TeamIdentity;
        const fakeValidToken = TeamIdentity.createFakeGoogleToken({
          email: "test@example.com",
          sub: "google-123",
          name: "Test User",
        });

        const identity = yield* service.verifyGoogleToken({ token: fakeValidToken });

        expect(identity.email).toBe("test@example.com");
        expect(identity.source).toBe("google");
        expect(identity.subject).toBe("google-123");
      }).pipe(Effect.provide(layerTeamIdentity())),
    );
  });

  describe("canEnterTeam", () => {
    it.effect("preauthorized admin email is always allowed", () =>
      Effect.gen(function* () {
        const service = yield* TeamIdentity.TeamIdentity;
        const identity = yield* service.verifyGoogleToken({
          token: TeamIdentity.createFakeGoogleToken({
            email: PREAUTHORIZED_ADMIN_EMAIL,
            sub: "google-jero",
            name: "Jero",
          }),
        });

        const canEnter = yield* service.canEnterTeam(identity);
        expect(canEnter).toBe(true);
      }).pipe(Effect.provide(layerTeamIdentity())),
    );

    it.effect("unauthorized email is denied", () =>
      Effect.gen(function* () {
        const service = yield* TeamIdentity.TeamIdentity;
        const identity = yield* service.verifyGoogleToken({
          token: TeamIdentity.createFakeGoogleToken({
            email: "random@example.com",
            sub: "google-random",
            name: "Random User",
          }),
        });

        const canEnter = yield* service.canEnterTeam(identity);
        expect(canEnter).toBe(false);
      }).pipe(Effect.provide(layerTeamIdentity())),
    );

    it.effect("case-normalized email matching works", () =>
      Effect.gen(function* () {
        const service = yield* TeamIdentity.TeamIdentity;
        const identity = yield* service.verifyGoogleToken({
          token: TeamIdentity.createFakeGoogleToken({
            email: "JERONIMO.DELI@GMAIL.COM",
            sub: "google-jero-upper",
            name: "Jero",
          }),
        });

        const canEnter = yield* service.canEnterTeam(identity);
        expect(canEnter).toBe(true);
      }).pipe(Effect.provide(layerTeamIdentity())),
    );
  });

  describe("admin allowlist mutation", () => {
    it.effect("admin can authorize an email", () =>
      Effect.gen(function* () {
        const service = yield* TeamIdentity.TeamIdentity;
        const adminIdentity = yield* service.verifyGoogleToken({
          token: TeamIdentity.createFakeGoogleToken({
            email: PREAUTHORIZED_ADMIN_EMAIL,
            sub: "google-jero",
            name: "Jero",
          }),
        });

        yield* service.authorizeMember(adminIdentity, {
          email: "newuser@example.com",
          displayName: "New User",
          role: "member",
        });

        const newUserIdentity = yield* service.verifyGoogleToken({
          token: TeamIdentity.createFakeGoogleToken({
            email: "newuser@example.com",
            sub: "google-newuser",
            name: "New User",
          }),
        });

        const canEnter = yield* service.canEnterTeam(newUserIdentity);
        expect(canEnter).toBe(true);
      }).pipe(Effect.provide(layerTeamIdentity())),
    );

    it.effect("non-admin cannot authorize an email", () =>
      Effect.gen(function* () {
        const service = yield* TeamIdentity.TeamIdentity;

        yield* service.authorizeMember(
          yield* service.verifyGoogleToken({
            token: TeamIdentity.createFakeGoogleToken({
              email: PREAUTHORIZED_ADMIN_EMAIL,
              sub: "google-jero",
              name: "Jero",
            }),
          }),
          {
            email: "member@example.com",
            displayName: "Member",
            role: "member",
          },
        );

        const memberIdentity = yield* service.verifyGoogleToken({
          token: TeamIdentity.createFakeGoogleToken({
            email: "member@example.com",
            sub: "google-member",
            name: "Member",
          }),
        });

        const result = yield* service
          .authorizeMember(memberIdentity, {
            email: "another@example.com",
            displayName: "Another",
            role: "member",
          })
          .pipe(Effect.exit);

        expect(Exit.isFailure(result)).toBe(true);
      }).pipe(Effect.provide(layerTeamIdentity())),
    );

    it.effect("non-admin cannot authorize through direct API calls", () =>
      Effect.gen(function* () {
        const service = yield* TeamIdentity.TeamIdentity;
        const nonMemberIdentity = yield* service.verifyGoogleToken({
          token: TeamIdentity.createFakeGoogleToken({
            email: "hacker@example.com",
            sub: "google-hacker",
            name: "Hacker",
          }),
        });

        const result = yield* service
          .authorizeMember(nonMemberIdentity, {
            email: "victim@example.com",
            displayName: "Victim",
            role: "admin",
          })
          .pipe(Effect.exit);

        expect(Exit.isFailure(result)).toBe(true);
      }).pipe(Effect.provide(layerTeamIdentity())),
    );
  });

  describe("anonymous identity", () => {
    it.effect("anonymous identity blocked outside Dev mode", () =>
      Effect.gen(function* () {
        const service = yield* TeamIdentity.TeamIdentity;
        const result = yield* service.getAnonymousDevIdentity().pipe(Effect.exit);

        expect(Exit.isFailure(result)).toBe(true);
      }).pipe(Effect.provide(layerTeamIdentity({ devUrl: undefined }))),
    );

    it.effect("anonymous identity allowed in Dev mode", () =>
      Effect.gen(function* () {
        const service = yield* TeamIdentity.TeamIdentity;
        const identity = yield* service.getAnonymousDevIdentity();

        expect(identity.email).toBe(ANONYMOUS_DEV_EMAIL);
        expect(identity.displayName).toBe("Gerry");
        expect(identity.source).toBe("anonymous-dev");
      }).pipe(Effect.provide(layerTeamIdentity({ devUrl: new URL("http://localhost:5173") }))),
    );
  });

  describe("logout revocation", () => {
    it.effect("logout removes former user's cached permissions", () =>
      Effect.gen(function* () {
        const service = yield* TeamIdentity.TeamIdentity;
        const identity = yield* service.verifyGoogleToken({
          token: TeamIdentity.createFakeGoogleToken({
            email: PREAUTHORIZED_ADMIN_EMAIL,
            sub: "google-jero",
            name: "Jero",
          }),
        });

        const sessionId = yield* service.createSession(identity);
        const cachedIdentity = yield* service.getSessionIdentity(sessionId);
        expect(cachedIdentity.email).toBe(PREAUTHORIZED_ADMIN_EMAIL);

        yield* service.revokeSession(sessionId);

        const result = yield* service.getSessionIdentity(sessionId).pipe(Effect.exit);
        expect(Exit.isFailure(result)).toBe(true);
      }).pipe(Effect.provide(layerTeamIdentity())),
    );
  });
});
