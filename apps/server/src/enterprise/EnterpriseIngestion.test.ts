import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as IngestionSources from "./IngestionSources.ts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  ProviderInstanceId,
  EnvironmentId,
  ThreadId,
  type ApplicationStoredEvent,
  type OrchestrationV2ServerCommand,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as FileSystem from "effect/FileSystem";
import * as Deferred from "effect/Deferred";
import * as Stream from "effect/Stream";
import * as ApplicationEvents from "../persistence/OrchestrationEventStore.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as KnowledgeProposals from "./KnowledgeProposals.ts";
import * as McpInvocationContext from "../mcp/McpInvocationContext.ts";
import { hubSessionId } from "./EnterpriseToolkit.ts";
import * as Result from "effect/Result";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as ServerConfig from "../config.ts";
import { stringify } from "yaml";
import { teamMemberKey } from "@t3tools/shared/teamMemberKey";
import { documentOf } from "../knowledge/KnowledgeRepo.ts";
import { layerKnowledge } from "../knowledge/KnowledgeRepo.testkit.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as EnterpriseHub from "./EnterpriseHub.ts";
import * as EnterpriseIngestion from "./EnterpriseIngestion.ts";
import * as EnterpriseStore from "./EnterpriseStore.ts";
import { layerSeededStore } from "./EnterpriseStore.testkit.ts";

const token = "ACME-BANK-DEV-2026";
const modelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-6-luna" };
const layerFor = (commands: OrchestrationV2ServerCommand[], responseStatus = 200) =>
  EnterpriseIngestion.layer.pipe(
    Layer.provideMerge(EnterpriseHub.layer),
    Layer.provideMerge(IngestionSources.layer),
    Layer.provideMerge(
      Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) =>
          Effect.succeed(
            HttpClientResponse.fromWeb(
              request,
              new Response("Public source content", { status: responseStatus }),
            ),
          ),
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
    Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-ingestion-" })),
    Layer.provideMerge(
      Layer.mergeAll(NodeServices.layer, NodeCrypto.layer, SecureRandom.layerWebCrypto),
    ),
  );

