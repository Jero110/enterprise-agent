import { describe, expect, it } from "@effect/vitest";
import {
  EnterpriseError,
  ProjectId,
  ProviderInstanceId,
  ServerSettings as ServerSettingsSchema,
  ThreadId,
  type TeamThreadSnapshot,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Schema from "effect/Schema";
import * as Result from "effect/Result";
import * as EnterpriseClient from "../enterprise/EnterpriseClient.ts";
import * as ThreadLaunch from "../orchestration-v2/ThreadLaunchService.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as TeamContinuation from "./TeamContinuation.ts";

const decodeSettings = Schema.decodeUnknownSync(ServerSettingsSchema);
const projectId = ProjectId.make("destination");
const modelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-6-luna" };
const source = { ownerEmail: "source@example.com", threadId: "published" };
const snapshot: TeamThreadSnapshot = {
  summary: {
    ...source,
    parentThreadId: null,
    title: "Shared work",
    status: "idle",
    updatedAt: "2026-11-08T00:00:00Z",
    ownerDisplayName: "Source",
    publicationStatus: "read-only",
  },
  messages: [
    { role: "user", text: "Question\nwith details", createdAt: "2026-11-07T00:00:00Z" },
    { role: "assistant", text: "Answer", createdAt: "2026-11-07T00:00:01Z" },
  ],
};
const setup = (
  options: {
    denied?: boolean;
    missingProject?: boolean;
    large?: boolean;
    disconnected?: boolean;
    noModel?: boolean;
    noScratch?: boolean;
  } = {},
) => {
  const launches: ThreadLaunch.ThreadLaunchInput[] = [];
  const reads: unknown[] = [];
  const layer = TeamContinuation.layer.pipe(
    Layer.provide(SecureRandom.layerWebCrypto),
    Layer.provide(
      Layer.succeed(EnterpriseClient.EnterpriseClient, {
        status: Effect.succeed({
          identity: options.disconnected
            ? null
            : {
                email: "viewer@example.com",
                displayName: "Viewer",
                hubEnvironmentId: "hub-source",
              },
        }),
        teamGet: (input: unknown) =>
          Effect.sync(() => reads.push(input)).pipe(
            Effect.andThen(
              options.denied
                ? Effect.fail(
                    new EnterpriseError({
                      code: "access_denied",
                      message: "Thread access denied.",
                    }),
                  )
                : Effect.succeed(
                    options.large
                      ? {
                          ...snapshot,
                          messages: [{ ...snapshot.messages[0]!, text: "x".repeat(200_000) }],
                        }
                      : snapshot,
                  ),
            ),
          ),
      } as unknown as EnterpriseClient.EnterpriseClient["Service"]),
    ),
    Layer.provide(
      Layer.succeed(ManagedProjectFolders.ManagedProjectFolders, {
        ensureScratchProject: options.noScratch
          ? Effect.fail(new ManagedProjectFolders.ScratchUnavailableError())
          : Effect.succeed({ projectId }),
      } as unknown as ManagedProjectFolders.ManagedProjectFolders["Service"]),
    ),
    Layer.provide(
      Layer.succeed(ProjectService.ProjectService, {
        listPage: () => Effect.succeed({ projects: [{ id: projectId }], nextCursor: null }),
        getById: () =>
          Effect.succeed(
            options.missingProject
              ? Option.none()
              : Option.some({
                  id: projectId,
                  defaultModelSelection: options.noModel ? null : modelSelection,
                }),
          ),
      } as unknown as ProjectService.ProjectService["Service"]),
    ),
    Layer.provide(
      Layer.succeed(ServerSettings.ServerSettingsService, {
        getSettings: Effect.succeed(
          decodeSettings({ defaultModelSelection: options.noModel ? null : modelSelection }),
        ),
      } as unknown as ServerSettings.ServerSettingsService["Service"]),
    ),
    Layer.provide(
      Layer.succeed(ThreadLaunch.ThreadLaunchService, {
        launch: (input: ThreadLaunch.ThreadLaunchInput) =>
          Effect.sync(() => {
            launches.push(input);
            return { threadId: ThreadId.make("new-thread") };
          }),
      } as unknown as ThreadLaunch.ThreadLaunchService["Service"]),
    ),
  );
  return { layer, launches, reads };
};

describe("TeamContinuation", () => {
  it.effect(
    "rechecks hub access and launches an owner-stamped fresh thread with text and provenance",
    () => {
      const test = setup();
      return Effect.gen(function* () {
        const service = yield* TeamContinuation.TeamContinuation;
        const result = yield* service.continue({ ...source, projectId });
        expect(test.reads).toEqual([source]);
        expect(result.threadId).toBe("new-thread");
        expect(test.launches).toHaveLength(1);
        const launch = test.launches[0]!;
        expect(launch).toMatchObject({
          projectId,
          modelSelection,
          enterpriseOwnerEmail: "viewer@example.com",
          createdFromClientLabel: "Viewer",
          createdBy: "user",
          creationSource: "web",
          runtimeMode: "approval-required",
          workspaceStrategy: { type: "root" },
        });
        expect(launch.initialMessage?.attachments).toEqual([]);
        expect(launch.initialMessage?.text).toContain("source@example.com");
        expect(launch.initialMessage?.text).toContain("hub-source");
        expect(launch.initialMessage?.text).toContain("published");
        expect(launch.initialMessage?.text).toContain(snapshot.summary.updatedAt);
        expect(launch.initialMessage?.text).toContain(JSON.stringify(snapshot.messages));
        expect(launch.importedNativeThread).toBeUndefined();
        expect(launch.linkOrigin).toBeUndefined();
        expect(launch.delegatedFrom).toBeUndefined();
        expect(launch.reuseExistingThread).toBeUndefined();
      }).pipe(Effect.provide(test.layer));
    },
  );

  it.effect("starts in Scratch with the client's model when no project or default exists", () => {
    const test = setup({ noModel: true });
    return Effect.gen(function* () {
      const service = yield* TeamContinuation.TeamContinuation;
      yield* service.continue({ ...source, modelSelection });
      expect(test.launches[0]).toMatchObject({ projectId, modelSelection });
    }).pipe(Effect.provide(test.layer));
  });

  it.effect("falls back to an existing project when Scratch is unavailable", () => {
    const test = setup({ noScratch: true });
    return Effect.gen(function* () {
      const service = yield* TeamContinuation.TeamContinuation;
      yield* service.continue(source);
      expect(test.launches[0]).toMatchObject({ projectId, modelSelection });
    }).pipe(Effect.provide(test.layer));
  });

  it.effect.each([
    { denied: true },
    { missingProject: true },
    { large: true },
    { disconnected: true },
    { noModel: true },
  ])("rejects before creating a thread: %j", (options) => {
    const test = setup(options);
    return Effect.gen(function* () {
      const service = yield* TeamContinuation.TeamContinuation;
      const result = yield* Effect.result(service.continue({ ...source, projectId }));
      expect(Result.isFailure(result)).toBe(true);
      expect(test.launches).toEqual([]);
      if (options.denied)
        expect(Result.isFailure(result) && result.failure._tag).toBe("EnterpriseError");
    }).pipe(Effect.provide(test.layer));
  });
});
