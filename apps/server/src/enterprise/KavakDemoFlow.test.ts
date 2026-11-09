import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ProviderInstanceId, type OrchestrationV2ServerCommand } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Layer from "effect/Layer";
import * as SecureRandom from "effect/crypto/SecureRandom";

import * as ServerConfig from "../config.ts";
import { layerKnowledge } from "../knowledge/KnowledgeRepo.testkit.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as EnterpriseHub from "./EnterpriseHub.ts";
import * as EnterpriseIngestion from "./EnterpriseIngestion.ts";
import * as IngestionSources from "./IngestionSources.ts";
import { layerSeededStore } from "./EnterpriseStore.testkit.ts";

const organization = `people:
  - email: jeronimo.deli@gmail.com
    name: Demo admin
    area: ai-eng
    role: admin
  - email: clara@example.com
    name: Clara
    area: cx
    role: lead
  - email: nico@example.com
    name: Nico
    area: cx
    role: member
    reportsTo: clara@example.com
  - email: vera@example.com
    name: Vera
    area: sales
    role: lead
`;
const areas = `areas:
  - id: ai-eng
    name: AI Engineering
  - id: cx
    name: Customer Experience
  - id: sales
    name: Sales
`;
const meeting = `Meet · 2026-04-12 · Attendees: Clara (CX), Nico (CX), Vera (Sales)
Clara: We agreed to design a partner discount campaign, but not to launch it yet.
Vera: The historical discount is recorded in Sales; the amount has not been confirmed here.
Nico: I will check the Sales record and send the source to Clara by Tuesday.
Clara: I will draft the design after Nico confirms the source. Budget approval remains pending.
`;
const repoUrl = "https://github.com/mellamanelpoeta/kavak-kb";
const commit = "a".repeat(40);
const api = "https://api.github.com/repos/mellamanelpoeta/kavak-kb";
const sourceText = "# README\nSynthetic customer experience source.";
const responses: Record<string, { body: string; type: string }> = {
  [api]: { body: JSON.stringify({ default_branch: "main" }), type: "application/json" },
  [`${api}/commits/main`]: { body: JSON.stringify({ sha: commit }), type: "application/json" },
  [`${api}/git/trees/${commit}?recursive=1`]: {
    body: JSON.stringify({
      truncated: false,
      tree: [{ path: "raw/README.md", type: "blob", mode: "100644", size: sourceText.length }],
    }),
    type: "application/json",
  },
  [`https://raw.githubusercontent.com/mellamanelpoeta/kavak-kb/${commit}/raw/README.md`]: {
    body: sourceText,
    type: "text/plain",
  },
};

const layerFor = (commands: OrchestrationV2ServerCommand[]) =>
  EnterpriseIngestion.layer.pipe(
    Layer.provideMerge(EnterpriseHub.layer),
    Layer.provideMerge(IngestionSources.layer),
    Layer.provideMerge(
      Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) =>
          Effect.sync(() => {
            const response = responses[request.url];
            expect(response).toBeDefined();
            return HttpClientResponse.fromWeb(
              request,
              new Response(response!.body, { headers: { "content-type": response!.type } }),
            );
          }),
        ),
      ),
    ),
    Layer.provideMerge(layerKnowledge),
    Layer.provideMerge(layerSeededStore),
    Layer.provideMerge(
      Layer.succeed(ProjectService.ProjectService, {
        bootstrap: (input: { projectId: string }) =>
          Effect.succeed({ project: { id: input.projectId }, created: true }),
      } as unknown as ProjectService.ProjectService["Service"]),
    ),
    Layer.provideMerge(
      Layer.succeed(ThreadManagement.ThreadManagementService, {
        dispatch: (command: OrchestrationV2ServerCommand) =>
          Effect.sync(() => {
            commands.push(command);
            return {} as never;
          }),
      } as unknown as ThreadManagement.ThreadManagementService["Service"]),
    ),
    Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-demo-flow-" })),
    Layer.provideMerge(
      Layer.mergeAll(NodeServices.layer, NodeCrypto.layer, SecureRandom.layerWebCrypto),
    ),
  );

describe("Kavak demo flow", () => {
  it.effect(
    "stages a repository URL, two org YAML files and synthetic Meet notes in one run",
    () => {
      const commands: OrchestrationV2ServerCommand[] = [];
      return Effect.gen(function* () {
        const hub = yield* EnterpriseHub.EnterpriseHub;
        const ingestion = yield* EnterpriseIngestion.EnterpriseIngestion;
        const fs = yield* FileSystem.FileSystem;
        yield* hub.enroll("admin", {
          email: "jeronimo.deli@gmail.com",
          token: "ACME-BANK-DEV-2026",
        });
        const imported = yield* hub.orgImport("admin", { organization, areas }, true);
        expect(imported.applied).toBe(true);
        const upload = yield* hub.proposalUpload("admin", {
          scope: "cx",
          reason: "Fictional organizational inputs for an ingestion run",
          files: [
            {
              name: "organization.yaml",
              mimeType: "text/yaml",
              base64: Buffer.from(organization).toString("base64"),
            },
            {
              name: "areas.yaml",
              mimeType: "text/yaml",
              base64: Buffer.from(areas).toString("base64"),
            },
          ],
        });
        const run = yield* ingestion.start("admin", {
          destination: "cx",
          sourceUrls: [repoUrl],
          uploadProposalIds: [upload.id],
          note: meeting,
          modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-6-luna" },
        });
        const message = commands.find((command) => command.type === "message.dispatch");
        expect(JSON.parse(/Member note \(data\): (.+)/.exec(message!.text)![1]!)).toBe(
          meeting.trim(),
        );
        const paths = JSON.parse(
          /Selected sources \(data\): (.+)/.exec(message!.text)![1]!,
        ) as string[];
        expect(paths).toHaveLength(3);
        expect(yield* fs.readFileString(paths[0]!)).toBe(sourceText);
        expect(paths[0]).toContain(`/github/mellamanelpoeta/kavak-kb/${commit}/raw/README.md`);
        expect(paths.slice(1).map((path) => path.split("/").at(-1))).toEqual([
          "organization.yaml",
          "areas.yaml",
        ]);
        expect(run.threadId).toBeTruthy();
      }).pipe(Effect.provide(layerFor(commands)));
    },
  );
});
