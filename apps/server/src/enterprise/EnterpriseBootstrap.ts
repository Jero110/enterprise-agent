import {
  type EnterpriseBootstrapResult,
  type EnterpriseLoginInput,
  type EnterpriseError,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as EnterpriseHub from "./EnterpriseHub.ts";

export class EnterpriseBootstrap extends Context.Service<
  EnterpriseBootstrap,
  {
    readonly connect: (
      input: EnterpriseLoginInput,
    ) => Effect.Effect<
      EnterpriseBootstrapResult,
      EnterpriseError | EnvironmentAuth.ServerAuthInternalError
    >;
  }
>()("t3/enterprise/EnterpriseBootstrap") {}

const make = Effect.gen(function* () {
  const hub = yield* EnterpriseHub.EnterpriseHub;
  const auth = yield* EnvironmentAuth.EnvironmentAuth;
  const environment = yield* ServerEnvironment.ServerEnvironment;

  const connect: EnterpriseBootstrap["Service"]["connect"] = Effect.fn(
    "EnterpriseBootstrap.connect",
  )(function* (input) {
    const identity = yield* hub.authenticate(input);
    const descriptor = yield* environment.getDescriptor;
    const mcp = yield* auth.issueMcpClientSession({
      label: `Enterprise · ${identity.email}`,
      access: "read-only",
      peerLink: false,
      client: { deviceType: "bot" },
    });
    return yield* Effect.gen(function* () {
      yield* hub.enroll(mcp.sessionId, input);
      return {
        identity,
        environmentId: descriptor.environmentId,
        label: descriptor.label,
        mcpToken: mcp.token,
        mcpExpiresAt: DateTime.toUtc(mcp.expiresAt),
      };
    }).pipe(
      Effect.onError(() =>
        Effect.all([
          hub.disconnect(mcp.sessionId),
          auth.revokeSession(mcp.sessionId).pipe(Effect.ignore),
        ]),
      ),
    );
  });
  return EnterpriseBootstrap.of({ connect });
});

export const layer = Layer.effect(EnterpriseBootstrap, make);
