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
import * as EnterpriseStore from "../enterprise/EnterpriseStore.ts";
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
  it.effect("inherits publication through subagents and revokes the whole tree", () =>
    Effect.gen(function* () {
      const pub = yield* TeamPublication.TeamPublication;
      const owner = {
        email: "ent.test.hugo@gmail.com",
        displayName: "Hugo",
        isAdmin: false,
        isAnonymousDev: false,
        teamId: "frontend",
      };
      const juan = { ...owner, email: "ent.test.juan@gmail.com" };
      const ana = { ...owner, email: "ent.test.ana@gmail.com", teamId: "ledger" };
      yield* pub.registerThread("parent", owner.email, "Parent");
      yield* pub.registerThread("child", owner.email, "Child", { parentThreadId: "parent" });
      yield* pub.registerThread("grandchild", owner.email, "Grandchild", {
        parentThreadId: "child",
      });
      expect(yield* pub.canReadThreadContent(juan, "parent")).toBe(false);
      yield* pub.publishToTeam(owner, "parent");
      for (const id of ["parent", "child", "grandchild"]) {
        expect(yield* pub.canReadThreadContent(juan, id)).toBe(true);
        expect(yield* pub.canReadThreadContent(ana, id)).toBe(false);
      }
      yield* pub.registerThread("late-child", owner.email, "Late child", {
        parentThreadId: "parent",
      });
      expect(yield* pub.canReadThreadContent(juan, "late-child")).toBe(true);
      yield* pub.registerThread("parent", owner.email, "Parent renamed", { status: "active" });
      expect(yield* pub.canReadThreadContent(juan, "parent")).toBe(true);
      const summaries = yield* pub.listThreadMetadata(juan);
      expect(summaries.every((thread) => thread.publicationStatus === "published")).toBe(true);
      expect(summaries.find((thread) => thread.threadId === "parent")).toEqual({
        threadId: "parent",
        title: "Parent renamed",
        ownerEmail: owner.email,
        ownerDisplayName: "Hugo",
        status: "active",
        publicationStatus: "published",
      });
      expect(yield* pub.listThreadMetadata(ana)).toEqual([]);
      expect(
        (yield* pub.listThreadMetadata({ ...ana, email: PREAUTHORIZED_ADMIN_EMAIL })).length,
      ).toBe(4);
      yield* pub.unpublish(owner, "parent");
      for (const id of ["parent", "child", "grandchild", "late-child"]) {
        expect(yield* pub.canReadThreadContent(juan, id)).toBe(false);
      }
    }).pipe(Effect.provide(layerTeamPublication())),
  );

  it.effect("rechecks membership rather than trusting stale caller flags", () =>
    Effect.gen(function* () {
      const pub = yield* TeamPublication.TeamPublication;
      const store = yield* EnterpriseStore.EnterpriseStore;
      const hugo = {
        email: "ent.test.hugo@gmail.com",
        displayName: "Hugo",
        isAdmin: false,
        isAnonymousDev: false,
        teamId: "frontend",
      };
      const juan = { ...hugo, email: "ent.test.juan@gmail.com" };
      yield* pub.registerThread("hugo-thread", hugo.email, "Frontend work");
      yield* pub.publishToTeam(hugo, "hugo-thread");
      yield* store.moveMember(juan.email, "ledger");
      expect(yield* pub.canReadThreadContent(juan, "hugo-thread")).toBe(false);
      expect(yield* pub.listThreadMetadata({ ...juan, isAdmin: true })).toEqual([]);
      yield* store.revokeMember(hugo.email);
      expect(yield* pub.canReadThreadContent(hugo, "hugo-thread")).toBe(false);
      expect(yield* pub.listThreadMetadata(hugo)).toEqual([]);
      expect(Exit.isFailure(yield* pub.publishToTeam(hugo, "hugo-thread").pipe(Effect.exit))).toBe(
        true,
      );
    }).pipe(Effect.provide(layerTeamPublication())),
  );
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
    it.effect("limits metadata to the current team and administrators", () =>
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
            email: "ent.test.hugo@gmail.com",
            sub: "google-viewer",
            name: "Viewer",
          }),
        });
        yield* directory.registerMember(viewerIdentity);

        yield* pub.registerThread("t1", "ent.test.bruno@gmail.com", "Thread One");
        yield* pub.registerThread("t2", "ent.test.bruno@gmail.com", "Thread Two");

        const viewerPrincipal = yield* directory.getPrincipal(viewerIdentity);
        const threads = yield* pub.listThreadMetadata(viewerPrincipal);

        expect(threads).toEqual([]);
        const teammate = { ...viewerPrincipal, email: "ent.test.carla@gmail.com" };
        const summaries = yield* pub.listThreadMetadata(teammate);
        expect(summaries.map((thread) => thread.threadId)).toEqual(["t1", "t2"]);
        expect(summaries.every((thread) => thread.publicationStatus === "unpublished")).toBe(true);
      }).pipe(Effect.provide(layerTeamPublication())),
    );
  });
});
