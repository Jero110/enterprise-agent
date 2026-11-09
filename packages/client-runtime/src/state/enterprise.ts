import {
  type EnterpriseOrgMember,
  type TeamThreadSummary,
  type EnvironmentId,
  WS_METHODS,
} from "@t3tools/contracts";
import { teamMemberKey } from "@t3tools/shared/teamMemberKey";
import * as Effect from "effect/Effect";
import { Atom, type AtomRegistry } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcCommand, createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";

export function createEnterpriseEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  // Every read asks the hub, which is what makes a revoked email fail on its next use.
  const projectBoard = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:project-board",
    tag: WS_METHODS.projectBoardGet,
    staleTimeMs: 0,
    refreshIntervalMs: 10_000,
  });
  const status = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:enterprise:status",
    tag: WS_METHODS.enterpriseStatus,
    staleTimeMs: 10_000,
  });
  const members = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:enterprise:members",
    tag: WS_METHODS.enterpriseMembersList,
    staleTimeMs: 10_000,
  });
  const org = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:enterprise:org",
    tag: WS_METHODS.enterpriseOrg,
    staleTimeMs: 10_000,
  });
  const orgTemplate = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:enterprise:org-template",
    tag: WS_METHODS.enterpriseOrgTemplate,
  });
  // The conversation's knowledge cards: hub-filtered documents plus this thread's switches and reads.
  const threadContext = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:enterprise:thread-context",
    tag: WS_METHODS.enterpriseThreadContext,
    staleTimeMs: 0,
    idleTtlMs: 0,
  });
  // The hub filters by the member's scope on every read; revoked grants vanish on refresh.
  const knowledgeList = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:enterprise:knowledge-list",
    tag: WS_METHODS.enterpriseKnowledgeList,
    staleTimeMs: 10_000,
  });
  const knowledgeGet = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:enterprise:knowledge-get",
    tag: WS_METHODS.enterpriseKnowledgeGet,
    staleTimeMs: 10_000,
  });
  const proposalInbox = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:enterprise:proposal-inbox",
    tag: WS_METHODS.enterpriseProposalInbox,
    staleTimeMs: 10_000,
    refreshIntervalMs: 30_000,
  });
  const teamThreads = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:enterprise:team-threads",
    tag: WS_METHODS.teamThreadsList,
    staleTimeMs: 0,
    refreshIntervalMs: 10_000,
  });
  const teamThread = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:enterprise:team-thread",
    tag: WS_METHODS.teamThreadGet,
    staleTimeMs: 0,
    idleTtlMs: 0,
  });
  // Re-asks the hub rather than patching: identity and member list change on its word alone.
  const refreshAll = (registry: AtomRegistry.AtomRegistry, environmentId: EnvironmentId) => {
    registry.refresh(status({ environmentId, input: {} }));
    registry.refresh(members({ environmentId, input: {} }));
    registry.refresh(org({ environmentId, input: {} }));
    registry.refresh(knowledgeList({ environmentId, input: {} }));
    registry.refresh(proposalInbox({ environmentId, input: {} }));
    registry.refresh(proposalInbox({ environmentId, input: { countOnly: true } }));
    registry.refresh(teamThreads({ environmentId, input: {} }));
  };
  return {
    projectBoard,
    saveProjectBoard: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:project-board-save",
      tag: WS_METHODS.projectBoardSave,
      onSettled: ({ environmentId, input }, registry) =>
        Effect.sync(() =>
          registry.refresh(projectBoard({ environmentId, input: { projectId: input.projectId } })),
        ),
    }),
    status,
    members,
    org,
    orgTemplate,
    // A preview writes nothing, so it refreshes nothing.
    orgImportPreview: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:enterprise:org-import-preview",
      tag: WS_METHODS.enterpriseOrgImportPreview,
    }),
    orgImportApply: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:enterprise:org-import-apply",
      tag: WS_METHODS.enterpriseOrgImportApply,
      onSuccess: ({ environmentId }, registry) =>
        Effect.sync(() => refreshAll(registry, environmentId)),
    }),
    threadContext,
    setThreadContext: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:enterprise:thread-context-set",
      tag: WS_METHODS.enterpriseThreadContextSet,
      onSuccess: ({ environmentId, input }, registry) =>
        Effect.sync(() =>
          registry.refresh(threadContext({ environmentId, input: { threadId: input.threadId } })),
        ),
    }),
    knowledgeList,
    knowledgeGet,
    proposalInbox,
    ingestStart: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:enterprise:ingest-start",
      tag: WS_METHODS.enterpriseIngestStart,
    }),
    knowledgePropose: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:enterprise:knowledge-propose",
      tag: WS_METHODS.enterpriseKnowledgePropose,
      onSuccess: ({ environmentId }, registry) =>
        Effect.sync(() => refreshAll(registry, environmentId)),
    }),
    proposalDecide: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:enterprise:proposal-decide",
      tag: WS_METHODS.enterpriseProposalDecide,
      onSuccess: ({ environmentId }, registry, result) =>
        Effect.sync(() => {
          refreshAll(registry, environmentId);
          registry.refresh(knowledgeGet({ environmentId, input: { path: result.path } }));
        }),
    }),
    teamThreads,
    teamThread,
    continueTeamThread: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:enterprise:team-thread-continue",
      tag: WS_METHODS.teamThreadContinue,
    }),
    publishTeamThread: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:enterprise:team-thread-publish",
      tag: WS_METHODS.teamThreadPublish,
      onSuccess: ({ environmentId }, registry) =>
        Effect.sync(() => registry.refresh(teamThreads({ environmentId, input: {} }))),
    }),
    connect: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:enterprise:connect",
      tag: WS_METHODS.enterpriseConnect,
      onSuccess: ({ environmentId }, registry) =>
        Effect.sync(() => refreshAll(registry, environmentId)),
    }),
    // Also settles on failure: the hub may be gone, and the IDE still forgets the identity.
    disconnect: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:enterprise:disconnect",
      tag: WS_METHODS.enterpriseDisconnect,
      onSettled: ({ environmentId }, registry) =>
        Effect.sync(() => refreshAll(registry, environmentId)),
    }),
    authorize: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:enterprise:authorize",
      tag: WS_METHODS.enterpriseMembersAuthorize,
      onSuccess: ({ environmentId }, registry) =>
        Effect.sync(() => refreshAll(registry, environmentId)),
    }),
    revoke: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:enterprise:revoke",
      tag: WS_METHODS.enterpriseMembersRevoke,
      onSuccess: ({ environmentId }, registry) =>
        Effect.sync(() => refreshAll(registry, environmentId)),
    }),
  };
}

