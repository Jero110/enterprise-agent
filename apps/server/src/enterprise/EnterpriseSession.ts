import type { AuthSessionId } from "@t3tools/contracts";
import * as Context from "effect/Context";

export class EnterpriseSession extends Context.Reference<AuthSessionId | null>(
  "t3/enterprise/EnterpriseSession",
  { defaultValue: () => null },
) {}
