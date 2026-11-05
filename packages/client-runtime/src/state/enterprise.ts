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
  // Re-asks the hub rather than patching: identity and member list change on its word alone.
  const refreshAll = (registry: AtomRegistry.AtomRegistry, environmentId: EnvironmentId) => {
    registry.refresh(status({ environmentId, input: {} }));
    registry.refresh(members({ environmentId, input: {} }));
  };
  return {
    status,
    members,
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