export function selectPersonalThreads<
  T extends { readonly enterpriseOwnerEmail?: string | undefined },
>(threads: ReadonlyArray<T>, email: string | null) {
  return threads.filter((thread) =>
    email === null
      ? thread.enterpriseOwnerEmail === undefined
      : thread.enterpriseOwnerEmail === email,
  );
}

export function groupTeamThreads(
  summaries: ReadonlyArray<TeamThreadSummary>,
  members: ReadonlyArray<EnterpriseOrgMember>,
  ownEmail: string | null,
) {
  const groups = new Map<
    string,
    { displayName: string; isMe: boolean; threads: TeamThreadSummary[] }
  >();
  for (const member of members) {
    if (member.memberKey !== undefined)
      groups.set(member.memberKey, {
        displayName: member.displayName,
        isMe: member.isMe,
        threads: [],
      });
  }
  const hasRoster = groups.size > 0;
  for (const summary of summaries) {
    if (summary.publicationStatus !== "read-only") continue;
    const key = teamMemberKey(summary.ownerEmail);
    let group = groups.get(key);
    if (group === undefined) {
      if (hasRoster) continue;
      group = {
        displayName: summary.ownerDisplayName,
        isMe: summary.ownerEmail === ownEmail,
        threads: [],
      };
      groups.set(key, group);
    }
    group.threads.push(summary);
  }
  return [...groups]
    .filter(([, member]) => member.threads.length > 0)
    .map(([key, member]) => ({ key, ...member }));
}
