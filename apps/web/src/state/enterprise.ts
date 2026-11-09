import {
  createEnterpriseEnvironmentAtoms,
  selectPersonalThreads,
} from "@t3tools/client-runtime/state/enterprise";
import { createEnterpriseFileCommands } from "@t3tools/client-runtime/state/enterpriseFiles";

import { t } from "~/i18n";
import { connectionAtomRuntime } from "../connection/runtime";
import { useQuietThreadShells } from "./entities";
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

/** The message a failed enterprise call carries, without its tag, in the user's language when known. */
export function enterpriseFailureMessage(failure: unknown): string {
  return failure instanceof Error && failure.message.length > 0
    ? t(failure.message)
    : t("The enterprise hub request failed.");
}

export function useOwnThreadShells() {
  const threads = useQuietThreadShells();
  const { identity, isPending } = useEnterpriseStatus();
  return isPending ? [] : selectPersonalThreads(threads, identity?.email ?? null);
}
