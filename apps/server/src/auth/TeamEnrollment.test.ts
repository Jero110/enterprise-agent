import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { expect, it, describe } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Exit from "effect/Exit";
import * as SecureRandom from "effect/crypto/SecureRandom";

import * as TestClock from "effect/testing/TestClock";

import { PREAUTHORIZED_ADMIN_EMAIL } from "@t3tools/contracts";

import * as TeamEnrollment from "./TeamEnrollment.ts";
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
    Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-team-enrollment-test-" })),
    Layer.provide(baseLayer),
  );

const layerTeamEnrollment = (overrides?: Partial<ServerConfig.ServerConfig["Service"]>) =>
  TeamEnrollment.layer.pipe(
    Layer.provideMerge(TeamIdentity.layer),
    Layer.provideMerge(layerSeededStore),
    Layer.provideMerge(layerServerConfig(overrides)),
    Layer.provideMerge(baseLayer),
  );

describe("TeamEnrollment", () => {
  describe("createInvitation", () => {
    it.effect("admin can create an invitation", () =>
      Effect.gen(function* () {
        const enrollment = yield* TeamEnrollment.TeamEnrollment;
        const identity = yield* TeamIdentity.TeamIdentity;

        const adminIdentity = yield* identity.verifyGoogleToken({
          token: TeamIdentity.createFakeGoogleToken({
            email: PREAUTHORIZED_ADMIN_EMAIL,
            sub: "google-jero",
            name: "Jero",
          }),
        });

        const invitation = yield* enrollment.createInvitation(adminIdentity, {
          teamId: "ledger",
          teamName: "Ledger",
        });

        expect(invitation.teamId).toBe("ledger");
        expect(invitation.teamName).toBe("Ledger");
        expect(invitation.status).toBe("active");
        expect(invitation.secret).toBeDefined();
      }).pipe(Effect.provide(layerTeamEnrollment())),
    );

    it.effect("non-admin cannot create an invitation", () =>
      Effect.gen(function* () {
        const enrollment = yield* TeamEnrollment.TeamEnrollment;
        const identity = yield* TeamIdentity.TeamIdentity;

        const memberIdentity = yield* identity.verifyGoogleToken({
          token: TeamIdentity.createFakeGoogleToken({
            email: "ent.test.ana@gmail.com",
            sub: "google-member",
            name: "Member",
          }),
        });

        const result = yield* enrollment
          .createInvitation(memberIdentity, {
            teamId: "ledger",
            teamName: "Ledger",
          })
          .pipe(Effect.exit);

        expect(Exit.isFailure(result)).toBe(true);
      }).pipe(Effect.provide(layerTeamEnrollment())),
    );
  });

  describe("redeemInvitation", () => {
    it.effect("valid invitation can be redeemed", () =>
      Effect.gen(function* () {
        const enrollment = yield* TeamEnrollment.TeamEnrollment;
        const identity = yield* TeamIdentity.TeamIdentity;

        const adminIdentity = yield* identity.verifyGoogleToken({
          token: TeamIdentity.createFakeGoogleToken({
            email: PREAUTHORIZED_ADMIN_EMAIL,
            sub: "google-jero",
            name: "Jero",
          }),
        });

        const invitation = yield* enrollment.createInvitation(adminIdentity, {
          teamId: "ledger",
          teamName: "Ledger",
        });

        const memberIdentity = yield* identity.verifyGoogleToken({
          token: TeamIdentity.createFakeGoogleToken({
            email: "ent.test.ana@gmail.com",
            sub: "google-member",
            name: "Member",
          }),
        });

        const result = yield* enrollment.redeemInvitation(memberIdentity, "env-1", {
          secret: invitation.secret,
        });

        expect(result.teamId).toBe("ledger");
        expect(result.status).toBe("enrolled");
      }).pipe(Effect.provide(layerTeamEnrollment())),
    );

    it.effect("expired invitation is rejected", () =>
      Effect.gen(function* () {
        const enrollment = yield* TeamEnrollment.TeamEnrollment;
        const identity = yield* TeamIdentity.TeamIdentity;

        const adminIdentity = yield* identity.verifyGoogleToken({
          token: TeamIdentity.createFakeGoogleToken({
            email: PREAUTHORIZED_ADMIN_EMAIL,
            sub: "google-jero",
            name: "Jero",
          }),
        });

        const invitation = yield* enrollment.createInvitation(adminIdentity, {
          teamId: "ledger",
          teamName: "Ledger",
          expiresInHours: 1,
        });

        yield* TestClock.adjust("2 hours");

        const memberIdentity = yield* identity.verifyGoogleToken({
          token: TeamIdentity.createFakeGoogleToken({
            email: "ent.test.ana@gmail.com",
            sub: "google-member",
            name: "Member",
          }),
        });

        const result = yield* enrollment
          .redeemInvitation(memberIdentity, "env-1", { secret: invitation.secret })
          .pipe(Effect.exit);

        expect(Exit.isFailure(result)).toBe(true);
      }).pipe(Effect.provide(layerTeamEnrollment())),
    );

    it.effect("revoked invitation is rejected", () =>
      Effect.gen(function* () {
        const enrollment = yield* TeamEnrollment.TeamEnrollment;
        const identity = yield* TeamIdentity.TeamIdentity;

        const adminIdentity = yield* identity.verifyGoogleToken({
          token: TeamIdentity.createFakeGoogleToken({
            email: PREAUTHORIZED_ADMIN_EMAIL,
            sub: "google-jero",
            name: "Jero",
          }),
        });

        const invitation = yield* enrollment.createInvitation(adminIdentity, {
          teamId: "ledger",
          teamName: "Ledger",
        });

        yield* enrollment.revokeInvitation(adminIdentity, invitation.id);

        const memberIdentity = yield* identity.verifyGoogleToken({
          token: TeamIdentity.createFakeGoogleToken({
            email: "ent.test.ana@gmail.com",
            sub: "google-member",
            name: "Member",
          }),
        });

        const result = yield* enrollment
          .redeemInvitation(memberIdentity, "env-1", { secret: invitation.secret })
          .pipe(Effect.exit);

        expect(Exit.isFailure(result)).toBe(true);
      }).pipe(Effect.provide(layerTeamEnrollment())),
    );

    it.effect("exhausted invitation is rejected", () =>
      Effect.gen(function* () {
        const enrollment = yield* TeamEnrollment.TeamEnrollment;
        const identity = yield* TeamIdentity.TeamIdentity;

        const adminIdentity = yield* identity.verifyGoogleToken({
          token: TeamIdentity.createFakeGoogleToken({
            email: PREAUTHORIZED_ADMIN_EMAIL,
            sub: "google-jero",
            name: "Jero",
          }),
        });

        const invitation = yield* enrollment.createInvitation(adminIdentity, {
          teamId: "ledger",
          teamName: "Ledger",
          maxUses: 1,
        });

        const member1 = yield* identity.verifyGoogleToken({
          token: TeamIdentity.createFakeGoogleToken({
            email: "ent.test.bruno@gmail.com",
            sub: "google-member1",
            name: "Member 1",
          }),
        });

        yield* enrollment.redeemInvitation(member1, "env-1", { secret: invitation.secret });

        const member2 = yield* identity.verifyGoogleToken({
          token: TeamIdentity.createFakeGoogleToken({
            email: "ent.test.carla@gmail.com",
            sub: "google-member2",
            name: "Member 2",
          }),
        });

        const result = yield* enrollment
          .redeemInvitation(member2, "env-2", { secret: invitation.secret })
          .pipe(Effect.exit);

        expect(Exit.isFailure(result)).toBe(true);
      }).pipe(Effect.provide(layerTeamEnrollment())),
    );
  });

  describe("getEnrollment", () => {
    it.effect("returns enrollment after redeeming", () =>
      Effect.gen(function* () {
        const enrollment = yield* TeamEnrollment.TeamEnrollment;
        const identity = yield* TeamIdentity.TeamIdentity;

        const adminIdentity = yield* identity.verifyGoogleToken({
          token: TeamIdentity.createFakeGoogleToken({
            email: PREAUTHORIZED_ADMIN_EMAIL,
            sub: "google-jero",
            name: "Jero",
          }),
        });

        const invitation = yield* enrollment.createInvitation(adminIdentity, {
          teamId: "ledger",
          teamName: "Ledger",
        });

        const memberIdentity = yield* identity.verifyGoogleToken({
          token: TeamIdentity.createFakeGoogleToken({
            email: "ent.test.ana@gmail.com",
            sub: "google-member",
            name: "Member",
          }),
        });

        yield* enrollment.redeemInvitation(memberIdentity, "env-1", { secret: invitation.secret });

        const result = yield* enrollment.getEnrollment("env-1");

        expect(result?.teamId).toBe("ledger");
        expect(result?.teamName).toBe("Ledger");
      }).pipe(Effect.provide(layerTeamEnrollment())),
    );

    it.effect("returns null for non-enrolled environment", () =>
      Effect.gen(function* () {
        const enrollment = yield* TeamEnrollment.TeamEnrollment;

        const result = yield* enrollment.getEnrollment("env-unknown");

        expect(result).toBeNull();
      }).pipe(Effect.provide(layerTeamEnrollment())),
    );
  });
});
