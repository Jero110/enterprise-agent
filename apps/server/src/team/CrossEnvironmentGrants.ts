import { type CrossEnvironmentGrant, TeamActivityError } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as HashMap from "effect/HashMap";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as SecureRandom from "effect/crypto/SecureRandom";

export type CrossEnvironmentAction = "message" | "start-agent";

export interface CrossEnvironmentGrantsService {
  readonly grant: (input: {
    readonly grantorEmail: string;
    readonly grantorEnvironmentId: string;
    readonly granteeEmail: string;
    readonly scopes: ReadonlyArray<CrossEnvironmentAction>;
  }) => Effect.Effect<CrossEnvironmentGrant>;
  readonly revoke: (
    revokerEmail: string,
    grantId: string,
  ) => Effect.Effect<void, TeamActivityError>;
  readonly isAllowed: (input: {
    readonly ownerEmail: string;
    readonly ownerEnvironmentId: string;
    readonly actorEmail: string;
    readonly scope: CrossEnvironmentAction;
  }) => Effect.Effect<boolean>;
}

export class CrossEnvironmentGrants extends Context.Service<
  CrossEnvironmentGrants,
  CrossEnvironmentGrantsService
>()("t3/team/CrossEnvironmentGrants") {}

const normalizeEmail = (email: string) => email.trim().toLowerCase();

export const layer = Layer.effect(
  CrossEnvironmentGrants,
  Effect.gen(function* () {
    const secureRandom = yield* SecureRandom.SecureRandom;
    const grants = yield* Ref.make(HashMap.empty<string, CrossEnvironmentGrant>());

    const grant: CrossEnvironmentGrantsService["grant"] = Effect.fn("CrossEnvironmentGrants.grant")(
      function* (input) {
        const now = yield* DateTime.now;
        const id = yield* secureRandom.uuidV4();
        const value: CrossEnvironmentGrant = {
          id,
          grantorEmail: normalizeEmail(input.grantorEmail),
          grantorEnvironmentId: input.grantorEnvironmentId,
          granteeEmail: normalizeEmail(input.granteeEmail),
          scopes: [...input.scopes],
          grantedAt: now,
        };
        yield* Ref.update(grants, (all) => HashMap.set(all, id, value));
        return value;
      },
    );

    const revoke: CrossEnvironmentGrantsService["revoke"] = Effect.fn(
      "CrossEnvironmentGrants.revoke",
    )(function* (revokerEmail, grantId) {
      const all = yield* Ref.get(grants);
      const grant = HashMap.get(all, grantId);
      if (grant._tag === "None") {
        return yield* new TeamActivityError({
          code: "grant_not_found",
          message: "Grant not found.",
        });
      }
      if (grant.value.grantorEmail !== normalizeEmail(revokerEmail)) {
        return yield* new TeamActivityError({
          code: "access_denied",
          message: "Only the grant owner can revoke it.",
        });
      }
      const revokedAt = yield* DateTime.now;
      yield* Ref.update(grants, (current) =>
        HashMap.set(current, grantId, { ...grant.value, revokedAt }),
      );
    });

    const isAllowed: CrossEnvironmentGrantsService["isAllowed"] = Effect.fn(
      "CrossEnvironmentGrants.isAllowed",
    )(function* (input) {
      if (normalizeEmail(input.ownerEmail) === normalizeEmail(input.actorEmail)) return true;
      const all = yield* Ref.get(grants);
      return Array.from(HashMap.values(all)).some(
        (grant) =>
          grant.revokedAt === undefined &&
          grant.grantorEmail === normalizeEmail(input.ownerEmail) &&
          grant.grantorEnvironmentId === input.ownerEnvironmentId &&
          grant.granteeEmail === normalizeEmail(input.actorEmail) &&
          grant.scopes.includes(input.scope),
      );
    });

    return { grant, revoke, isAllowed } satisfies CrossEnvironmentGrantsService;
  }),
);
