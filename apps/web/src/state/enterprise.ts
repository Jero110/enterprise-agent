import { createEnterpriseEnvironmentAtoms } from "@t3tools/client-runtime/state/enterprise";
import { createEnterpriseFileCommands } from "@t3tools/client-runtime/state/enterpriseFiles";

import { connectionAtomRuntime } from "../connection/runtime";
import { usePrimaryEnvironmentId } from "./environments";
import { useEnvironmentQuery } from "./query";

export const enterpriseEnvironment = createEnterpriseEnvironmentAtoms(connectionAtomRuntime);
export const enterpriseFiles = createEnterpriseFileCommands(connectionAtomRuntime);

/** The primary environment's enterprise identity, as the hub last confirmed it. */
export function useEnterpriseStatus() {
  const environmentId = usePrimaryEnvironmentId();
  const status = useEnvironmentQuery(
    environmentId === null ? null : enterpriseEnvironment.status({ environmentId, input: {} }),
  );
  return {
    environmentId,
    identity: status.data?.identity ?? null,
    error: status.error,
    isPending: status.isPending && status.data === null,
  };
}

/** The message a failed enterprise call carries, without its tag. */
export function enterpriseFailureMessage(failure: unknown): string {
  return failure instanceof Error && failure.message.length > 0
    ? failure.message
    : "The enterprise hub request failed.";
}
