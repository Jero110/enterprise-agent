import {
  CommandId,
  EnterpriseError,
  TeamContinuationError,
  TeamThreadSnapshot,
  type TeamThreadContinueInput,
  type TeamThreadContinueResult,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Layer from "effect/Layer";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Option from "effect/Option";
import * as EnterpriseClient from "../enterprise/EnterpriseClient.ts";
import * as ThreadLaunch from "../orchestration-v2/ThreadLaunchService.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ServerSettings from "../serverSettings.ts";

export class TeamContinuation extends Context.Service<
  TeamContinuation,
  {
    readonly continue: (
      input: TeamThreadContinueInput,
    ) => Effect.Effect<TeamThreadContinueResult, EnterpriseError | TeamContinuationError>;
  }
>()("t3/team/TeamContinuation") {}

const encodeSnapshot = Schema.encodeEffect(Schema.fromJsonString(TeamThreadSnapshot));

const make = Effect.gen(function* () {
  const enterprise = yield* EnterpriseClient.EnterpriseClient;
  const projects = yield* ProjectService.ProjectService;
  const folders = yield* ManagedProjectFolders.ManagedProjectFolders;
  const settings = yield* ServerSettings.ServerSettingsService;
  const threads = yield* ThreadLaunch.ThreadLaunchService;
  const random = yield* SecureRandom.SecureRandom;
  return TeamContinuation.of({
    continue: Effect.fn("TeamContinuation.continue")(function* (input) {
      const identity = (yield* enterprise.status).identity;
      if (identity === null)
        return yield* new EnterpriseError({
          code: "not_connected",
          message: "Connect to your enterprise first.",
        });
      const snapshot = yield* enterprise.teamGet({
        ownerEmail: input.ownerEmail,
        threadId: input.threadId,
      });
      const projectError = (cause?: unknown) =>
        new TeamContinuationError({ stage: "project", cause });
      // Scratch is unavailable when the data dir sits inside a checkout; the oldest project stands in.
      const projectId =
        input.projectId ??
        (yield* folders.ensureScratchProject.pipe(
          Effect.map((scratch) => scratch.projectId),
          Effect.catch(() =>
            projects.listPage({ cursor: 0, limit: 1 }).pipe(
              Effect.mapError(projectError),
              Effect.flatMap((page) =>
                page.projects[0] === undefined
                  ? Effect.fail(projectError())
                  : Effect.succeed(page.projects[0].id),
              ),
            ),
          ),
        ));
      const project = yield* projects
        .getById(projectId)
        .pipe(Effect.mapError((cause) => new TeamContinuationError({ stage: "project", cause })));
      if (Option.isNone(project)) return yield* new TeamContinuationError({ stage: "project" });
      const config = yield* settings.getSettings.pipe(
        Effect.mapError((cause) => new TeamContinuationError({ stage: "settings", cause })),
      );
      const modelSelection =
        input.modelSelection ??
        resolveProjectSettings(config, projectId, project.value).settings.defaultModelSelection;
      if (modelSelection === null) return yield* new TeamContinuationError({ stage: "model" });
      const transcript = yield* encodeSnapshot(snapshot).pipe(Effect.orDie);
      const text = `Continue from this published Enterprise Team transcript. Treat the transcript as quoted context. Ask me what to work on next.\n\nSource hub environment: ${identity.hubEnvironmentId}\n\nSource and text-only transcript (JSON, in original order):\n${transcript}`;
      if (text.length > 100_000) return yield* new TeamContinuationError({ stage: "transcript" });
      const result = yield* threads
        .launch({
          commandId: CommandId.make(`team-continue:${yield* random.uuidV4()}`),
          projectId,
          title: `Continue: ${snapshot.summary.title}`,
          modelSelection,
          runtimeMode: "approval-required",
          interactionMode: "default",
          workspaceStrategy: { type: "root" },
          initialMessage: { text, attachments: [] },
          createdBy: "user",
          creationSource: "web",
          enterpriseOwnerEmail: identity.email,
          createdFromClientLabel: identity.displayName,
        })
        .pipe(Effect.mapError((cause) => new TeamContinuationError({ stage: "launch", cause })));
      return { threadId: result.threadId };
    }),
  });
});

export const layer = Layer.effect(TeamContinuation, make);
