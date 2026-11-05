import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { expect, it, describe } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SecureRandom from "effect/crypto/SecureRandom";

import * as TeamEnrollment from "../auth/TeamEnrollment.ts";
import * as TeamIdentity from "../auth/TeamIdentity.ts";
import * as ServerConfig from "../config.ts";
import * as AreaKnowledge from "../knowledge/AreaKnowledge.ts";
import * as TeamDirectory from "../team/TeamDirectory.ts";
import { layerSeededStore } from "./EnterpriseStore.testkit.ts";
import * as EnterpriseStore from "./EnterpriseStore.ts";

const baseLayer = Layer.mergeAll(NodeServices.layer, NodeCrypto.layer, SecureRandom.layerWebCrypto);

const layerServices = Layer.mergeAll(
  TeamEnrollment.layer,
  TeamDirectory.layer,
  AreaKnowledge.layer,
).pipe(
  Layer.provideMerge(TeamIdentity.layer),
  Layer.provideMerge(layerSeededStore),
  Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-enterprise-svc-" })),
  Layer.provideMerge(baseLayer),
);

const ana = (email: string, name: string) =>
  TeamIdentity.createFakeGoogleToken({ email, sub: `google-${name}`, name });

describe("enterprise services share one store", () => {
  it.effect("moving a member is visible to identity, directory and knowledge from one write", () =>
    Effect.gen(function* () {
      const store = yield* EnterpriseStore.EnterpriseStore;
      const identity = yield* TeamIdentity.TeamIdentity;
      const directory = yield* TeamDirectory.TeamDirectory;
      const knowledge = yield* AreaKnowledge.AreaKnowledge;

      const admin = yield* identity.verifyGoogleToken({
        token: ana("jeronimo.deli@gmail.com", "Jero"),
      });
      const bruno = yield* identity.verifyGoogleToken({
        token: ana("ent.test.bruno@gmail.com", "Bruno"),
      });
      const adminPrincipal = yield* directory.getPrincipal(admin);

      expect((yield* directory.getPrincipal(bruno)).teamId).toBe("ledger");
      expect((yield* knowledge.getPrincipal(bruno)).areaIds).toEqual(["ledger"]);

      yield* store.moveMember("ent.test.bruno@gmail.com", "frontend");

      expect((yield* identity.getMemberRole(bruno.email)) ?? null).toBe("member");
      expect((yield* directory.getPrincipal(bruno)).teamId).toBe("frontend");
      const listed = (yield* directory.listMembers(adminPrincipal)).find(
        (m) => m.email === "ent.test.bruno@gmail.com",
      );
      expect(listed).toMatchObject({ teamId: "frontend", teamName: "Frontend" });
      expect((yield* knowledge.getPrincipal(bruno)).areaIds).toEqual(["frontend"]);

      // The same write also moves it through the directory API.
      yield* directory.moveMemberToTeam(adminPrincipal, "ent.test.bruno@gmail.com", "risk");
      expect((yield* knowledge.getPrincipal(bruno)).areaIds).toEqual(["risk"]);
    }).pipe(Effect.provide(layerServices)),
  );

  it.effect("revoking an email stops identity, directory and knowledge at once", () =>
    Effect.gen(function* () {
      const identity = yield* TeamIdentity.TeamIdentity;
      const directory = yield* TeamDirectory.TeamDirectory;
      const knowledge = yield* AreaKnowledge.AreaKnowledge;

      const admin = yield* identity.verifyGoogleToken({
        token: ana("jeronimo.deli@gmail.com", "Jero"),
      });
      const carla = yield* identity.verifyGoogleToken({
        token: ana("ent.test.carla@gmail.com", "Carla"),
      });
      const session = yield* identity.createSession(carla);
      expect(yield* identity.canEnterTeam(carla)).toBe(true);

      yield* identity.deauthorizeMember(admin, carla.email);

      expect(yield* identity.canEnterTeam(carla)).toBe(false);
      expect(yield* identity.getSessionIdentity(session).pipe(Effect.flip)).toMatchObject({
        code: "not_authorized",
      });
      expect((yield* directory.getPrincipal(carla)).teamId).toBeUndefined();
      expect((yield* knowledge.getPrincipal(carla)).areaIds).toEqual([]);
    }).pipe(Effect.provide(layerServices)),
  );

  it.effect("an enrollment follows its member to a new team", () =>
    Effect.gen(function* () {
      const store = yield* EnterpriseStore.EnterpriseStore;
      const identity = yield* TeamIdentity.TeamIdentity;
      const enrollment = yield* TeamEnrollment.TeamEnrollment;

      const admin = yield* identity.verifyGoogleToken({
        token: ana("jeronimo.deli@gmail.com", "Jero"),
      });
      const ana_ = yield* identity.verifyGoogleToken({
        token: ana("ent.test.ana@gmail.com", "Ana"),
      });
      const invitation = yield* enrollment.createInvitation(admin, {
        teamId: "ledger",
        teamName: "Ledger",
      });
      yield* enrollment.redeemInvitation(ana_, "env-ana", { secret: invitation.secret });
      expect((yield* enrollment.getEnrollment("env-ana"))?.teamId).toBe("ledger");

      yield* store.moveMember("ent.test.ana@gmail.com", "risk");
      expect(yield* enrollment.getEnrollment("env-ana")).toMatchObject({
        teamId: "risk",
        teamName: "Risk",
      });
    }).pipe(Effect.provide(layerServices)),
  );

  it.effect("only authorized members of the invited team can enroll", () =>
    Effect.gen(function* () {
      const identity = yield* TeamIdentity.TeamIdentity;
      const enrollment = yield* TeamEnrollment.TeamEnrollment;

      const admin = yield* identity.verifyGoogleToken({
        token: ana("jeronimo.deli@gmail.com", "Jero"),
      });
      const invitation = yield* enrollment.createInvitation(admin, {
        teamId: "ledger",
        teamName: "Ledger",
      });
      const intruso = yield* identity.verifyGoogleToken({
        token: ana("ent.test.intruso@gmail.com", "Intruso"),
      });
      const gerry = yield* identity.verifyGoogleToken({
        token: ana("ent.test.gerry@gmail.com", "Gerry"),
      });

      expect(
        yield* enrollment
          .redeemInvitation(intruso, "env-x", { secret: invitation.secret })
          .pipe(Effect.flip),
      ).toMatchObject({ code: "not_authorized" });
      expect(
        yield* enrollment
          .redeemInvitation(gerry, "env-y", { secret: invitation.secret })
          .pipe(Effect.flip),
      ).toMatchObject({ code: "team_mismatch" });
      expect(yield* enrollment.getEnrollment("env-x")).toBeNull();
    }).pipe(Effect.provide(layerServices)),
  );
});
