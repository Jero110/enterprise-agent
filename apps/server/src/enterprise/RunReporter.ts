import {
  RunRecordInput,
  type OrchestrationV2ThreadProjection,
  type RunId,
  type ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";

import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ApplicationEvents from "../persistence/OrchestrationEventStore.ts";
import { forkParked } from "../serverActivation.ts";
import * as EnterpriseClient from "./EnterpriseClient.ts";

/**
 * Member IDE side of run evidence: when a run completes on an enrolled environment, build its
 * record from the committed projection and deliver it to the hub, queueing while the hub is away.
 */
export class RunReporter extends Context.Service<
  RunReporter,
  { readonly start: Effect.Effect<void, never, Scope.Scope> }
>()("t3/enterprise/RunReporter") {}

const codec = Schema.fromJsonString(RunRecordInput);
type ThreadRecords = Pick<
  OrchestrationV2ThreadProjection,
  "runs" | "attempts" | "providerTurns" | "turnItems"
>;

/** Claude names MCP tools `mcp__server__tool`, Codex `server.tool`. */
const splitToolName = (toolName: string) => {
  const claude = /^mcp__(.+?)__(.+)$/u.exec(toolName);
  if (claude) return { name: claude[2]!, mcpServer: claude[1]! };
  const dot = toolName.indexOf(".");
  return dot > 0
    ? { name: toolName.slice(dot + 1), mcpServer: toolName.slice(0, dot) }
    : { name: toolName, mcpServer: null };
};

/** The hub's `{ ok, value }` answer, however the provider wrapped the MCP result. */
const hubAnswer = (output: unknown, depth = 0): { ok: boolean; value?: unknown } | undefined => {
  if (depth > 4 || output === null || output === undefined) return undefined;
  if (typeof output === "string") {
    try {
      return hubAnswer(JSON.parse(output), depth + 1);
    } catch {
      return undefined;
    }
  }
  if (Array.isArray(output)) {
    for (const part of output) {
      const found = hubAnswer(
        typeof part === "object" && part !== null && "text" in part ? part.text : part,
        depth + 1,
      );
      if (found) return found;
    }
    return undefined;
  }
  if (typeof output !== "object") return undefined;
  const record = output as Record<string, unknown>;
  if (typeof record.ok === "boolean") return { ok: record.ok, value: record.value };
  return hubAnswer(record.structuredContent ?? record.content, depth + 1);
};

const stringField = (value: unknown, key: string) =>
  typeof value === "object" && value !== null
    ? ((value as Record<string, unknown>)[key] as unknown)
    : undefined;

const total = (values: ReadonlyArray<number | undefined>) => {
  const known = values.filter((value) => value !== undefined);
  return known.length === 0 ? null : known.reduce((sum, value) => sum + value, 0);
};

const buildRecord = (
  runId: RunId,
  records: ThreadRecords,
  endedAt: DateTime.DateTime,
): RunRecordInput | null => {
  const run = records.runs.find((candidate) => candidate.id === runId);
  if (run === undefined) return null;
  const attempts = new Set(
    records.attempts.filter((attempt) => attempt.runId === runId).map((attempt) => attempt.id),
  );
  const turns = records.providerTurns.filter(
    (turn) => turn.runAttemptId !== null && attempts.has(turn.runAttemptId),
  );
  const toolCalls: Array<RunRecordInput["toolCalls"][number]> = [];
  const knowledgeReads: Array<string> = [];
  const proposalIds: Array<string> = [];
  const items = records.turnItems
    .filter((item) => item.runId === runId && item.type === "dynamic_tool")
    .toSorted((a, b) => a.ordinal - b.ordinal);
  for (const item of items) {
    if (item.type !== "dynamic_tool" || item.toolName === null) continue;
    const call = splitToolName(item.toolName);
    toolCalls.push(call);
    const answer = hubAnswer(item.output);
    if (item.status !== "completed" || answer?.ok === false) continue;
    if (call.name === "knowledge_get") {
      const path = stringField(item.input, "path");
      if (typeof path === "string") knowledgeReads.push(path);
    } else if (call.name === "knowledge_propose") {
      const id = stringField(answer?.value, "id");
      if (typeof id === "string") proposalIds.push(id);
    }
  }
  return {
    threadId: run.threadId,
    turnId: run.id,
    provider: run.providerInstanceId,
    model: run.modelSelection.model,
    inputTokens: total(
      turns.map((turn) => turn.turnTokenUsage?.inputTokens ?? turn.tokenUsage?.inputTokens),
    ),
    outputTokens: total(
      turns.map((turn) => turn.turnTokenUsage?.outputTokens ?? turn.tokenUsage?.outputTokens),
    ),
    toolCalls,
    knowledgeReads,
    proposalIds,
    startedAt: DateTime.formatIso(run.startedAt ?? run.requestedAt),
    endedAt: DateTime.formatIso(run.completedAt ?? endedAt),
    outcome: "unknown",
  };
};

export const layer = Layer.effect(
  RunReporter,
  Effect.gen(function* () {
    const client = yield* EnterpriseClient.EnterpriseClient;
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    const events = yield* ApplicationEvents.OrchestrationEventStore;
    const sql = yield* SqlClient.SqlClient;
    const lock = yield* Semaphore.make(1);

    // Delivery is at-least-once; the hub keeps one record per member and turn.
    const flush = Effect.fn("RunReporter.flush")(function* () {
      const hub = yield* client.hubEnvironmentId;
      if (hub === null) return;
      const rows = yield* sql<{ readonly turn_id: string; readonly record_json: string }>`
        SELECT turn_id, record_json FROM enterprise_run_outbox
        WHERE hub_id = ${hub} AND delivered = 0 ORDER BY rowid`.pipe(Effect.orDie);
      for (const row of rows) {
        const input = yield* Schema.decodeEffect(codec)(row.record_json).pipe(Effect.orDie);
        yield* client.runReport(input);
        yield* sql`UPDATE enterprise_run_outbox SET delivered = 1
          WHERE hub_id = ${hub} AND turn_id = ${row.turn_id}`.pipe(Effect.orDie);
      }
    }, lock.withPermits(1));

    const enqueue = Effect.fn("RunReporter.enqueue")(function* (
      threadId: ThreadId,
      runId: RunId,
      endedAt: DateTime.DateTime,
    ) {
      const hub = yield* client.hubEnvironmentId;
      if (hub === null) return false;
      const records = yield* projections.getThreadRecords(threadId, [
        "runs",
        "attempts",
        "providerTurns",
        "turnItems",
      ]);
      const record = buildRecord(runId, records, endedAt);
      if (record === null) return false;
      const json = yield* Schema.encodeEffect(codec)(record).pipe(Effect.orDie);
      yield* sql`INSERT INTO enterprise_run_outbox (hub_id, turn_id, record_json)
        VALUES (${hub}, ${runId}, ${json}) ON CONFLICT(hub_id, turn_id) DO NOTHING`.pipe(
        Effect.orDie,
      );
      return true;
    }, lock.withPermits(1));

    // Evidence is best effort: a failed read or an unreachable hub never touches the run.
    const attempt = <A, E>(effect: Effect.Effect<A, E>) => Effect.ignore(effect);
    const start = Effect.gen(function* () {
      const afterSequence = yield* events.latestApplicationSequence.pipe(Effect.orDie);
      const completed = events
        .streamProjectedApplicationEvents({
          afterSequence,
          filter: (stored) =>
            "event" in stored &&
            stored.event.type === "run.updated" &&
            stored.event.payload.status === "completed",
          project: (stored) => ({
            sequence: stored.sequence,
            threadId: "event" in stored ? stored.event.threadId : null,
            runId:
              "event" in stored && stored.event.type === "run.updated"
                ? stored.event.payload.id
                : null,
            occurredAt: "event" in stored ? stored.event.occurredAt : null,
          }),
        })
        .pipe(
          Stream.mapEffect((event) =>
            event.threadId === null || event.runId === null || event.occurredAt === null
              ? Effect.void
              : attempt(
                  enqueue(event.threadId, event.runId, event.occurredAt).pipe(
                    Effect.flatMap((queued) => (queued ? flush() : Effect.void)),
                  ),
                ),
          ),
          Stream.catch(() => Stream.empty),
        );
      yield* Effect.all(
        [
          Stream.merge(
            completed,
            client.connectionChanges.pipe(Stream.mapEffect(() => attempt(flush()))),
          ).pipe(Stream.runDrain),
          attempt(flush()),
        ],
        { concurrency: "unbounded" },
      ).pipe(forkParked);
    });
    return RunReporter.of({ start });
  }),
);
