import {
  EnterpriseAuthorizeMemberInput,
  EnterpriseError,
  EnterpriseHubIdentity,
  EnterpriseMembers,
  OrchestratorMcpFailure,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

import * as McpHttpServer from "../mcp/McpHttpServer.ts";
import * as McpInvocationContext from "../mcp/McpInvocationContext.ts";
import * as McpToolAccess from "../mcp/McpToolAccess.ts";
import { EnterpriseHub } from "./EnterpriseHub.ts";

/**
 * Refusals travel as data, so the member's IDE can tell a wrong token from a
 * revoked email; `OrchestratorMcpFailure` has no codes for either.
 */
export const hubResult = <S extends Schema.Top>(value: S) =>
  Schema.Union([
    Schema.Struct({ ok: Schema.Literal(true), value }),
    Schema.Struct({
      ok: Schema.Literal(false),
      code: EnterpriseError.fields.code,
      message: Schema.String,
    }),
  ]);

const shared = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [McpInvocationContext.McpInvocationContext, EnterpriseHub],
};

const emptyParameters = Tool.EmptyParams;

const EnrollTool = Tool.make("enterprise_enroll", {
  ...shared,
  description:
    "Bind this connection to an enterprise member with their email and the enterprise token. Members' IDEs call it right after linking.",
  parameters: Schema.Struct({ email: Schema.String, token: Schema.String }),
  success: hubResult(EnterpriseHubIdentity),
}).annotate(Tool.Destructive, false);
const WhoAmITool = Tool.make("enterprise_whoami", {
  ...shared,
  description: "The member this connection is bound to; fails once their email is revoked.",
  parameters: emptyParameters,
  success: hubResult(EnterpriseHubIdentity),
}).annotate(Tool.Readonly, true);
const DisconnectTool = Tool.make("enterprise_disconnect", {
  ...shared,
  description: "Unbind this connection from its enterprise member.",
  parameters: emptyParameters,
  success: Schema.Struct({ disconnected: Schema.Boolean }),
}).annotate(Tool.Destructive, false);
const MembersTool = Tool.make("enterprise_members", {
  ...shared,
  description: "Admin only: every enterprise member and team.",
  parameters: emptyParameters,
  success: hubResult(EnterpriseMembers),
}).annotate(Tool.Readonly, true);
const AuthorizeTool = Tool.make("enterprise_member_authorize", {
  ...shared,
  description:
    "Admin only: authorize an email, or change a member's name, team and role. Un-revokes a revoked email.",
  parameters: EnterpriseAuthorizeMemberInput,
  success: hubResult(EnterpriseMembers),
}).annotate(Tool.Destructive, false);
const RevokeTool = Tool.make("enterprise_member_revoke", {
  ...shared,
  description: "Admin only: revoke an email; its next call to the hub fails.",
  parameters: Schema.Struct({ email: Schema.String }),
  success: hubResult(EnterpriseMembers),
}).annotate(Tool.Destructive, true);

export const EnterpriseToolkit = Toolkit.make(
  EnrollTool,
  WhoAmITool,
  DisconnectTool,
  MembersTool,
  AuthorizeTool,
  RevokeTool,
);

const noSession = new EnterpriseError({
  code: "not_connected",
  message: "Only a linked member IDE can use the enterprise hub.",
});

/** The session the hub binds members to: the MCP client's, never an argument. */
const sessionId = McpInvocationContext.McpInvocationContext.pipe(
  Effect.flatMap((scope) =>
    scope.client === undefined ? Effect.fail(noSession) : Effect.succeed(scope.client.sessionId),
  ),
);

const asResult = <A, R>(effect: Effect.Effect<A, EnterpriseError, R>) =>
  effect.pipe(
    Effect.map((value) => ({ ok: true as const, value })),
    Effect.catchTags({
      EnterpriseError: ({ code, message }) => Effect.succeed({ ok: false as const, code, message }),
    }),
  );

// Admin rights come from the hub's member record, not from the link's access, so reads fit all.
export const layer = McpToolAccess.toLayer(
  EnterpriseToolkit,
  Effect.gen(function* () {
    const hub = yield* EnterpriseHub;
    return {
      enterprise_enroll: McpToolAccess.reads((input) =>
        asResult(Effect.flatMap(sessionId, (id) => hub.enroll(id, input))),
      ),
      enterprise_whoami: McpToolAccess.reads(() => asResult(Effect.flatMap(sessionId, hub.whoami))),
      enterprise_disconnect: McpToolAccess.reads(() =>
        sessionId.pipe(
          Effect.flatMap(hub.disconnect),
          Effect.map((disconnected) => ({ disconnected })),
          Effect.orElseSucceed(() => ({ disconnected: false })),
        ),
      ),
      enterprise_members: McpToolAccess.reads(() =>
        asResult(Effect.flatMap(sessionId, hub.listMembers)),
      ),
      enterprise_member_authorize: McpToolAccess.reads((input) =>
        asResult(Effect.flatMap(sessionId, (id) => hub.authorize(id, input))),
      ),
      enterprise_member_revoke: McpToolAccess.reads((input) =>
        asResult(Effect.flatMap(sessionId, (id) => hub.revoke(id, input))),
      ),
    };
  }),
);

/** Registers the tools on a hub's `/mcp`; needs `EnterpriseHub`. */
export const layerRegistration = McpHttpServer.toolkitRegistration(EnterpriseToolkit, layer);
