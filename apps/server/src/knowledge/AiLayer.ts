import { EnterpriseError } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { Tool } from "effect/ai";
import { stringify } from "yaml";
import { EnterpriseToolkit } from "../enterprise/EnterpriseToolkit.ts";
import { EnterpriseCliToolkit } from "../enterprise/EnterpriseCliToolkit.ts";
import { EnterpriseTeamToolkit } from "../enterprise/EnterpriseTeamToolkit.ts";
import { KnowledgeToolkit } from "../enterprise/KnowledgeToolkit.ts";
import { AttachmentToolkit } from "../mcp/toolkits/attachment/tools.ts";
import { DeviceToolkit } from "../mcp/toolkits/device/tools.ts";
import { EnvironmentToolkit } from "../mcp/toolkits/environment/tools.ts";
import { HtmlToolkit } from "../mcp/toolkits/html/tools.ts";
import { OrchestratorToolkit } from "../mcp/toolkits/orchestrator/tools.ts";
import { PreviewToolkit } from "../mcp/toolkits/preview/tools.ts";
import { PreviewControlsToolkit } from "../mcp/toolkits/previewControls/tools.ts";
import { ProjectToolkit } from "../mcp/toolkits/project/tools.ts";
import { PullRequestsToolkit } from "../mcp/toolkits/pullRequests/tools.ts";
import { ThreadToolkit } from "../mcp/toolkits/thread/tools.ts";
import { WorktreeToolkit } from "../mcp/toolkits/worktree/tools.ts";
import { ProjectBoardToolkit } from "../project/ProjectBoardToolkit.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import { forkParked } from "../serverActivation.ts";
import * as KnowledgeRepo from "./KnowledgeRepo.ts";

export const toolkits = [
  AttachmentToolkit,
  DeviceToolkit,
  EnvironmentToolkit,
  HtmlToolkit,
  OrchestratorToolkit,
  PreviewToolkit,
  PreviewControlsToolkit,
  ProjectToolkit,
  PullRequestsToolkit,
  ThreadToolkit,
  WorktreeToolkit,
  ProjectBoardToolkit,
  EnterpriseToolkit,
  EnterpriseCliToolkit,
  EnterpriseTeamToolkit,
  KnowledgeToolkit,
];

export class AiLayer extends Context.Service<
  AiLayer,
  {
    readonly generate: () => Effect.Effect<void, EnterpriseError>;
  }
>()("t3/knowledge/AiLayer") {}

const document = (title: string, description: string, body: string) =>
  `---\n${stringify({ title, description, area: "general", layer: "ai", private: false })}---\n${body}\n`;

export const layer = Layer.effect(
  AiLayer,
  Effect.gen(function* () {
    const repo = yield* KnowledgeRepo.KnowledgeRepo;
    const providers = yield* ProviderRegistry.ProviderRegistry;
    const fs = yield* FileSystem.FileSystem;
    const generate = Effect.fn("AiLayer.generate")(function* () {
      const tools = new Map(
        toolkits
          .flatMap((toolkit) => Object.values(toolkit.tools))
          .map((tool) => [tool.name, tool]),
      );
      const files = [...tools.values()]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((tool) => ({
          path: `global/ai/tools/${tool.name}.md`,
          content: document(
            tool.name,
            `Built-in MCP tool: ${tool.name}`,
            `# ${tool.name}\n\n${Tool.getDescription(tool) ?? ""}`,
          ),
        }));
      for (const provider of yield* providers.getProviders) {
        for (const skill of provider.skills) {
          const body = yield* fs
            .readFileString(skill.path)
            .pipe(Effect.orElseSucceed(() => "Skill source is currently unavailable."));
          const name = encodeURIComponent(`${provider.instanceId}-${skill.name}`).replace(
            /[!'()*]/g,
            (character) => `%${character.charCodeAt(0).toString(16)}`,
          );
          files.push({
            path: `global/ai/skills/skill-${name}.md`,
            content: document(
              skill.name,
              skill.description ?? `Harness skill: ${skill.name}`,
              `# ${skill.name}\n\nSource: ${skill.path}\n\n${body}`,
            ),
          });
        }
      }
      yield* repo.syncAiDocuments(files);
    });
    return AiLayer.of({ generate });
  }),
);

export const layerGeneration = Layer.effectDiscard(
  Effect.gen(function* () {
    const ai = yield* AiLayer;
    const providers = yield* ProviderRegistry.ProviderRegistry;
    const attempt = ai
      .generate()
      .pipe(Effect.catchCause((cause) => Effect.logWarning("AI layer generation failed", cause)));
    yield* attempt;
    yield* providers.streamChanges.pipe(
      Stream.runForEach(() => attempt),
      forkParked,
    );
  }),
);
