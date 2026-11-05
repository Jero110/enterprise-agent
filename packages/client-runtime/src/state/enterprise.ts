import { type EnvironmentId, WS_METHODS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { Atom, type AtomRegistry } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcCommand, createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";

export function createEnterpriseEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  // Every read asks the hub, which is what makes a revoked email fail on its next use.
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
    registry.refresh(knowledgeList({ environmentId, input: {} }));
    registry.refresh(proposalInbox({ environmentId, input: {} }));
    registry.refresh(proposalInbox({ environmentId, input: { countOnly: true } }));
    registry.refresh(teamThreads({ environmentId, input: {} }));
  };
  return {
    status,
    members,
    knowledgeList,
    knowledgeGet,
    proposalInbox,
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
