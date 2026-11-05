import {
  EnterpriseError,
  ThreadId,
  type TeamThreadPublishInput,
  type TeamThreadReportSummary,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import * as EnterpriseClient from "../enterprise/EnterpriseClient.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ApplicationEvents from "../persistence/OrchestrationEventStore.ts";
import { forkParked } from "../serverActivation.ts";

export class TeamReporter extends Context.Service<
  TeamReporter,
  {
    readonly publish: (
      input: TeamThreadPublishInput,
    ) => Effect.Effect<{ readonly updated: boolean }, EnterpriseError>;
    readonly start: Effect.Effect<void, never, Scope.Scope>;
  }
>()("t3/team/TeamReporter") {}

export const layer = Layer.effect(
  TeamReporter,
  Effect.gen(function* () {
    const client = yield* EnterpriseClient.EnterpriseClient;
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    const events = yield* ApplicationEvents.OrchestrationEventStore;
    const lock = yield* Semaphore.make(1);
    const projectionError = () =>
      new EnterpriseError({
        code: "thread_not_found",
        message: "Could not read the local thread projection.",
      });

    const reportSummaries = Effect.fn("TeamReporter.reportSummaries")(function* () {
      const identity = (yield* client.status).identity;
      if (identity === null) return null;
      const shell = yield* projections.getShellSnapshot().pipe(Effect.mapError(projectionError));
      const ids = new Set(shell.threads.map((thread) => thread.id));
      const summaries: TeamThreadReportSummary[] = shell.threads.map((thread) => ({
        threadId: thread.id,
        parentThreadId:
          thread.lineage.relationshipToParent === "subagent" &&
          thread.lineage.parentThreadId !== null &&
          ids.has(thread.lineage.parentThreadId)
            ? thread.lineage.parentThreadId
            : null,
        title: thread.title.trim() || "Untitled thread",
        status:
          thread.archivedAt !== null ? "archived" : thread.activeRunId !== null ? "active" : "idle",
        updatedAt: DateTime.formatIso(thread.updatedAt),
      }));
      yield* client.teamReport({ summaries, snapshots: [] });
      return { identity, ids };
    });
    const upload = Effect.fn("TeamReporter.upload")(function* (
      local: NonNullable<Effect.Success<ReturnType<typeof reportSummaries>>>,
      threadIds?: ReadonlySet<string>,
    ) {
      const summaries = yield* client.teamList;
      const published = summaries.filter(
        (summary) =>
          summary.ownerEmail === local.identity.email &&
          summary.publicationStatus === "read-only" &&
          local.ids.has(ThreadId.make(summary.threadId)) &&
          (threadIds === undefined || threadIds.has(summary.threadId)),
      );
      for (const summary of published) {
        const records = yield* projections
          .getThreadRecords(ThreadId.make(summary.threadId), ["messages"])
          .pipe(Effect.mapError(projectionError));
        const messages = records.messages
          .filter((message) => !message.streaming)
          .map((message) => ({
            role: message.role,
            text: message.text,
            createdAt: DateTime.formatIso(message.createdAt),
          }));
        yield* client.teamReport({
          summaries: [],
          snapshots: [{ threadId: summary.threadId, messages }],
        });
      }
    });
    const publish: TeamReporter["Service"]["publish"] = Effect.fn("TeamReporter.publish")(
      function* (input) {
        const local = yield* reportSummaries();
        if (local === null)
          return yield* new EnterpriseError({
            code: "not_connected",
            message: "Connect to your enterprise first.",
          });
        if (!local.ids.has(ThreadId.make(input.threadId)))
          return yield* new EnterpriseError({
            code: "thread_not_found",
            message: "Local thread not found.",
          });
        const result = yield* client.teamPublish(input);
        if (input.status === "read-only") yield* upload(local);
        return result;
      },
      lock.withPermits(1),
    );

    const sync = Effect.fn("TeamReporter.sync")(function* (
      threadIds: ReadonlySet<string> | undefined,
    ) {
      const local = yield* reportSummaries();
      if (local !== null && (threadIds === undefined || threadIds.size > 0))
        yield* upload(local, threadIds);
    }, lock.withPermits(1));
    const bestEffort = <A>(effect: Effect.Effect<A, EnterpriseError>) =>
      effect.pipe(Effect.catchTags({ EnterpriseError: () => Effect.void }));
    const start = Effect.gen(function* () {
      const afterSequence = yield* events.latestApplicationSequence.pipe(Effect.orDie);
      const committed = events
        .streamProjectedApplicationEvents({
          afterSequence,
          filter: (stored) =>
            "event" in stored &&
            (stored.event.type.startsWith("thread.") ||
              stored.event.type === "run.created" ||
              stored.event.type === "run.updated"),
          project: (stored) => ({
            sequence: stored.sequence,
            threadId: "event" in stored ? stored.event.threadId : null,
            upload:
              "event" in stored &&
              (stored.event.type.startsWith("thread.") ||
                (stored.event.type === "run.updated" &&
                  ["completed", "failed", "interrupted", "cancelled", "rolled_back"].includes(
                    stored.event.payload.status,
                  ))),
          }),
        })
        .pipe(
          Stream.groupedWithin(256, Duration.millis(100)),
          Stream.mapEffect((batch) =>
            bestEffort(
              sync(
                new Set(
                  Array.from(batch).flatMap((event) =>
                    event.threadId === null || !event.upload ? [] : [event.threadId],
                  ),
                ),
              ),
            ),
          ),
          Stream.catch(() => Stream.empty),
        );
      yield* Effect.all(
        [
          Stream.merge(
            committed,
            client.connectionChanges.pipe(Stream.mapEffect(() => bestEffort(sync(undefined)))),
          ).pipe(Stream.runDrain),
          bestEffort(sync(undefined)),
        ],
        { concurrency: "unbounded" },
      ).pipe(forkParked);
    });
    return TeamReporter.of({ publish, start });
  }),
);
