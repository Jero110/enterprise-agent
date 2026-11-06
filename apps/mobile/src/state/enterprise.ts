import { createEnterpriseEnvironmentAtoms } from "@t3tools/client-runtime/state/enterprise";
import { createEnterpriseFileCommands } from "@t3tools/client-runtime/state/enterpriseFiles";
import { connectionAtomRuntime } from "../connection/runtime";

export const enterpriseEnvironment = createEnterpriseEnvironmentAtoms(connectionAtomRuntime);
export const enterpriseFiles = createEnterpriseFileCommands(connectionAtomRuntime);
