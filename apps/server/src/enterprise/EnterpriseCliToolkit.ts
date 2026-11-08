import {
  OrchestratorMcpFailure,
  EnterpriseError,
  EnterpriseCliKnowledgeListInput,
  EnterpriseCliKnowledgeListResult,
  EnterpriseCliKnowledgeGetInput,
  EnterpriseCliKnowledgeGetResult,
  EnterpriseCliThreadListInput,
  EnterpriseCliThreadListResult,
  EnterpriseCliThreadReadInput,
  EnterpriseCliThreadReadResult,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Fiber from "effect/Fiber";
import * as Effect from "effect/Effect";
import { McpSchema, Tool, Toolkit } from "effect/ai";

import * as McpHttpServer from "../mcp/McpHttpServer.ts";
import * as McpInvocationContext from "../mcp/McpInvocationContext.ts";
import * as McpToolAccess from "../mcp/McpToolAccess.ts";
import { EnterpriseClient } from "./EnterpriseClient.ts";
import { asResult, hubResult } from "./EnterpriseToolkit.ts";

// This profile controls visibility for owner scripts; it is not delegated thread authorization.
const cliProfileMatches = (scope: McpInvocationContext.McpInvocationScope) =>
  scope.thread === undefined &&
  scope.client?.linked !== true &&
  scope.client?.label === "t3 enterprise cli";

const requireCliProfile = McpInvocationContext.McpInvocationContext.pipe(
  Effect.filterOrFail(
    cliProfileMatches,
    () =>
      new EnterpriseError({
        code: "access_denied",
        message: "This transport requires a local Enterprise CLI session.",
      }),
  ),
);

const enabledForCli = () => {
  const fiber = Fiber.getCurrent();
  const scope =
    fiber && Context.getOrUndefined(fiber.context, McpInvocationContext.McpInvocationContext);
  return scope !== undefined && cliProfileMatches(scope);
};

const shared = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [McpInvocationContext.McpInvocationContext],
};

export const EnterpriseCliToolkit = Toolkit.make(
  Tool.make("t3_cli_enterprise_thread_list", {
    ...shared,
    description: "Enterprise CLI thread list transport.",
    parameters: EnterpriseCliThreadListInput,
    success: hubResult(EnterpriseCliThreadListResult),
  })
    .annotate(Tool.Readonly, true)
    .annotate(McpSchema.EnabledWhen, enabledForCli),
  Tool.make("t3_cli_enterprise_thread_get", {
    ...shared,
    description: "Enterprise CLI thread read transport.",
    parameters: EnterpriseCliThreadReadInput,
    success: hubResult(EnterpriseCliThreadReadResult),
  })
    .annotate(Tool.Readonly, true)
    .annotate(McpSchema.EnabledWhen, enabledForCli),
  Tool.make("t3_cli_enterprise_knowledge_list", {
    ...shared,
    description: "Enterprise CLI knowledge list transport.",
    parameters: EnterpriseCliKnowledgeListInput,
    success: hubResult(EnterpriseCliKnowledgeListResult),
  })
    .annotate(Tool.Readonly, true)
    .annotate(McpSchema.EnabledWhen, enabledForCli),
  Tool.make("t3_cli_enterprise_knowledge_get", {
    ...shared,
    description: "Enterprise CLI knowledge read transport.",
    parameters: EnterpriseCliKnowledgeGetInput,
    success: hubResult(EnterpriseCliKnowledgeGetResult),
  })
    .annotate(Tool.Readonly, true)
    .annotate(McpSchema.EnabledWhen, enabledForCli),
);

export const layer = McpToolAccess.toLayer(
  EnterpriseCliToolkit,
  Effect.gen(function* () {
    const client = yield* EnterpriseClient;
    return {
      t3_cli_enterprise_thread_list: McpToolAccess.reads((input) =>
        asResult(
          Effect.gen(function* () {
            yield* requireCliProfile;
            const threads = (yield* client.teamList).filter(
              (thread) => thread.publicationStatus === "read-only",
            );
            const start = input.cursor ?? 0;
            const page = threads.slice(start, start + 100);
            return {
              threads: page,
              nextCursor: start + page.length < threads.length ? start + page.length : null,
            };
          }),
        ),
      ),
      t3_cli_enterprise_thread_get: McpToolAccess.reads((input) =>
        asResult(
          Effect.gen(function* () {
            yield* requireCliProfile;
            const snapshot = yield* client.teamGet({
              ownerEmail: input.ownerEmail,
              threadId: input.threadId,
            });
            const messages: Array<(typeof snapshot.messages)[number]> = [];
            let messageOffset = input.messageOffset ?? 0;
            let textOffset = input.textOffset ?? 0;
            let remaining = 50_000;
            while (
              messageOffset < snapshot.messages.length &&
              messages.length < 100 &&
              remaining > 0
            ) {
              const message = snapshot.messages[messageOffset]!;
              const text = message.text.slice(textOffset, textOffset + remaining);
              messages.push({ ...message, text });
              remaining -= text.length;
              textOffset += text.length;
              if (textOffset < message.text.length) break;
              messageOffset += 1;
              textOffset = 0;
            }
            const hasMore = messageOffset < snapshot.messages.length;
            return {
              summary: snapshot.summary,
              messages,
              nextMessageOffset: hasMore ? messageOffset : null,
              nextTextOffset: hasMore ? textOffset : null,
            };
          }),
        ),
      ),
      t3_cli_enterprise_knowledge_list: McpToolAccess.reads((input) =>
        asResult(
          Effect.gen(function* () {
            yield* requireCliProfile;
            const { documents } = yield* client.knowledgeList;
            const start = input.cursor ?? 0;
            const page = documents.slice(start, start + 100);
            return {
              documents: page,
              nextCursor: start + page.length < documents.length ? start + page.length : null,
            };
          }),
        ),
      ),
      t3_cli_enterprise_knowledge_get: McpToolAccess.reads((input) =>
        asResult(
          Effect.gen(function* () {
            yield* requireCliProfile;
            const document = yield* client.knowledgeGet({ path: input.path });
            const start = input.textOffset ?? 0;
            return {
              ...document,
              content: document.content.slice(start, start + 50_000),
              nextTextOffset: start + 50_000 < document.content.length ? start + 50_000 : null,
            };
          }),
        ),
      ),
    };
  }),
);

export const layerRegistration = McpHttpServer.toolkitRegistration(EnterpriseCliToolkit, layer);
