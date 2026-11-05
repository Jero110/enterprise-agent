import {
  type VerifiedIdentity,
  type TeamInvitation,
  type TeamEnrollment as TeamEnrollmentType,
  TeamEnrollmentError,
  type CreateInvitationInput,
  type RedeemInvitationInput,
  type EnrollmentResult,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HashMap from "effect/HashMap";
import * as Ref from "effect/Ref";
import * as SecureRandom from "effect/crypto/SecureRandom";

import * as EnterpriseStore from "../enterprise/EnterpriseStore.ts";
import * as TeamIdentity from "./TeamIdentity.ts";

const DEFAULT_INVITATION_HOURS = 24 * 7;
const DEFAULT_MAX_USES = 100;

interface TeamEnrollmentState {
  readonly invitations: HashMap.HashMap<string, TeamInvitation>;
  readonly invitationsBySecret: HashMap.HashMap<string, string>;
}

const makeInitialState = (): TeamEnrollmentState => ({
  invitations: HashMap.empty(),
  invitationsBySecret: HashMap.empty(),
});

export interface TeamEnrollmentService {
  readonly createInvitation: (
    actor: VerifiedIdentity,
    input: CreateInvitationInput,
  ) => Effect.Effect<TeamInvitation, TeamEnrollmentError>;

  readonly revokeInvitation: (
    actor: VerifiedIdentity,
    invitationId: string,
  ) => Effect.Effect<void, TeamEnrollmentError>;

  readonly redeemInvitation: (
    actor: VerifiedIdentity,
    environmentId: string,
    input: RedeemInvitationInput,
  ) => Effect.Effect<EnrollmentResult, TeamEnrollmentError>;

  readonly getEnrollment: (environmentId: string) => Effect.Effect<TeamEnrollmentType | null>;

  readonly unenroll: (environmentId: string) => Effect.Effect<void, TeamEnrollmentError>;
}

export class TeamEnrollment extends Context.Service<TeamEnrollment, TeamEnrollmentService>()(
  "t3/auth/TeamEnrollment",
) {}

export const layer = Layer.effect(
  TeamEnrollment,
  Effect.gen(function* () {
    const teamIdentity = yield* TeamIdentity.TeamIdentity;
    const store = yield* EnterpriseStore.EnterpriseStore;
    const secureRandom = yield* SecureRandom.SecureRandom;
    const stateRef = yield* Ref.make(makeInitialState());

    const createInvitation: TeamEnrollmentService["createInvitation"] = Effect.fn(
      "TeamEnrollment.createInvitation",
    )(function* (actor, input) {
      const role = yield* teamIdentity.getMemberRole(actor.email);
      if (role !== "admin") {
        return yield* new TeamEnrollmentError({
          code: "admin_required",
          message: "Only administrators can create invitations.",
        });
      }

      const now = yield* DateTime.now;
      const id = yield* secureRandom.uuidV4();
      const secret = yield* secureRandom.uuidV4();

      const expiresInHours = input.expiresInHours ?? DEFAULT_INVITATION_HOURS;
      const expiresAt = DateTime.add(now, { hours: expiresInHours });

      const invitation: TeamInvitation = {
        id,
        teamId: input.teamId,
        teamName: input.teamName,
        secret,
        status: "active",
        createdBy: actor.email,
        createdAt: now,
        expiresAt,
        maxUses: input.maxUses ?? DEFAULT_MAX_USES,
        uses: 0,
      };

      yield* Ref.update(stateRef, (s) => ({
        ...s,
        invitations: HashMap.set(s.invitations, id, invitation),
        invitationsBySecret: HashMap.set(s.invitationsBySecret, secret, id),
      }));

      return invitation;
    });

    const revokeInvitation: TeamEnrollmentService["revokeInvitation"] = Effect.fn(
      "TeamEnrollment.revokeInvitation",
    )(function* (actor, invitationId) {
      const role = yield* teamIdentity.getMemberRole(actor.email);
      if (role !== "admin") {
        return yield* new TeamEnrollmentError({
          code: "admin_required",
          message: "Only administrators can revoke invitations.",
        });
      }

      const state = yield* Ref.get(stateRef);
      const invitation = HashMap.get(state.invitations, invitationId);

      if (invitation._tag === "None") {
        return yield* new TeamEnrollmentError({
          code: "invitation_not_found",
          message: "Invitation not found.",
        });
      }

      const revokedInvitation: TeamInvitation = {
        ...invitation.value,
        status: "revoked",
      };

      yield* Ref.update(stateRef, (s) => ({
        ...s,
        invitations: HashMap.set(s.invitations, invitationId, revokedInvitation),
      }));
    });

    const redeemInvitation: TeamEnrollmentService["redeemInvitation"] = Effect.fn(
      "TeamEnrollment.redeemInvitation",
    )(function* (actor, environmentId, input) {
      const state = yield* Ref.get(stateRef);

      if ((yield* store.getEnrollment(environmentId)) !== null) {
        return yield* new TeamEnrollmentError({
          code: "already_enrolled",
          message: "This environment is already enrolled in a team.",
        });
      }

      const member = yield* store.getMember(actor.email);
      if (member === null || !(yield* store.canEnter(actor.email))) {
        return yield* new TeamEnrollmentError({
          code: "not_authorized",
          message: "Only authorized members can enroll an environment.",
        });
      }

      const invitationId = HashMap.get(state.invitationsBySecret, input.secret);
      if (invitationId._tag === "None") {
        return yield* new TeamEnrollmentError({
          code: "invitation_not_found",
          message: "Invalid invitation secret.",
        });
      }

      const invitation = HashMap.get(state.invitations, invitationId.value);
      if (invitation._tag === "None") {
        return yield* new TeamEnrollmentError({
          code: "invitation_not_found",
          message: "Invitation not found.",
        });
      }

      const inv = invitation.value;

      if (inv.status === "revoked") {
        return yield* new TeamEnrollmentError({
          code: "invitation_revoked",
          message: "This invitation has been revoked.",
        });
      }

      const now = yield* DateTime.now;
      if (now.epochMilliseconds > inv.expiresAt.epochMilliseconds) {
        return yield* new TeamEnrollmentError({
          code: "invitation_expired",
          message: "This invitation has expired.",
        });
      }

      if (inv.uses >= inv.maxUses) {
        return yield* new TeamEnrollmentError({
          code: "invitation_exhausted",
          message: "This invitation has reached its maximum number of uses.",
        });
      }

      if (member.teamId !== inv.teamId) {
        return yield* new TeamEnrollmentError({
          code: "team_mismatch",
          message: "This invitation is for a different team.",
        });
      }

      const updatedInvitation: TeamInvitation = {
        ...inv,
        uses: inv.uses + 1,
      };

      yield* store.enroll({ environmentId, email: actor.email });
      yield* Ref.update(stateRef, (s) => ({
        ...s,
        invitations: HashMap.set(s.invitations, invitationId.value, updatedInvitation),
      }));

      return {
        teamId: inv.teamId,
        teamName: inv.teamName,
        status: "enrolled" as const,
      };
    });

    const getEnrollment: TeamEnrollmentService["getEnrollment"] = Effect.fn(
      "TeamEnrollment.getEnrollment",
    )(function* (environmentId) {
      const enrollment = yield* store.getEnrollment(environmentId);
      if (enrollment === null) return null;

      const member = yield* store.getMember(enrollment.email);
      const team = member?.teamId ? yield* store.getTeam(member.teamId) : null;
      if (team === null) return null;

      return {
        environmentId,
        teamId: team.id,
        teamName: team.name,
        enrolledAt: enrollment.enrolledAt,
        enrolledBy: enrollment.email,
      } satisfies TeamEnrollmentType;
    });

    const unenroll: TeamEnrollmentService["unenroll"] = Effect.fn("TeamEnrollment.unenroll")(
      function* (environmentId) {
        if (!(yield* store.unenroll(environmentId))) {
          return yield* new TeamEnrollmentError({
            code: "not_enrolled",
            message: "This environment is not enrolled in any team.",
          });
        }
      },
    );

    return {
      createInvitation,
      revokeInvitation,
      redeemInvitation,
      getEnrollment,
      unenroll,
    } satisfies TeamEnrollmentService;
  }),
);
