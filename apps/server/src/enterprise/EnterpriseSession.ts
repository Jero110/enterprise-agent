import type { AuthSessionId } from "@t3tools/contracts";
import * as Context from "effect/Context";

export class EnterpriseSession extends Context.Reference<AuthSessionId | null>(
  "t3/enterprise/EnterpriseSession",
  { defaultValue: () => null },
) {}

/** Hub-local agents have no client session; they act as the member signed in on this hub. */
export const HOST_AGENT_SESSION = "enterprise-host-agents";
