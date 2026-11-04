import {
  type VerifiedIdentity,
  type Team,
  type TeamMemberInfo,
  type MemberUsage,
  TeamActivityError,
  PREAUTHORIZED_ADMIN_EMAIL,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HashMap from "effect/HashMap";
import * as Ref from "effect/Ref";
import * as SecureRandom from "effect/crypto/SecureRandom";

const normalizeEmail = (email: string): string => email.toLowerCase().trim();

export interface DirectoryPrincipal {
  readonly email: string;
  readonly displayName: string;
  readonly isAdmin: boolean;
  readonly isAnonymousDev: boolean;
  readonly teamId?: string;
}

interface StoredMember {
  readonly email: string;
  readonly displayName: string;
  readonly isAdmin: boolean;
  readonly isAnonymousDev: boolean;
  readonly teamId?: string;
  readonly registeredAt: DateTime.Utc;
}

interface TeamDirectoryState {
  readonly teams: HashMap.HashMap<string, Team>;
  readonly members: HashMap.HashMap<string, StoredMember>;
  readonly usage: HashMap.HashMap<string, { conversations: number; tokens: number }>;
}

const makeInitialState = (): TeamDirectoryState => ({
  teams: HashMap.empty(),
  members: HashMap.empty(),
  usage: HashMap.empty(),
});

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
    const stateRef = yield* Ref.make(makeInitialState());

    const getPrincipal: TeamDirectoryService["getPrincipal"] = Effect.fn(
      "TeamDirectory.getPrincipal",
    )(function* (identity) {
      const email = normalizeEmail(identity.email);
      const isAdmin = normalizeEmail(PREAUTHORIZED_ADMIN_EMAIL) === email;
      const isAnonymousDev = identity.source === "anonymous-dev";

      const state = yield* Ref.get(stateRef);
      const member = HashMap.get(state.members, email);
      const teamId = member._tag === "Some" ? member.value.teamId : undefined;

      return {
        email: identity.email,
        displayName: identity.displayName,
        isAdmin,
        isAnonymousDev,
        ...(teamId !== undefined ? { teamId } : {}),
      };
    });

    const registerMember: TeamDirectoryService["registerMember"] = Effect.fn(
      "TeamDirectory.registerMember",
    )(function* (identity) {
      const email = normalizeEmail(identity.email);
      const isAdmin = normalizeEmail(PREAUTHORIZED_ADMIN_EMAIL) === email;
      const isAnonymousDev = identity.source === "anonymous-dev";
      const now = yield* DateTime.now;

      const storedMember: StoredMember = {
        email,
        displayName: identity.displayName,
        isAdmin,
        isAnonymousDev,
        registeredAt: now,
      };

      yield* Ref.update(stateRef, (s) => ({
        ...s,
        members: HashMap.set(s.members, email, storedMember),
      }));

      return {
        email,
        displayName: identity.displayName,
        isAdmin,
        isAnonymousDev,
      };
    });

    const listMembers: TeamDirectoryService["listMembers"] = Effect.fn("TeamDirectory.listMembers")(
      function* (_principal) {
        const state = yield* Ref.get(stateRef);

        const members: TeamMemberInfo[] = [];

        members.push({
          email: normalizeEmail(PREAUTHORIZED_ADMIN_EMAIL),
          displayName: "Jero",
          isAdmin: true,
          isAnonymousDev: false,
        });

        for (const [, member] of HashMap.entries(state.members)) {
          if (normalizeEmail(member.email) === normalizeEmail(PREAUTHORIZED_ADMIN_EMAIL)) {
            continue;
          }

          const team = member.teamId ? HashMap.get(state.teams, member.teamId) : undefined;

          members.push({
            email: member.email,
            displayName: member.displayName,
            isAdmin: member.isAdmin,
            isAnonymousDev: member.isAnonymousDev,
            ...(member.teamId !== undefined ? { teamId: member.teamId } : {}),
            ...(team?._tag === "Some" ? { teamName: team.value.name } : {}),
          });
        }

        return members;
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

        const now = yield* DateTime.now;
        const id = yield* secureRandom.uuidV4();

        const team: Team = {
          id,
          name: input.name,
          createdAt: now,
          createdBy: principal.email,
        };

        yield* Ref.update(stateRef, (s) => ({
          ...s,
          teams: HashMap.set(s.teams, id, team),
        }));

        return team;
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

        const state = yield* Ref.get(stateRef);
        const team = HashMap.get(state.teams, teamId);

        if (team._tag === "None") {
          return yield* new TeamActivityError({
            code: "team_not_found",
            message: "Team not found.",
          });
        }

        yield* Ref.update(stateRef, (s) => ({
          ...s,
          teams: HashMap.remove(s.teams, teamId),
        }));
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

      const normalizedEmail = normalizeEmail(email);
      const state = yield* Ref.get(stateRef);

      const member = HashMap.get(state.members, normalizedEmail);
      if (member._tag === "None") {
        return yield* new TeamActivityError({
          code: "member_not_found",
          message: "Member not found.",
        });
      }

      if (teamId !== null) {
        const team = HashMap.get(state.teams, teamId);
        if (team._tag === "None") {
          return yield* new TeamActivityError({
            code: "team_not_found",
            message: "Team not found.",
          });
        }
      }

      const updatedMember: StoredMember = {
        ...member.value,
        ...(teamId !== null ? { teamId } : {}),
      };

      if (teamId === null) {
        delete (updatedMember as { teamId?: string }).teamId;
      }

      yield* Ref.update(stateRef, (s) => ({
        ...s,
        members: HashMap.set(s.members, normalizedEmail, updatedMember),
      }));
    });

    const getMemberUsage: TeamDirectoryService["getMemberUsage"] = Effect.fn(
      "TeamDirectory.getMemberUsage",
    )(function* (principal, email) {
      const normalizedEmail = normalizeEmail(email);
      const normalizedPrincipalEmail = normalizeEmail(principal.email);

      if (!principal.isAdmin && normalizedPrincipalEmail !== normalizedEmail) {
        const state = yield* Ref.get(stateRef);
        const principalMember = HashMap.get(state.members, normalizedPrincipalEmail);
        const targetMember = HashMap.get(state.members, normalizedEmail);

        const sameTeam =
          principalMember._tag === "Some" &&
          targetMember._tag === "Some" &&
          principalMember.value.teamId !== undefined &&
          principalMember.value.teamId === targetMember.value.teamId;

        if (!sameTeam) {
          return yield* new TeamActivityError({
            code: "access_denied",
            message: "You can only view your own usage or your team's usage.",
          });
        }
      }

      const state = yield* Ref.get(stateRef);
      const usage = HashMap.get(state.usage, normalizedEmail);

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

        yield* Ref.update(stateRef, (s) => {
          const existing = HashMap.get(s.usage, normalizedEmail);
          const current =
            existing._tag === "Some" ? existing.value : { conversations: 0, tokens: 0 };
          return {
            ...s,
            usage: HashMap.set(s.usage, normalizedEmail, {
              conversations: current.conversations + conversations,
              tokens: current.tokens + tokens,
            }),
          };
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
