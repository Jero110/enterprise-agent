import { EnterpriseError, ThreadId, type TeamThreadReportSummary } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import * as EnterpriseStore from "../enterprise/EnterpriseStore.ts";
import * as EnterpriseThreadAuthor from "../enterprise/EnterpriseThreadAuthor.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ApplicationEvents from "../persistence/OrchestrationEventStore.ts";
import { forkParked } from "../serverActivation.ts";
import * as TeamPublication from "./TeamPublication.ts";
import * as TeamReporter from "./TeamReporter.ts";

const make = Effect.gen(function* () {
  const store = yield* EnterpriseStore.EnterpriseStore;
  const publication = yield* TeamPublication.TeamPublication;
  const author = yield* EnterpriseThreadAuthor.EnterpriseThreadAuthor;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const events = yield* ApplicationEvents.OrchestrationEventStore;
  const lock = yield* Semaphore.make(1);
  const projectionError = () =>
    new EnterpriseError({
      code: "thread_not_found",
      message: "Could not read the hub thread projection.",
    });
  const ownerSession = (email: string) => `hub-thread-owner:${email}`;

  const sync = Effect.fn("HubTeamReporter.sync")(function* (
    changed?: ReadonlySet<string>,
    onlyOwner?: string,
  ) {
    const shell = yield* projections.getShellSnapshot().pipe(Effect.mapError(projectionError));
    const byOwner = new Map<string, TeamThreadReportSummary[]>();
    for (const thread of shell.threads) {
      const email = thread.enterpriseOwnerEmail;
      if (email === undefined) continue;
      const summaries = byOwner.get(email) ?? [];
      summaries.push({
        threadId: thread.id,
        parentThreadId:
          thread.lineage.relationshipToParent === "subagent" ? thread.lineage.parentThreadId : null,
        title: thread.title.trim() || "Untitled thread",
        status:
          thread.archivedAt !== null ? "archived" : thread.activeRunId !== null ? "active" : "idle",
        updatedAt: DateTime.formatIso(thread.updatedAt),
      });
      byOwner.set(email, summaries);
    }
    for (const [email, summaries] of byOwner) {
      if (onlyOwner !== undefined && email !== onlyOwner) continue;
      if (!(yield* store.canEnter(email))) continue;
      const sessionId = ownerSession(email);
      yield* store.enroll({ environmentId: sessionId, email });
      yield* publication.report(sessionId, { summaries, snapshots: [] });
      const local = new Set(summaries.map((summary) => summary.threadId));
      const shared = (yield* publication.list(sessionId)).filter(
        (summary) =>
          summary.ownerEmail === email &&
          local.has(summary.threadId) &&
          summary.publicationStatus === "read-only" &&
          (changed === undefined || changed.has(summary.threadId)),
      );
      for (const summary of shared) {
        const records = yield* projections
          .getThreadRecords(ThreadId.make(summary.threadId), ["messages"])
          .pipe(Effect.mapError(projectionError));
        yield* publication.report(sessionId, {
          summaries: [],
          snapshots: [
            {
              threadId: summary.threadId,
              messages: records.messages
                .filter((message) => !message.streaming)
                .map((message) => ({
                  role: message.role,
                  text: message.text,
                  createdAt: DateTime.formatIso(message.createdAt),
                })),
            },
          ],
        });
      }
    }
  });

  const publish: TeamReporter.TeamReporter["Service"]["publish"] = Effect.fn(
    "HubTeamReporter.publish",
  )(
    function* (input, session) {
      const member = session === undefined ? null : yield* author.author(session);
      const projection = yield* projections
        .getThreadRecords(ThreadId.make(input.threadId), [])
        .pipe(Effect.mapError(projectionError));
      if (member === null || projection.thread.enterpriseOwnerEmail !== member.email) {
        return yield* new EnterpriseError({
          code: "access_denied",
          message: "Only the conversation's owner can change sharing.",
        });
      }
      yield* sync(new Set());
      const result = yield* publication.publish(ownerSession(member.email), input);
      if (input.status === "read-only") yield* sync(undefined, member.email);
      return result;
    },
    (effect) => lock.withPermits(1)(effect),
  );

  const start = Effect.gen(function* () {
    const afterSequence = yield* events.latestApplicationSequence.pipe(Effect.orDie);
    const committed = events
      .streamProjectedApplicationEvents({
        afterSequence,
        filter: (stored) =>
          "event" in stored &&
          (stored.event.type.startsWith("thread.") ||
            (stored.event.type === "message.updated" && !stored.event.payload.streaming) ||
            stored.event.type === "run.created" ||
            stored.event.type === "run.updated"),
        project: (stored) => ({
          sequence: stored.sequence,
          threadId: "event" in stored ? stored.event.threadId : null,
        }),
      })
      .pipe(
        Stream.groupedWithin(256, "100 millis"),
        Stream.mapEffect((batch) =>
          sync(
            new Set(
              Array.from(batch).flatMap((event) =>
                event.threadId === null ? [] : [event.threadId],
              ),
            ),
          ).pipe(lock.withPermits(1), Effect.ignore),
        ),
        Stream.catch(() => Stream.empty),
      );
    yield* Effect.all(
      [committed.pipe(Stream.runDrain), sync(new Set()).pipe(lock.withPermits(1), Effect.ignore)],
      { discard: true },
    ).pipe(forkParked);
  });
  return TeamReporter.TeamReporter.of({ publish, start });
});

export const layer = Layer.effect(TeamReporter.TeamReporter, make);