describe("EnterpriseIngestion", () => {
  it.effect("stages public URL sources and rejects unsafe URLs", () => {
    const commands: OrchestrationV2ServerCommand[] = [];
    return Effect.gen(function* () {
      const hub = yield* EnterpriseHub.EnterpriseHub;
      const ingestion = yield* EnterpriseIngestion.EnterpriseIngestion;
      const fs = yield* FileSystem.FileSystem;
      yield* hub.enroll("admin", { email: "jeronimo.deli@gmail.com", token });
      for (const url of [
        "file:///etc/passwd",
        "http://localhost/a",
        "https://127.0.0.1/a",
        "https://user:password@example.com/a",
      ]) {
        expect(
          Result.isFailure(
            yield* Effect.result(ingestion.start("admin", { sourceUrls: [url], modelSelection })),
          ),
        ).toBe(true);
      }
      expect(commands).toEqual([]);
      yield* ingestion.start("admin", {
        sourceUrls: ["https://example.com/notes.txt"],
        modelSelection,
      });
      const message = commands.find((command) => command.type === "message.dispatch")!;
      const paths = JSON.parse(
        /Selected sources \(data\): (.+)/.exec(message.text)![1]!,
      ) as string[];
      expect(yield* fs.readFileString(paths[0]!)).toContain("Public source content");
    }).pipe(Effect.provide(layerFor(commands)));
  });
  it.effect("stages 55 folder files across uploads without flattening equal basenames", () => {
    const commands: OrchestrationV2ServerCommand[] = [];
    return Effect.gen(function* () {
      const hub = yield* EnterpriseHub.EnterpriseHub;
      const proposals = yield* KnowledgeProposals.KnowledgeProposals;
      const ingestion = yield* EnterpriseIngestion.EnterpriseIngestion;
      const fs = yield* FileSystem.FileSystem;
      yield* hub.enroll("admin", { email: "jeronimo.deli@gmail.com", token });
      const files = Array.from({ length: 55 }, (_, index) => ({
        name: "note.md",
        relativePath: `raw/${index < 28 ? "cx" : "ventas"}/${index}/note.md`,
        mimeType: "text/markdown",
        bytes: new TextEncoder().encode(`source ${index}`),
      }));
      const uploadProposalIds: string[] = [];
      for (let index = 0; index < files.length; index += 20) {
        const upload = yield* proposals.upload("jeronimo.deli@gmail.com", {
          scope: "global",
          reason: "Folder batch",
          files: files.slice(index, index + 20),
        });
        uploadProposalIds.push(upload.id);
      }
      yield* ingestion.start("admin", { destination: "global", uploadProposalIds, modelSelection });
      const message = commands.find((command) => command.type === "message.dispatch")!;
      const paths = JSON.parse(
        /Selected sources \(data\): (.+)/.exec(message.text)![1]!,
      ) as string[];
      expect(paths).toHaveLength(55);
      expect(paths.find((source) => source.endsWith("/raw/cx/0/note.md"))).toBeDefined();
      expect(paths.find((source) => source.endsWith("/raw/ventas/28/note.md"))).toBeDefined();
      expect(
        yield* fs.readFileString(paths.find((source) => source.endsWith("/raw/cx/0/note.md"))!),
      ).toBe("source 0");
      expect(
        yield* fs.readFileString(
          paths.find((source) => source.endsWith("/raw/ventas/28/note.md"))!,
        ),
      ).toBe("source 28");
      const store = yield* EnterpriseStore.EnterpriseStore;
      const persisted = (yield* store.listProposals).find(
        (item) => item.id === uploadProposalIds[0],
      )!;
      yield* store.saveProposal({
        ...persisted,
        files: [{ ...persisted.files![0]!, relativePath: "raw/../escape.md" }],
      });
      const invalid = yield* Effect.result(
        ingestion.start("admin", { destination: "global", uploadProposalIds, modelSelection }),
      );
      expect(Result.isFailure(invalid) && invalid.failure.code).toBe("ingestion_failed");
      expect(commands.filter((command) => command.type === "message.dispatch")).toHaveLength(1);
    }).pipe(Effect.provide(layerFor(commands)));
  });
  it.effect("rejects redirects rather than following to an internal endpoint", () => {
    const commands: OrchestrationV2ServerCommand[] = [];
    return Effect.gen(function* () {
      const hub = yield* EnterpriseHub.EnterpriseHub;
      const ingestion = yield* EnterpriseIngestion.EnterpriseIngestion;
      yield* hub.enroll("admin", { email: "jeronimo.deli@gmail.com", token });
      const result = yield* Effect.result(
        ingestion.start("admin", {
          sourceUrls: ["https://example.com/redirect"],
          modelSelection,
        }),
      );
      expect(Result.isFailure(result) && result.failure.code).toBe("ingestion_failed");
      expect(commands).toEqual([]);
    }).pipe(Effect.provide(layerFor(commands, 302)));
  });
  it.effect(
    "members cannot browse hub folders and can propose only their own personal nodes",
    () => {
      const commands: OrchestrationV2ServerCommand[] = [];
      return Effect.gen(function* () {
        const hub = yield* EnterpriseHub.EnterpriseHub;
        const ingestion = yield* EnterpriseIngestion.EnterpriseIngestion;
        yield* hub.enroll("ana", { email: "ent.test.ana@gmail.com", token });
        const result = yield* Effect.result(
          ingestion.start("ana", { folder: "/not-needed", modelSelection }),
        );
        expect(Result.isFailure(result) && result.failure.code).toBe("admin_required");
        expect(commands).toEqual([]);
        const run = yield* ingestion.start("ana", {
          note: "My process",
          destination: "personal",
          modelSelection,
        });
        const owner = teamMemberKey("ent.test.ana@gmail.com");
        const proposal = {
          kind: "create",
          scope: "personal",
          path: `personal/${owner}/process.md`,
          content:
            "---\ntitle: Process\ndescription: Personal process\narea: personal\nlayer: business\nprivate: true\n---\nMy process",
          reason: "Personal note",
          evidence: [],
        } as const;
        for (const forged of [
          { ...proposal, scope: "global", path: "global/process.md" },
          { ...proposal, path: `personal/${teamMemberKey("jeronimo.deli@gmail.com")}/process.md` },
          { ...proposal, kind: "move-scope" as const, targetScope: "global" },
        ]) {
          const denied = yield* Effect.result(hub.ingestionPropose(run.threadId, forged));
          expect(Result.isFailure(denied) && denied.failure.code).toBe("access_denied");
        }
        const accepted = yield* hub.ingestionPropose(run.threadId, proposal);
        expect(accepted).toMatchObject({
          scope: "personal",
          recipient: "ent.test.ana@gmail.com",
          status: "pending",
        });
        yield* hub.enroll("admin", { email: "jeronimo.deli@gmail.com", token });
        expect(
          (yield* hub.proposalInbox("admin", {})).proposals.some((p) => p.id === accepted.id),
        ).toBe(false);
        const otherDecision = yield* Effect.result(
          hub.proposalDecide("admin", { id: accepted.id, action: "approve" }),
        );
        expect(Result.isFailure(otherDecision) && otherDecision.failure.code).toBe(
          "proposal_not_found",
        );
        const approved = yield* hub.proposalDecide("ana", { id: accepted.id, action: "approve" });
        expect(approved.status).toBe("applied");
      }).pipe(Effect.provide(layerFor(commands)));
    },
  );
  it.effect(
    "skips completed content hashes, retries failures and supports note-only runs with an index",
    () => {
      const commands: OrchestrationV2ServerCommand[] = [];
      return Effect.gen(function* () {
        const hub = yield* EnterpriseHub.EnterpriseHub;
        const ingestion = yield* EnterpriseIngestion.EnterpriseIngestion;
        const proposals = yield* KnowledgeProposals.KnowledgeProposals;
        const store = yield* EnterpriseStore.EnterpriseStore;
        const fs = yield* FileSystem.FileSystem;
        yield* hub.enroll("admin", { email: "jeronimo.deli@gmail.com", token });
        const bytes = new Uint8Array([0, 255, 128, 10]);
        const upload = yield* proposals.upload("jeronimo.deli@gmail.com", {
          scope: "global",
          reason: "Bucket",
          files: [{ name: "opaque.bin", mimeType: "application/octet-stream", bytes }],
        });
        const input = { uploadProposalIds: [upload.id], modelSelection };
        const first = yield* ingestion.start("admin", input);
        const firstMessage = commands.find((command) => command.type === "message.dispatch");
        const source = /Selected sources \(data\): (.+)/.exec(firstMessage!.text)!;
        const sourcePath = (JSON.parse(source[1]!) as string[])[0]!;
        expect(Array.from(yield* fs.readFile(sourcePath))).toEqual(Array.from(bytes));
        yield* ingestion.finish(first.threadId, "failed");
        expect((yield* store.getIngestionRun(first.threadId))?.status).toBe("failed");
        const retry = yield* ingestion.start("admin", input);
        yield* ingestion.finish(retry.threadId, "completed");
        const second = yield* ingestion.start("admin", input);
        expect((yield* store.getIngestionRun(second.threadId))?.status).toBe("completed");
        expect(commands.filter((command) => command.type === "message.dispatch")).toHaveLength(2);
        yield* ingestion.start("admin", { note: "We're missing payment owners", modelSelection });
        const message = commands.filter((command) => command.type === "message.dispatch").at(-1)!;
        expect(message.text).toContain("We're missing payment owners");
        expect(message.text).toContain('"path":"global/overview.md"');
        expect(message.text).not.toContain('"path":"areas/ledger/README.md"');
        expect(message.text).toContain("Existing node index");
        const invalid = yield* Effect.result(ingestion.start("admin", { modelSelection }));
        expect(Result.isFailure(invalid)).toBe(true);
      }).pipe(Effect.provide(layerFor(commands)));
    },
  );
  it.effect(
    "reconciles terminal runs after restart and persists live failures from committed events",
    () => {
      const commands: OrchestrationV2ServerCommand[] = [];
      return Effect.gen(function* () {
        const store = yield* EnterpriseStore.EnterpriseStore;
        const ingestion = yield* EnterpriseIngestion.EnterpriseIngestion;
        for (const threadId of ["restart", "live"]) {
          yield* store.saveIngestionRun({
            id: threadId,
            threadId,
            adminEmail: "jeronimo.deli@gmail.com",
            folder: "/bucket",
            status: "running",
          });
        }
        const settled = yield* Deferred.make<void>();
        const tracker = EnterpriseIngestion.layerTracking.pipe(
          Layer.provide(
            Layer.succeed(EnterpriseIngestion.EnterpriseIngestion, {
              ...ingestion,
              finish: (threadId, status) =>
                ingestion
                  .finish(threadId, status)
                  .pipe(
                    Effect.tap(() =>
                      threadId === "live" ? Deferred.succeed(settled, undefined) : Effect.void,
                    ),
                  ),
            }),
          ),
          Layer.provide(Layer.succeed(EnterpriseStore.EnterpriseStore, store)),
          Layer.provide(
            Layer.succeed(ProjectionStore.ProjectionStoreV2, {
              getThreadRecords: (threadId: string) =>
                Effect.succeed({
                  runs: [{ status: threadId === "restart" ? "completed" : "running" }],
                }),
            } as unknown as ProjectionStore.ProjectionStoreV2["Service"]),
          ),
          Layer.provide(
            Layer.succeed(ApplicationEvents.OrchestrationEventStore, {
              latestApplicationSequence: Effect.succeed(0),
              streamProjectedApplicationEvents: ({
                project,
                filter,
              }: {
                project: (event: ApplicationStoredEvent) => { sequence: number };
                filter: (event: ApplicationStoredEvent) => boolean;
              }) => {
                const event = {
                  sequence: 1,
                  event: { type: "run.updated", threadId: "live", payload: { status: "failed" } },
                } as unknown as ApplicationStoredEvent;
                return Stream.fromIterable(filter(event) ? [project(event)] : []);
              },
            } as unknown as ApplicationEvents.OrchestrationEventStore["Service"]),
          ),
        );
        yield* Layer.build(tracker);
        yield* Deferred.await(settled);
        expect((yield* store.getIngestionRun("restart"))?.status).toBe("completed");
        expect((yield* store.getIngestionRun("live"))?.status).toBe("failed");
      }).pipe(Effect.provide(layerFor(commands)));
    },
  );
  it.effect(
    "stages the Kavak Meet transcript and accepts CX Business nodes with Iker as percentage owner, without applying them",
    () => {
      const commands: OrchestrationV2ServerCommand[] = [];
      return Effect.gen(function* () {
        const hub = yield* EnterpriseHub.EnterpriseHub;
        const ingestion = yield* EnterpriseIngestion.EnterpriseIngestion;
        const fs = yield* FileSystem.FileSystem;
        yield* hub.enroll("admin", { email: "jeronimo.deli@gmail.com", token });
        yield* hub.orgImport(
          "admin",
          {
            areas: stringify({
              areas: [
                { id: "ai-eng", name: "AI Engineering" },
                { id: "cx", name: "CX" },
                { id: "sales", name: "Sales" },
              ],
            }),
            organization: stringify({
              people: [
                {
                  email: "jeronimo.deli@gmail.com",
                  name: "Demo admin",
                  area: "ai-eng",
                  role: "admin",
                },
                {
                  email: "francisco@example.com",
                  name: "Francisco",
                  area: "ai-eng",
                  role: "member",
                },
                { email: "maria@example.com", name: "María", area: "cx", role: "lead" },
                {
                  email: "iker@example.com",
                  name: "Iker",
                  area: "cx",
                  role: "member",
                  reportsTo: "maria@example.com",
                },
                { email: "magdalena@example.com", name: "Magdalena", area: "sales", role: "lead" },
              ],
            }),
          },
          true,
        );
        const transcript = yield* fs.readFile(
          new URL("./fixtures/kavak-planning.meet.txt", import.meta.url).pathname,
        );
        const upload = yield* hub.proposalUpload("admin", {
          scope: "cx",
          reason: "Planning call bucket",
          files: [
            {
              name: "kavak-planning.meet.txt",
              mimeType: "text/plain",
              base64: Buffer.from(transcript).toString("base64"),
            },
          ],
        });
        const run = yield* ingestion.start("admin", {
          uploadProposalIds: [upload.id],
          destination: "cx",
          modelSelection,
        });
        const message = commands.find((command) => command.type === "message.dispatch")!;
        for (const value of [
          "Francisco",
          "María",
          "Iker",
          "Magdalena",
          '"cx"',
          '"sales"',
          "speaker attribution",
          "decisions",
          "owners",
        ])
          expect(message.text).toContain(value);
        const stagedPath = (
          JSON.parse(/Selected sources \(data\): (.+)/.exec(message.text)![1]!) as string[]
        )[0]!;
        expect(Array.from(yield* fs.readFile(stagedPath))).toEqual(Array.from(transcript));
        const plan = "areas/cx/kavak-promo-plan.md";
        const action = "areas/cx/kavak-find-percentage.md";
        const proposed = [];
        for (const node of [
          {
            path: plan,
            title: "Plan de promoción Kavak",
            links: [action],
            body: "Decisión (02:05): preparar el diseño, sin autorizar ni lanzar la campaña. María es responsable del plan. Francisco revisa la solicitud por Sequoia esta tarde (00:52).",
          },
          {
            path: action,
            title: "Encontrar el porcentaje histórico Kavak",
            links: [plan],
            body: "Responsable: Iker (01:15–01:40). Buscar el porcentaje y su fuente en Sales, liderada por Magdalena, y compartirlo con María. El porcentaje todavía es desconocido; no inferir un valor de la transcripción.",
          },
        ]) {
          proposed.push(
            yield* hub.ingestionPropose(run.threadId, {
              kind: "create",
              scope: "cx",
              path: node.path,
              content: `---\n${stringify({ title: node.title, description: node.title, area: "cx", layer: "business", private: true, links: node.links })}---\n${node.body}\n`,
              reason:
                "Extract the planning decision and its separately owned follow-up from the Meet call.",
              evidence: [`${stagedPath}:3-8`],
            }),
          );
        }
        expect(
          proposed.map((proposal) => ({
            ...documentOf(proposal.path, proposal.content!),
            status: proposal.status,
          })),
        ).toEqual([
          expect.objectContaining({
            id: plan,
            areaId: "cx",
            layer: "business",
            private: true,
            links: [action],
            status: "pending",
            content: expect.stringContaining("María"),
          }),
          expect.objectContaining({
            id: action,
            areaId: "cx",
            layer: "business",
            private: true,
            links: [plan],
            status: "pending",
            content: expect.stringContaining("Responsable: Iker"),
          }),
        ]);
        expect(
          (yield* hub.knowledgeGraph("admin")).nodes.some(
            (node) => node.id === plan || node.id === action,
          ),
        ).toBe(false);
      }).pipe(Effect.provide(layerFor(commands)));
    },
  );
  it.effect(
    "accepts text meeting notes and keeps agreed decisions, pending authorization and owned next steps as unapplied proposals",
    () => {
      const commands: OrchestrationV2ServerCommand[] = [];
      return Effect.gen(function* () {
        const hub = yield* EnterpriseHub.EnterpriseHub;
        const ingestion = yield* EnterpriseIngestion.EnterpriseIngestion;
        const fs = yield* FileSystem.FileSystem;
        yield* hub.enroll("admin", { email: "jeronimo.deli@gmail.com", token });
        const bytes = yield* fs.readFile(
          new URL("./fixtures/meet-notes.synthetic.txt", import.meta.url).pathname,
        );
        const upload = yield* hub.proposalUpload("admin", {
          scope: "ledger",
          reason: "Synthetic meeting notes",
          files: [
            {
              name: "meeting.txt",
              mimeType: "text/plain",
              base64: Buffer.from(bytes).toString("base64"),
            },
          ],
        });
        const run = yield* ingestion.start("admin", {
          uploadProposalIds: [upload.id],
          destination: "ledger",
          modelSelection,
        });
        const message = commands.find((command) => command.type === "message.dispatch")!;
        const staged = (
          JSON.parse(/Selected sources \(data\): (.+)/.exec(message.text)![1]!) as string[]
        )[0]!;
        expect(Array.from(yield* fs.readFile(staged))).toEqual(Array.from(bytes));
        expect(message.text).toContain("A pending decision is not approved");
        const proposal = yield* hub.ingestionPropose(run.threadId, {
          kind: "create",
          scope: "ledger",
          path: "areas/ledger/catalog-review.md",
          content:
            "---\ntitle: Catalog review\ndescription: Synthetic review notes\narea: ledger\nlayer: business\nprivate: true\n---\nACORDADA: prepare a draft, not publish it. PENDIENTE: budget approval. Next steps: Persona Alfa prepares a draft; Persona Beta checks sources. No production change was executed.",
          reason: "Preserve decision status and owners",
          evidence: [staged],
        });
        expect(proposal.status).toBe("pending");
        expect(proposal.content).toContain("PENDIENTE: budget approval");
        expect(proposal.content).toContain("Persona Beta");
        expect(
          (yield* hub.knowledgeGraph("admin")).nodes.some((node) => node.id === proposal.path),
        ).toBe(false);
      }).pipe(Effect.provide(layerFor(commands)));
    },
  );
  it.effect(
    "classifies a manual raw folder without staging other areas or personal sources into the selected area",
    () => {
      const commands: OrchestrationV2ServerCommand[] = [];
      return Effect.gen(function* () {
        const hub = yield* EnterpriseHub.EnterpriseHub;
        const ingestion = yield* EnterpriseIngestion.EnterpriseIngestion;
        const fs = yield* FileSystem.FileSystem;
        yield* hub.enroll("admin", { email: "jeronimo.deli@gmail.com", token });
        const files = [
          {
            relativePath: "raw/_manifest.csv",
            text: "path,tipo_fuente,area_acceso,owner,fecha,descripcion\nmeet/morning.txt,meet,ledger,persona-alfa,2026-01-02,Reunión sintética\nrisk/restricted.txt,documento_md,risk,persona-beta,2026-01-02,Política restringida\npersonal/private.txt,documento_md,personal/persona-alfa,persona-alfa,2026-01-02,Nota privada\n",
          },
          {
            relativePath: "raw/meet/morning.txt",
            text: "ACORDADA: preparar borrador. PENDIENTE: autorización. Persona Alfa revisa.",
          },
          { relativePath: "raw/risk/restricted.txt", text: "RESTRICTED_MUST_NOT_BE_STAGED" },
          { relativePath: "raw/personal/private.txt", text: "PERSONAL_MUST_NOT_BE_STAGED" },
        ];
        const upload = yield* hub.proposalUpload("admin", {
          scope: "ledger",
          reason: "Synthetic manual bucket",
          files: files.map((file) => ({
            name: file.relativePath.split("/").at(-1)!,
            relativePath: file.relativePath,
            mimeType: "text/plain",
            base64: Buffer.from(file.text).toString("base64"),
          })),
        });
        const run = yield* ingestion.start("admin", {
          destination: "ledger",
          uploadProposalIds: [upload.id],
          modelSelection,
        });
        const message = commands.find((command) => command.type === "message.dispatch")!;
        const paths = JSON.parse(
          /Selected sources \(data\): (.+)/.exec(message.text)![1]!,
        ) as string[];
        expect(paths).toHaveLength(1);
        expect(paths[0]).toContain("raw/meet/morning.txt");
        expect(yield* fs.readFileString(paths[0]!)).toBe(files[1]!.text);
        expect(message.text).toContain('"owner":"persona-alfa"');
        expect(message.text).toContain('"layer":"business"');
        expect(run.skippedSources).toHaveLength(2);
        for (const file of files.slice(2))
          expect(
            yield* fs.exists(paths[0]!.replace("raw/meet/morning.txt", file.relativePath)),
          ).toBe(false);
      }).pipe(Effect.provide(layerFor(commands)));
    },
  );
  it.effect("starts an ordinary thread attributed to the authenticated admin", () => {
    const commands: OrchestrationV2ServerCommand[] = [];
    return Effect.gen(function* () {
      const hub = yield* EnterpriseHub.EnterpriseHub;
      const store = yield* EnterpriseStore.EnterpriseStore;
      const ingestion = yield* EnterpriseIngestion.EnterpriseIngestion;
      yield* hub.enroll("admin", { email: "jeronimo.deli@gmail.com", token });
      const fs = yield* FileSystem.FileSystem;
      const folder = yield* fs.makeTempDirectoryScoped();
      yield* fs.writeFileString(`${folder}/meeting.txt`, "Ana: I own the ledger decision.");
      const result = yield* ingestion.start("admin", { folder, modelSelection });
      expect(commands.map((command) => command.type)).toEqual([
        "thread.create",
        "message.dispatch",
      ]);
      expect(commands[0]).toMatchObject({ threadId: result.threadId, modelSelection });
      const message = commands.find((command) => command.type === "message.dispatch");
      expect(message?.text).toContain("Organization and areas");
      expect(message?.text).toContain("Ledger");
      expect(message?.text).toContain("Mutating tool allowlist: knowledge_propose only.");
      expect(message?.text).toContain(
        "Read-only allowlist: read/grep/list over the selected bucket and enterprise knowledge reads (knowledge_graph, knowledge_get, knowledge_list, knowledge_search, knowledge_proposals).",
      );
      expect(message?.text).toContain(
        "No file writes, mutating shell commands, or other enterprise mutations are allowed.",
      );
      expect(message?.text).toContain(
        "Never call knowledge_proposal_decide, knowledge_upload_files, enterprise_ingest_start, or enterprise_org_import.",
      );
      expect(message?.text).toContain("Metrics, Business, AI, Data");
      expect(message?.text).toContain("Existing node index");
      const otherEnterpriseTools = yield* Effect.result(
        hubSessionId(hub).pipe(
          Effect.provideService(McpInvocationContext.McpInvocationContext, {
            environmentId: EnvironmentId.make("hub"),
            capabilities: new Set<McpInvocationContext.McpCapability>(),
            issuedAt: 0,
            requestNamespace: "ingestion",
            client: undefined,
            thread: {
              threadId: ThreadId.make(result.threadId),
              providerSessionId: "ingestion",
              providerInstanceId: modelSelection.instanceId,
            },
          }),
        ),
      );
      expect(Result.isFailure(otherEnterpriseTools) && otherEnterpriseTools.failure.code).toBe(
        "access_denied",
      );
      expect(yield* store.getIngestionRun(result.threadId)).toMatchObject({
        id: result.runId,
        adminEmail: "jeronimo.deli@gmail.com",
        folder,
        status: "running",
      });
    }).pipe(Effect.provide(layerFor(commands)));
  });
});
