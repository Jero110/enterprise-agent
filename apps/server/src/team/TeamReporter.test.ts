import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  EventId,
  MessageId,
  NodeId,
  RunId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationV2DomainEvent,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as SecureRandom from "effect/crypto/SecureRandom";
import { TestClock } from "effect/testing";

import * as EnterpriseClient from "../enterprise/EnterpriseClient.ts";
import * as EnterpriseStore from "../enterprise/EnterpriseStore.ts";
import { layerSeededStore } from "../enterprise/EnterpriseStore.testkit.ts";
import * as ApplicationEvents from "../persistence/OrchestrationEventStore.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as TeamPublication from "./TeamPublication.ts";
import * as TeamReporter from "./TeamReporter.ts";

it.effect(
  "reports committed metadata and uploads compact snapshots on publish and subsequent commits",
  () => {
    const email = "ent.test.hugo@gmail.com";
    return Effect.gen(function* () {
      const reports = yield* Queue.unbounded<void>();
      const clientLayer = Layer.unwrap(
        Effect.gen(function* () {
          const hub = yield* TeamPublication.TeamPublication;
          return Layer.mock(EnterpriseClient.EnterpriseClient)({
            status: Effect.succeed({
              identity: {
                email,
                displayName: "Hugo",
                teamId: "frontend",
                teamName: "Frontend",
                role: "member",
                hubEnvironmentId: EnvironmentId.make("hub"),
              },
            }),
            connectionChanges: Stream.empty,
            teamList: hub.list(email),
            teamPublish: (input) => hub.publish(email, input),
            teamReport: (input) =>
              hub.report(email, input).pipe(Effect.tap(() => Queue.offer(reports, undefined))),
          });
        }),
      );
      const local = TeamReporter.layer.pipe(
        Layer.provideMerge(clientLayer),
        Layer.provideMerge(
          Layer.mergeAll(ProjectionStore.layer, ApplicationEvents.layer, TeamPublication.layer),
        ),
        Layer.provideMerge(layerSeededStore),
      );
      yield* Effect.gen(function* () {
        const store = yield* EnterpriseStore.EnterpriseStore;
        yield* store.enroll({ environmentId: email, email });
        const pub = yield* TeamPublication.TeamPublication;
        const reporter = yield* TeamReporter.TeamReporter;
        const projection = yield* ProjectionStore.ProjectionStoreV2;
        const events = yield* ApplicationEvents.OrchestrationEventStore;
        const now = DateTime.makeUnsafe("2026-11-05T00:00:00Z");
        const threadId = ThreadId.make("local-thread");
        const providerInstanceId = ProviderInstanceId.make("codex");
        const created: OrchestrationV2DomainEvent = {
          id: EventId.make("created"),
          type: "thread.created",
          threadId,
          occurredAt: now,
          payload: {
            createdBy: "user",
            creationSource: "web",
            id: threadId,
            projectId: ProjectId.make("project"),
            title: "Original",
            providerInstanceId,
            modelSelection: { instanceId: providerInstanceId, model: "test" },
            runtimeMode: "approval-required",
            interactionMode: "default",
            branch: null,
            worktreePath: null,
            activeProviderThreadId: null,
            lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
            forkedFrom: null,
            createdAt: now,
            updatedAt: now,
            archivedAt: null,
            settledOverride: null,
            settledAt: null,
            lastVisitedAt: null,
            deletedAt: null,
          },
        };
        yield* projection.apply(created);
        yield* reporter.start;
        yield* Queue.take(reports);
        expect(yield* pub.list(email)).toMatchObject([
          { title: "Original", publicationStatus: "unpublished" },
        ]);
        const message: OrchestrationV2DomainEvent = {
          id: EventId.make("message"),
          type: "message.updated",
          threadId,
          occurredAt: now,
          payload: {
            id: MessageId.make("message"),
            threadId,
            runId: null,
            nodeId: null,
            role: "assistant",
            text: "Published text",
            streaming: false,
            attachments: [],
            createdAt: now,
            updatedAt: now,
            createdBy: "agent",
            creationSource: "server",
          },
        };
        yield* projection.apply(message);
        yield* reporter.publish({ threadId, status: "read-only" });
        yield* Queue.take(reports);
        yield* Queue.take(reports);
        expect((yield* pub.get(email, { ownerEmail: email, threadId })).messages).toEqual([
          { role: "assistant", text: "Published text", createdAt: DateTime.formatIso(now) },
        ]);
        const running: OrchestrationV2DomainEvent = {
          id: EventId.make("run"),
          type: "run.created",
          threadId,
          occurredAt: now,
          payload: {
            id: RunId.make("run"),
            threadId,
            ordinal: 1,
            providerInstanceId,
            modelSelection: { instanceId: providerInstanceId, model: "test" },
            providerThreadId: null,
            userMessageId: MessageId.make("message"),
            rootNodeId: NodeId.make("node"),
            activeAttemptId: null,
            status: "running",
            requestedAt: now,
            startedAt: now,
            completedAt: null,
            checkpointId: null,
            contextHandoffId: null,
          },
        };
        yield* projection.apply(running);
        yield* events.publishCommitted(yield* events.appendAgentEvents({ events: [running] }));
        yield* TestClock.adjust("100 millis");
        yield* Queue.take(reports);
        expect((yield* pub.list(email))[0]?.status).toBe("active");
        const changed: OrchestrationV2DomainEvent = {
          ...created,
          id: EventId.make("changed"),
          type: "thread.metadata-updated",
          payload: { ...created.payload, title: "Renamed" },
        };
        yield* projection.apply(changed);
        const committed = yield* events.appendAgentEvents({ events: [changed] });
        yield* events.publishCommitted(committed);
        yield* TestClock.adjust("100 millis");
        yield* Queue.take(reports);
        yield* Queue.take(reports);
        expect((yield* pub.list(email))[0]?.title).toBe("Renamed");
        yield* reporter.publish({ threadId, status: "unpublished" });
        expect((yield* pub.list(email))[0]?.publicationStatus).toBe("unpublished");
      }).pipe(Effect.provide(local), Effect.scoped);
    }).pipe(
      Effect.scoped,
      Effect.provide(
        Layer.mergeAll(NodeServices.layer, NodeCrypto.layer, SecureRandom.layerWebCrypto),
      ),
    );
  },
);
