import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { expect, it, describe } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Exit from "effect/Exit";
import * as SecureRandom from "effect/crypto/SecureRandom";

import { PREAUTHORIZED_ADMIN_EMAIL } from "@t3tools/contracts";

import * as TeamDirectory from "./TeamDirectory.ts";
import * as TeamIdentity from "../auth/TeamIdentity.ts";
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
    Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-team-directory-test-" })),
    Layer.provide(baseLayer),
  );

const layerTeamDirectory = (overrides?: Partial<ServerConfig.ServerConfig["Service"]>) =>
  TeamDirectory.layer.pipe(
    Layer.provideMerge(TeamIdentity.layer),
    Layer.provideMerge(layerSeededStore),
    Layer.provideMerge(layerServerConfig(overrides)),
    Layer.provideMerge(baseLayer),
  );

describe("TeamDirectory", () => {
  describe("listMembers", () => {
    it.effect("lists preauthorized admin", () =>
      Effect.gen(function* () {
        const directory = yield* TeamDirectory.TeamDirectory;
        const identity = yield* TeamIdentity.TeamIdentity;

        const adminIdentity = yield* identity.verifyGoogleToken({
          token: TeamIdentity.createFakeGoogleToken({
            email: PREAUTHORIZED_ADMIN_EMAIL,
            sub: "google-jero",
            name: "Jero",
          }),
        });

        const principal = yield* directory.getPrincipal(adminIdentity);
        const members = yield* directory.listMembers(principal);

        expect(members.length).toBeGreaterThanOrEqual(1);
        const admin = members.find((m) => m.email === PREAUTHORIZED_ADMIN_EMAIL.toLowerCase());
        expect(admin).toBeDefined();
        expect(admin?.isAdmin).toBe(true);
      }).pipe(Effect.provide(layerTeamDirectory())),
    );

    it.effect("anonymous dev is not a member: no team and no admin rights", () =>
      Effect.gen(function* () {
        const directory = yield* TeamDirectory.TeamDirectory;
        const identity = yield* TeamIdentity.TeamIdentity;

        const anonIdentity = yield* identity.getAnonymousDevIdentity();
        const principal = yield* directory.getPrincipal(anonIdentity);
        const members = yield* directory.listMembers(principal);

        expect(principal.isAnonymousDev).toBe(true);
        expect(principal.isAdmin).toBe(false);
        expect(principal.teamId).toBeUndefined();
        expect(members.some((m) => m.isAnonymousDev)).toBe(false);
      }).pipe(Effect.provide(layerTeamDirectory({ devUrl: new URL("http://localhost:5173") }))),
    );
  });

  describe("teams", () => {
    it.effect("admin can create a team", () =>
      Effect.gen(function* () {
        const directory = yield* TeamDirectory.TeamDirectory;
        const identity = yield* TeamIdentity.TeamIdentity;

        const adminIdentity = yield* identity.verifyGoogleToken({
          token: TeamIdentity.createFakeGoogleToken({
            email: PREAUTHORIZED_ADMIN_EMAIL,
            sub: "google-jero",
            name: "Jero",
          }),
        });

        const principal = yield* directory.getPrincipal(adminIdentity);
        const team = yield* directory.createTeam(principal, { name: "Engineering" });

        expect(team.name).toBe("Engineering");
      }).pipe(Effect.provide(layerTeamDirectory())),
    );

    it.effect("admin can move member to a team", () =>
      Effect.gen(function* () {
        const directory = yield* TeamDirectory.TeamDirectory;
        const identity = yield* TeamIdentity.TeamIdentity;

        const adminIdentity = yield* identity.verifyGoogleToken({
          token: TeamIdentity.createFakeGoogleToken({
            email: PREAUTHORIZED_ADMIN_EMAIL,
            sub: "google-jero",
            name: "Jero",
          }),
        });

        const principal = yield* directory.getPrincipal(adminIdentity);
        const team = yield* directory.createTeam(principal, { name: "Engineering" });

        yield* directory.moveMemberToTeam(principal, "ent.test.bruno@gmail.com", team.id);

        const members = yield* directory.listMembers(principal);
        const user = members.find((m) => m.email === "ent.test.bruno@gmail.com");
        expect(user?.teamId).toBe(team.id);
        expect(user?.teamName).toBe("Engineering");
      }).pipe(Effect.provide(layerTeamDirectory())),
    );

    it.effect("non-admin cannot create a team", () =>
      Effect.gen(function* () {
        const directory = yield* TeamDirectory.TeamDirectory;
        const identity = yield* TeamIdentity.TeamIdentity;

        const userIdentity = yield* identity.verifyGoogleToken({
          token: TeamIdentity.createFakeGoogleToken({
            email: "ent.test.bruno@gmail.com",
            sub: "google-user",
            name: "User",
          }),
        });

        const principal = yield* directory.getPrincipal(userIdentity);
        const result = yield* directory
          .createTeam(principal, { name: "Hacking" })
          .pipe(Effect.exit);

        expect(Exit.isFailure(result)).toBe(true);
      }).pipe(Effect.provide(layerTeamDirectory())),
    );
  });

  describe("usage stats", () => {
    it.effect("admin can view any member's usage", () =>
      Effect.gen(function* () {
        const directory = yield* TeamDirectory.TeamDirectory;
        const identity = yield* TeamIdentity.TeamIdentity;

        const userIdentity = yield* identity.verifyGoogleToken({
          token: TeamIdentity.createFakeGoogleToken({
            email: "ent.test.bruno@gmail.com",
            sub: "google-user",
            name: "User",
          }),
        });
        yield* directory.registerMember(userIdentity);

        const adminIdentity = yield* identity.verifyGoogleToken({
          token: TeamIdentity.createFakeGoogleToken({
            email: PREAUTHORIZED_ADMIN_EMAIL,
            sub: "google-jero",
            name: "Jero",
          }),
        });

        const principal = yield* directory.getPrincipal(adminIdentity);
        const usage = yield* directory.getMemberUsage(principal, "ent.test.bruno@gmail.com");

        expect(usage.email).toBe("ent.test.bruno@gmail.com");
        expect(usage.today.conversations).toBe(0);
      }).pipe(Effect.provide(layerTeamDirectory())),
    );

    it.effect("non-admin can view own usage", () =>
      Effect.gen(function* () {
        const directory = yield* TeamDirectory.TeamDirectory;
        const identity = yield* TeamIdentity.TeamIdentity;

        const userIdentity = yield* identity.verifyGoogleToken({
          token: TeamIdentity.createFakeGoogleToken({
            email: "ent.test.bruno@gmail.com",
            sub: "google-user",
            name: "User",
          }),
        });
        yield* directory.registerMember(userIdentity);

        const principal = yield* directory.getPrincipal(userIdentity);
        const usage = yield* directory.getMemberUsage(principal, "ent.test.bruno@gmail.com");

        expect(usage.email).toBe("ent.test.bruno@gmail.com");
      }).pipe(Effect.provide(layerTeamDirectory())),
    );

    it.effect("non-admin cannot view other member's usage", () =>
      Effect.gen(function* () {
        const directory = yield* TeamDirectory.TeamDirectory;
        const identity = yield* TeamIdentity.TeamIdentity;

        const user1Identity = yield* identity.verifyGoogleToken({
          token: TeamIdentity.createFakeGoogleToken({
            email: "user1@example.com",
            sub: "google-user1",
            name: "User 1",
          }),
        });
        yield* directory.registerMember(user1Identity);

        const user2Identity = yield* identity.verifyGoogleToken({
          token: TeamIdentity.createFakeGoogleToken({
            email: "user2@example.com",
            sub: "google-user2",
            name: "User 2",
          }),
        });
        yield* directory.registerMember(user2Identity);

        const principal = yield* directory.getPrincipal(user1Identity);
        const result = yield* directory
          .getMemberUsage(principal, "user2@example.com")
          .pipe(Effect.exit);

        expect(Exit.isFailure(result)).toBe(true);
      }).pipe(Effect.provide(layerTeamDirectory())),
    );
  });
});
