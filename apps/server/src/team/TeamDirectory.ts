import {
  type VerifiedIdentity,
  type Team,
  type TeamMemberInfo,
  type MemberUsage,
  TeamActivityError,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HashMap from "effect/HashMap";
import * as Ref from "effect/Ref";
import * as SecureRandom from "effect/crypto/SecureRandom";

import * as EnterpriseStore from "../enterprise/EnterpriseStore.ts";

const normalizeEmail = EnterpriseStore.normalizeEmail;

export interface DirectoryPrincipal {
  readonly email: string;
  readonly displayName: string;
  readonly isAdmin: boolean;
  readonly isAnonymousDev: boolean;
  readonly teamId?: string;
}

type Usage = HashMap.HashMap<string, { conversations: number; tokens: number }>;

export interface TeamDirectoryService {
  readonly getPrincipal: (identity: VerifiedIdentity) => Effect.Effect<DirectoryPrincipal>;

  readonly registerMember: (identity: VerifiedIdentity) => Effect.Effect<TeamMemberInfo>;

  readonly listMembers: (
    principal: DirectoryPrincipal,
  ) => Effect.Effect<ReadonlyArray<TeamMemberInfo>>;

  readonly createTeam: (
    principal: DirectoryPrincipal,
    input: { readonly name: string },
  ) => Effect.Effect<Team, TeamActivityError>;

  readonly deleteTeam: (
    principal: DirectoryPrincipal,
    teamId: string,
  ) => Effect.Effect<void, TeamActivityError>;

  readonly moveMemberToTeam: (
    principal: DirectoryPrincipal,
    email: string,
    teamId: string | null,
  ) => Effect.Effect<void, TeamActivityError>;

  readonly getMemberUsage: (
    principal: DirectoryPrincipal,
    email: string,
  ) => Effect.Effect<MemberUsage, TeamActivityError>;

  readonly recordUsage: (
    email: string,
    conversations: number,
    tokens: number,
  ) => Effect.Effect<void>;
}

export class TeamDirectory extends Context.Service<TeamDirectory, TeamDirectoryService>()(
  "t3/team/TeamDirectory",
) {}

export const layer = Layer.effect(
  TeamDirectory,
  Effect.gen(function* () {
    const secureRandom = yield* SecureRandom.SecureRandom;
    const store = yield* EnterpriseStore.EnterpriseStore;
    const usageRef = yield* Ref.make<Usage>(HashMap.empty());

    const activeMember = Effect.fn("TeamDirectory.activeMember")(function* (email: string) {
      if (!(yield* store.canEnter(email))) return null;
      return yield* store.getMember(email);
    });

    const getPrincipal: TeamDirectoryService["getPrincipal"] = Effect.fn(
      "TeamDirectory.getPrincipal",
    )(function* (identity) {
      const member = yield* activeMember(identity.email);

      return {
        email: identity.email,
        displayName: identity.displayName,
        isAdmin: member?.role === "admin",
        isAnonymousDev: identity.source === "anonymous-dev",
        ...(member?.teamId ? { teamId: member.teamId } : {}),
      };
    });

    const registerMember: TeamDirectoryService["registerMember"] = Effect.fn(
      "TeamDirectory.registerMember",
    )(function* (identity) {
      const member = yield* activeMember(identity.email);
      const team = member?.teamId ? yield* store.getTeam(member.teamId) : null;

      return {
        email: normalizeEmail(identity.email),
        displayName: member?.displayName ?? identity.displayName,
        isAdmin: member?.role === "admin",
        isAnonymousDev: identity.source === "anonymous-dev",
        ...(member?.role ? { role: member.role } : {}),
        ...(member?.teamId ? { teamId: member.teamId } : {}),
        ...(team ? { teamName: team.name } : {}),
      };
    });

    const listMembers: TeamDirectoryService["listMembers"] = Effect.fn("TeamDirectory.listMembers")(
      function* (_principal) {
        const teams = new Map((yield* store.listTeams).map((team) => [team.id, team.name]));
        const members = yield* store.listMembers;

        return members
          .filter((member) => member.authorized && !member.revoked)
          .map((member): TeamMemberInfo => {
            const teamName = member.teamId === null ? undefined : teams.get(member.teamId);
            return {
              email: member.email,
              displayName: member.displayName,
              role: member.role,
              isAdmin: member.role === "admin",
              isAnonymousDev: false,
              ...(member.teamId === null ? {} : { teamId: member.teamId }),
              ...(teamName === undefined ? {} : { teamName }),
            };
          });
      },
    );

    const createTeam: TeamDirectoryService["createTeam"] = Effect.fn("TeamDirectory.createTeam")(
      function* (principal, input) {
        if (!principal.isAdmin) {
          return yield* new TeamActivityError({
            code: "admin_required",
            message: "Only administrators can create teams.",
          });
        }

        const created = yield* store.createTeam({
          id: yield* secureRandom.uuidV4(),
          name: input.name,
          createdBy: principal.email,
        });

        return {
          id: created.id,
          name: created.name,
          createdAt: created.createdAt,
          createdBy: created.createdBy,
        } satisfies Team;
      },
    );

    const deleteTeam: TeamDirectoryService["deleteTeam"] = Effect.fn("TeamDirectory.deleteTeam")(
      function* (principal, teamId) {
        if (!principal.isAdmin) {
          return yield* new TeamActivityError({
            code: "admin_required",
            message: "Only administrators can delete teams.",
          });
        }

        if (!(yield* store.deleteTeam(teamId))) {
          return yield* new TeamActivityError({
            code: "team_not_found",
            message: "Team not found.",
          });
        }
      },
    );

    const moveMemberToTeam: TeamDirectoryService["moveMemberToTeam"] = Effect.fn(
      "TeamDirectory.moveMemberToTeam",
    )(function* (principal, email, teamId) {
      if (!principal.isAdmin) {
        return yield* new TeamActivityError({
          code: "admin_required",
          message: "Only administrators can move members between teams.",
        });
      }

      if ((yield* activeMember(email)) === null) {
        return yield* new TeamActivityError({
          code: "member_not_found",
          message: "Member not found.",
        });
      }

      if (teamId !== null && (yield* store.getTeam(teamId)) === null) {
        return yield* new TeamActivityError({
          code: "team_not_found",
          message: "Team not found.",
        });
      }

      yield* store.moveMember(email, teamId);
    });

    const getMemberUsage: TeamDirectoryService["getMemberUsage"] = Effect.fn(
      "TeamDirectory.getMemberUsage",
    )(function* (principal, email) {
      const normalizedEmail = normalizeEmail(email);
      const normalizedPrincipalEmail = normalizeEmail(principal.email);

      if (!principal.isAdmin && normalizedPrincipalEmail !== normalizedEmail) {
        const principalMember = yield* activeMember(normalizedPrincipalEmail);
        const targetMember = yield* activeMember(normalizedEmail);

        const sameTeam =
          principalMember?.teamId != null && principalMember.teamId === targetMember?.teamId;

        if (!sameTeam) {
          return yield* new TeamActivityError({
            code: "access_denied",
            message: "You can only view your own usage or your team's usage.",
          });
        }
      }

      const usage = HashMap.get(yield* Ref.get(usageRef), normalizedEmail);

      const baseUsage = usage._tag === "Some" ? usage.value : { conversations: 0, tokens: 0 };

      return {
        email: normalizedEmail,
        today: { ...baseUsage, period: "today" as const },
        week: { ...baseUsage, period: "week" as const },
        allTime: { ...baseUsage, period: "all-time" as const },
      };
    });

    const recordUsage: TeamDirectoryService["recordUsage"] = Effect.fn("TeamDirectory.recordUsage")(
      function* (email, conversations, tokens) {
        const normalizedEmail = normalizeEmail(email);

        yield* Ref.update(usageRef, (usage) => {
          const existing = HashMap.get(usage, normalizedEmail);
          const current =
            existing._tag === "Some" ? existing.value : { conversations: 0, tokens: 0 };
          return HashMap.set(usage, normalizedEmail, {
            conversations: current.conversations + conversations,
            tokens: current.tokens + tokens,
          });
        });
      },
    );

    return {
      getPrincipal,
      registerMember,
      listMembers,
      createTeam,
      deleteTeam,
      moveMemberToTeam,
      getMemberUsage,
      recordUsage,
    } satisfies TeamDirectoryService;
  }),
);
