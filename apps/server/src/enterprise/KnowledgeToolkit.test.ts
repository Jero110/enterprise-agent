import { expect, it } from "@effect/vitest";
import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as McpInvocationContext from "../mcp/McpInvocationContext.ts";
import * as McpToolAccess from "../mcp/McpToolAccess.ts";
import { liveThreadShell } from "../mcp/McpToolAccess.testkit.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import { EnterpriseClient } from "./EnterpriseClient.ts";
import { KnowledgeToolkit, layerMember } from "./KnowledgeToolkit.ts";
import { ThreadKnowledge } from "./ThreadKnowledge.ts";

it.effect(
  "graph reads respect a conversation's knowledge switches without hiding area previews",
  () =>
    Effect.gen(function* () {
      const toolkit = yield* KnowledgeToolkit;
      const result = yield* toolkit
        .handle("knowledge_graph", {})
        .pipe(Stream.unwrap, Stream.runCollect);
      expect(result.at(-1)?.result).toEqual({
        ok: true,
        value: {
          nodes: [
            {
              id: "areas/risk/model.md",
              areaId: "risk",
              title: "Risk",
              description: "Model",
              layer: "data",
              private: true,
              links: [],
              accessible: false,
            },
            {
              id: "global/overview.md",
              areaId: "general",
              title: "Overview",
              description: "Public",
              layer: "business",
              private: false,
              links: [],
              accessible: true,
              content: "Public body",
            },
          ],
        },
      });
    }).pipe(
      Effect.provide(
        McpToolAccess.HandlersLayer.layer(layerMember).pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.mock(EnterpriseClient)({
                knowledgeGraph: Effect.succeed({
                  nodes: [
                    {
                      id: "areas/risk/model.md",
                      areaId: "risk",
                      title: "Risk",
                      description: "Model",
                      layer: "data",
                      private: true,
                      links: [],
                      accessible: true,
                      content: "Risk secret",
                    },
                    {
                      id: "personal/owner/skill.md",
                      areaId: "personal",
                      title: "Skill",
                      description: "Shared skill",
                      layer: "ai",
                      private: true,
                      links: [],
                      accessible: true,
                      content: "Skill body",
                    },
                    {
                      id: "global/overview.md",
                      areaId: "general",
                      title: "Overview",
                      description: "Public",
                      layer: "business",
                      private: false,
                      links: [],
                      accessible: true,
                      content: "Public body",
                    },
                  ],
                }),
              }),
              Layer.mock(ThreadKnowledge)({
                allows: (_threadId, areaId) => Effect.succeed(areaId === "general"),
              }),
              Layer.mock(ThreadManagement.ThreadManagementService)({
                getThreadShell: () => Effect.succeed(liveThreadShell(ThreadId.make("caller"))),
              }),
            ),
          ),
        ),
      ),
      Effect.provideService(McpInvocationContext.McpInvocationContext, {
        environmentId: EnvironmentId.make("member"),
        capabilities: new Set<"orchestration">(),
        issuedAt: 0,
        requestNamespace: "knowledge-test",
        client: undefined,
        thread: {
          threadId: ThreadId.make("caller"),
          providerInstanceId: ProviderInstanceId.make("codex"),
          providerSessionId: "session",
        },
      }),
    ),
);
