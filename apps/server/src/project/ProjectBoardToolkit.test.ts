import { expect, it } from "@effect/vitest";
import { EnvironmentId, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as McpInvocationContext from "../mcp/McpInvocationContext.ts";
import * as McpToolAccess from "../mcp/McpToolAccess.ts";
import { liveThreadShell } from "../mcp/McpToolAccess.testkit.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ProjectBoards from "./ProjectBoards.ts";
import { ProjectBoardToolkit, layer } from "./ProjectBoardToolkit.ts";

const caller = {
  ...liveThreadShell(ThreadId.make("caller")),
  projectId: ProjectId.make("project-a"),
};
const scope: McpInvocationContext.McpInvocationScope = {
  environmentId: EnvironmentId.make("local"),
  capabilities: new Set(),
  issuedAt: 0,
  requestNamespace: "board-test",
  client: undefined,
  thread: {
    threadId: caller.id,
    providerInstanceId: caller.providerInstanceId!,
    providerSessionId: "session",
  },
};
const tasks = Array.from({ length: 23 }, (_, index) => ({
  id: `card-${index}`,
  title: `Task ${index}`,
  description: "Card details",
  status: "blocked" as const,
  priority: null,
  assignees: [],
  tags: [],
  dueDate: null,
}));
const handlers = (shell: typeof caller | null = caller, read = true) =>
  McpToolAccess.HandlersLayer.layer(layer).pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        Layer.mock(ThreadManagement.ThreadManagementService)({
          getThreadShell: () => Effect.succeed(shell),
        }),
        Layer.mock(ProjectBoards.ProjectBoards)({
          get: (input) =>
            Effect.sync(() => {
              expect(read).toBe(true);
              expect(input.projectId).toBe(caller.projectId);
              return { revision: 1, boards: [{ id: "board", name: "Sprint", tasks }] };
            }),
        }),
      ),
    ),
  );

it.effect("lists bounded card summaries and reads full cards only within the calling project", () =>
  Effect.gen(function* () {
    const toolkit = yield* ProjectBoardToolkit;
    const first = yield* toolkit
      .handle("project_cards_list", {})
      .pipe(Stream.unwrap, Stream.runCollect);
    const result = first.at(-1)?.result;
    expect(result).toMatchObject({ nextCursor: 20 });
    if (result === undefined || !("cards" in result)) throw new Error("Expected card summaries");
    expect(result.cards).toHaveLength(20);
    expect(result.cards[0]).not.toHaveProperty("description");
    const tail = yield* toolkit
      .handle("project_cards_list", { cursor: 20 })
      .pipe(Stream.unwrap, Stream.runCollect);
    expect(tail.at(-1)?.result).toMatchObject({
      nextCursor: null,
      cards: tasks.slice(20).map((task) => ({
        id: task.id,
        title: task.title,
        status: task.status,
        priority: task.priority,
        boardId: "board",
        boardName: "Sprint",
      })),
    });
    const full = yield* toolkit
      .handle("project_cards_get", { boardId: "board", cardId: "card-0" })
      .pipe(Stream.unwrap, Stream.runCollect);
    expect(full.at(-1)?.result).toEqual({ boardId: "board", boardName: "Sprint", card: tasks[0] });
    const denied = yield* toolkit
      .handle("project_cards_get", { boardId: "other-project-board", cardId: "card-0" })
      .pipe(Stream.unwrap, Stream.runCollect);
    expect(denied.at(-1)?.result).toMatchObject({ code: "invalid_request" });
  }).pipe(
    Effect.provide(handlers()),
    Effect.provideService(McpInvocationContext.McpInvocationContext, scope),
  ),
);

it.effect(
  "rejects non-thread, deleted, archived, idle and mismatched provider callers before reading boards",
  () =>
    Effect.gen(function* () {
      for (const [invocation, shell, code] of [
        [{ ...scope, thread: undefined }, caller, "thread_credential_required"],
        [scope, null, "thread_not_found"],
        [scope, { ...caller, deletedAt: caller.createdAt }, "thread_not_found"],
        [scope, { ...caller, archivedAt: caller.createdAt }, "parent_not_active"],
        [scope, { ...caller, activeRunId: null }, "parent_not_active"],
        [
          scope,
          { ...caller, providerInstanceId: ProviderInstanceId.make("other") },
          "parent_not_active",
        ],
      ] as const) {
        yield* Effect.gen(function* () {
          const toolkit = yield* ProjectBoardToolkit;
          const listed = yield* toolkit
            .handle("project_cards_list", {})
            .pipe(Stream.unwrap, Stream.runCollect);
          expect(listed.at(-1)?.result).toMatchObject({ code });
          const read = yield* toolkit
            .handle("project_cards_get", { boardId: "board", cardId: "card-0" })
            .pipe(Stream.unwrap, Stream.runCollect);
          expect(read.at(-1)?.result).toMatchObject({ code });
        }).pipe(
          Effect.provide(handlers(shell, false)),
          Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
        );
      }
    }),
);
