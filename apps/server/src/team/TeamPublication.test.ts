import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { expect, it, describe } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Exit from "effect/Exit";
import * as SecureRandom from "effect/crypto/SecureRandom";

import { PREAUTHORIZED_ADMIN_EMAIL } from "@t3tools/contracts";

import * as TeamPublication from "./TeamPublication.ts";
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
    Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-team-pub-test-" })),
    Layer.provide(baseLayer),
  );

const layerTeamPublication = (overrides?: Partial<ServerConfig.ServerConfig["Service"]>) =>
  TeamPublication.layer.pipe(
    Layer.provideMerge(TeamDirectory.layer),
    Layer.provideMerge(TeamIdentity.layer),
    Layer.provideMerge(layerSeededStore),
    Layer.provideMerge(layerServerConfig(overrides)),
    Layer.provideMerge(baseLayer),
  );

describe("TeamPublication", () => {
  describe("publish", () => {
    it.effect("owner can publish thread to their team", () =>
      Effect.gen(function* () {
        const pub = yield* TeamPublication.TeamPublication;
        const directory = yield* TeamDirectory.TeamDirectory;
        const identity = yield* TeamIdentity.TeamIdentity;

        const adminIdentity = yield* identity.verifyGoogleToken({
          token: TeamIdentity.createFakeGoogleToken({
            email: PREAUTHORIZED_ADMIN_EMAIL,
            sub: "google-jero",
            name: "Jero",
          }),
        });
        yield* directory.registerMember(adminIdentity);

        const principal = yield* directory.getPrincipal(adminIdentity);
        const team = yield* directory.createTeam(principal, { name: "Engineering" });
        yield* directory.moveMemberToTeam(principal, PREAUTHORIZED_ADMIN_EMAIL, team.id);
        const principalWithTeam = yield* directory.getPrincipal(adminIdentity);

        const threadId = "thread-123";
        yield* pub.registerThread(threadId, PREAUTHORIZED_ADMIN_EMAIL, "Test Thread");

        const publication = yield* pub.publishToTeam(principalWithTeam, threadId);

        expect(publication.status).toBe("published");
        expect(publication.teamId).toBe(team.id);
      }).pipe(Effect.provide(layerTeamPublication())),
    );

    it.effect("non-owner cannot publish thread", () =>
      Effect.gen(function* () {
        const pub = yield* TeamPublication.TeamPublication;
        const directory = yield* TeamDirectory.TeamDirectory;
        const identity = yield* TeamIdentity.TeamIdentity;

        const ownerIdentity = yield* identity.verifyGoogleToken({
          token: TeamIdentity.createFakeGoogleToken({
            email: "ent.test.bruno@gmail.com",
            sub: "google-owner",
            name: "Owner",
          }),
        });
        yield* directory.registerMember(ownerIdentity);

        const otherIdentity = yield* identity.verifyGoogleToken({
          token: TeamIdentity.createFakeGoogleToken({
            email: "ent.test.hugo@gmail.com",
            sub: "google-other",
            name: "Other",
          }),
        });
        yield* directory.registerMember(otherIdentity);

        const threadId = "thread-456";
        yield* pub.registerThread(threadId, "ent.test.bruno@gmail.com", "Owner's Thread");

        const principal = yield* directory.getPrincipal(otherIdentity);
        const result = yield* pub.publishToTeam(principal, threadId).pipe(Effect.exit);

        expect(Exit.isFailure(result)).toBe(true);
      }).pipe(Effect.provide(layerTeamPublication())),
    );
  });

  describe("read access", () => {
    it.effect("unpublished thread denies read to non-owner", () =>
      Effect.gen(function* () {
        const pub = yield* TeamPublication.TeamPublication;
        const directory = yield* TeamDirectory.TeamDirectory;
        const identity = yield* TeamIdentity.TeamIdentity;

        const ownerIdentity = yield* identity.verifyGoogleToken({
          token: TeamIdentity.createFakeGoogleToken({
            email: "ent.test.bruno@gmail.com",
            sub: "google-owner",
            name: "Owner",
          }),
        });
        yield* directory.registerMember(ownerIdentity);

        const otherIdentity = yield* identity.verifyGoogleToken({
          token: TeamIdentity.createFakeGoogleToken({
            email: "ent.test.hugo@gmail.com",
            sub: "google-other",
            name: "Other",
          }),
        });
        yield* directory.registerMember(otherIdentity);

        const threadId = "thread-789";
        yield* pub.registerThread(threadId, "ent.test.bruno@gmail.com", "Private Thread");

        const principal = yield* directory.getPrincipal(otherIdentity);
        const canRead = yield* pub.canReadThreadContent(principal, threadId);

        expect(canRead).toBe(false);
      }).pipe(Effect.provide(layerTeamPublication())),
    );

    it.effect("published thread allows read to team members", () =>
      Effect.gen(function* () {
        const pub = yield* TeamPublication.TeamPublication;
        const directory = yield* TeamDirectory.TeamDirectory;
        const identity = yield* TeamIdentity.TeamIdentity;

        const adminIdentity = yield* identity.verifyGoogleToken({
          token: TeamIdentity.createFakeGoogleToken({
            email: PREAUTHORIZED_ADMIN_EMAIL,
            sub: "google-jero",
            name: "Jero",
          }),
        });
        yield* directory.registerMember(adminIdentity);

        const adminPrincipal = yield* directory.getPrincipal(adminIdentity);
        const team = yield* directory.createTeam(adminPrincipal, { name: "Engineering" });

        const ownerIdentity = yield* identity.verifyGoogleToken({
          token: TeamIdentity.createFakeGoogleToken({
            email: "ent.test.bruno@gmail.com",
            sub: "google-owner",
            name: "Owner",
          }),
        });
        yield* directory.registerMember(ownerIdentity);
        yield* directory.moveMemberToTeam(adminPrincipal, "ent.test.bruno@gmail.com", team.id);

        const teammateIdentity = yield* identity.verifyGoogleToken({
          token: TeamIdentity.createFakeGoogleToken({
            email: "ent.test.carla@gmail.com",
            sub: "google-teammate",
            name: "Teammate",
          }),
        });
        yield* directory.registerMember(teammateIdentity);
        yield* directory.moveMemberToTeam(adminPrincipal, "ent.test.carla@gmail.com", team.id);

        const threadId = "thread-shared";
        yield* pub.registerThread(threadId, "ent.test.bruno@gmail.com", "Shared Thread");

        const ownerPrincipal = yield* directory.getPrincipal(ownerIdentity);
        yield* pub.publishToTeam(ownerPrincipal, threadId);

        const teammatePrincipal = yield* directory.getPrincipal(teammateIdentity);
        const canRead = yield* pub.canReadThreadContent(teammatePrincipal, threadId);

        expect(canRead).toBe(true);
      }).pipe(Effect.provide(layerTeamPublication())),
    );

    it.effect("published thread denies read to non-team members", () =>
      Effect.gen(function* () {
        const pub = yield* TeamPublication.TeamPublication;
        const directory = yield* TeamDirectory.TeamDirectory;
        const identity = yield* TeamIdentity.TeamIdentity;

        const adminIdentity = yield* identity.verifyGoogleToken({
          token: TeamIdentity.createFakeGoogleToken({
            email: PREAUTHORIZED_ADMIN_EMAIL,
            sub: "google-jero",
            name: "Jero",
          }),
        });
        yield* directory.registerMember(adminIdentity);

        const adminPrincipal = yield* directory.getPrincipal(adminIdentity);
        const team = yield* directory.createTeam(adminPrincipal, { name: "Engineering" });

        const ownerIdentity = yield* identity.verifyGoogleToken({
          token: TeamIdentity.createFakeGoogleToken({
            email: "ent.test.bruno@gmail.com",
            sub: "google-owner",
            name: "Owner",
          }),
        });
        yield* directory.registerMember(ownerIdentity);
        yield* directory.moveMemberToTeam(adminPrincipal, "ent.test.bruno@gmail.com", team.id);

        const outsiderIdentity = yield* identity.verifyGoogleToken({
          token: TeamIdentity.createFakeGoogleToken({
            email: "ent.test.hugo@gmail.com",
            sub: "google-outsider",
            name: "Outsider",
          }),
        });
        yield* directory.registerMember(outsiderIdentity);

        const threadId = "thread-team-only";
        yield* pub.registerThread(threadId, "ent.test.bruno@gmail.com", "Team Only Thread");

        const ownerPrincipal = yield* directory.getPrincipal(ownerIdentity);
        yield* pub.publishToTeam(ownerPrincipal, threadId);

        const outsiderPrincipal = yield* directory.getPrincipal(outsiderIdentity);
        const canRead = yield* pub.canReadThreadContent(outsiderPrincipal, threadId);

        expect(canRead).toBe(false);
      }).pipe(Effect.provide(layerTeamPublication())),
    );
  });

  describe("unpublish", () => {
    it.effect("owner can unpublish thread", () =>
      Effect.gen(function* () {
        const pub = yield* TeamPublication.TeamPublication;
        const directory = yield* TeamDirectory.TeamDirectory;
        const identity = yield* TeamIdentity.TeamIdentity;

        const adminIdentity = yield* identity.verifyGoogleToken({
          token: TeamIdentity.createFakeGoogleToken({
            email: PREAUTHORIZED_ADMIN_EMAIL,
            sub: "google-jero",
            name: "Jero",
          }),
        });
        yield* directory.registerMember(adminIdentity);

        const principal = yield* directory.getPrincipal(adminIdentity);
        const team = yield* directory.createTeam(principal, { name: "Engineering" });
        yield* directory.moveMemberToTeam(principal, PREAUTHORIZED_ADMIN_EMAIL, team.id);
        const principalWithTeam = yield* directory.getPrincipal(adminIdentity);

        const threadId = "thread-unpub";
        yield* pub.registerThread(threadId, PREAUTHORIZED_ADMIN_EMAIL, "To Unpublish");
        yield* pub.publishToTeam(principalWithTeam, threadId);

        const publication = yield* pub.unpublish(principalWithTeam, threadId);

        expect(publication.status).toBe("unpublished");
        expect(publication.teamId).toBeUndefined();
      }).pipe(Effect.provide(layerTeamPublication())),
    );
  });

  describe("metadata listing", () => {
    it.effect("lists thread metadata without content for non-owners", () =>
      Effect.gen(function* () {
        const pub = yield* TeamPublication.TeamPublication;
        const directory = yield* TeamDirectory.TeamDirectory;
        const identity = yield* TeamIdentity.TeamIdentity;

        const ownerIdentity = yield* identity.verifyGoogleToken({
          token: TeamIdentity.createFakeGoogleToken({
            email: "ent.test.bruno@gmail.com",
            sub: "google-owner",
            name: "Owner",
          }),
        });
        yield* directory.registerMember(ownerIdentity);

        const viewerIdentity = yield* identity.verifyGoogleToken({
          token: TeamIdentity.createFakeGoogleToken({
            email: "viewer@example.com",
            sub: "google-viewer",
            name: "Viewer",
          }),
        });
        yield* directory.registerMember(viewerIdentity);

        yield* pub.registerThread("t1", "ent.test.bruno@gmail.com", "Thread One");
        yield* pub.registerThread("t2", "ent.test.bruno@gmail.com", "Thread Two");

        const viewerPrincipal = yield* directory.getPrincipal(viewerIdentity);
        const threads = yield* pub.listThreadMetadata(viewerPrincipal);

        expect(threads.length).toBe(2);
        expect(threads.every((t) => t.publicationStatus === "unpublished")).toBe(true);
      }).pipe(Effect.provide(layerTeamPublication())),
    );
  });
});
