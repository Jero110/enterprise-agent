import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as SecureRandom from "effect/crypto/SecureRandom";

import * as CrossEnvironmentGrants from "./CrossEnvironmentGrants.ts";

const layer = CrossEnvironmentGrants.layer.pipe(
  Layer.provideMerge(
    Layer.mergeAll(NodeServices.layer, NodeCrypto.layer, SecureRandom.layerWebCrypto),
  ),
);

describe("CrossEnvironmentGrants", () => {
  it.effect("requires an explicit active grant for remote actions", () =>
    Effect.gen(function* () {
      const grants = yield* CrossEnvironmentGrants.CrossEnvironmentGrants;
      const before = yield* grants.isAllowed({
        ownerEmail: "jero@example.com",
        ownerEnvironmentId: "jero-env",
        actorEmail: "gerry@example.com",
        scope: "message",
      });
      expect(before).toBe(false);

      yield* grants.grant({
        grantorEmail: "jero@example.com",
        grantorEnvironmentId: "jero-env",
        granteeEmail: "gerry@example.com",
        scopes: ["message"],
      });

      const after = yield* grants.isAllowed({
        ownerEmail: "jero@example.com",
        ownerEnvironmentId: "jero-env",
        actorEmail: "gerry@example.com",
        scope: "message",
      });
      expect(after).toBe(true);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("revocation immediately blocks a previously granted action", () =>
    Effect.gen(function* () {
      const grants = yield* CrossEnvironmentGrants.CrossEnvironmentGrants;
      const grant = yield* grants.grant({
        grantorEmail: "jero@example.com",
        grantorEnvironmentId: "jero-env",
        granteeEmail: "gerry@example.com",
        scopes: ["message", "start-agent"],
      });
      yield* grants.revoke("jero@example.com", grant.id);

      const allowed = yield* grants.isAllowed({
        ownerEmail: "jero@example.com",
        ownerEnvironmentId: "jero-env",
        actorEmail: "gerry@example.com",
        scope: "start-agent",
      });
      expect(allowed).toBe(false);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("only the environment owner can revoke its grant", () =>
    Effect.gen(function* () {
      const grants = yield* CrossEnvironmentGrants.CrossEnvironmentGrants;
      const grant = yield* grants.grant({
        grantorEmail: "jero@example.com",
        grantorEnvironmentId: "jero-env",
        granteeEmail: "gerry@example.com",
        scopes: ["message"],
      });
      const result = yield* grants.revoke("gerry@example.com", grant.id).pipe(Effect.exit);
      expect(Exit.isFailure(result)).toBe(true);
    }).pipe(Effect.provide(layer)),
  );
});
