import { expect, it } from "@effect/vitest";
import { EnvironmentId, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import * as Stream from "effect/Stream";

import * as EnterpriseThreadAuthor from "../enterprise/EnterpriseThreadAuthor.ts";
import Legacy from "../persistence/Migrations/087_ProjectBoards.ts";
import Migration from "../persistence/Migrations/093_UserBoards.ts";
import * as McpInvocationContext from "../mcp/McpInvocationContext.ts";
import * as McpToolAccess from "../mcp/McpToolAccess.ts";
import { liveThreadShell } from "../mcp/McpToolAccess.testkit.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ProjectBoards from "./ProjectBoards.ts";
import { ProjectBoardToolkit, layer } from "./ProjectBoardToolkit.ts";

const caller = {
  ...liveThreadShell(ThreadId.make("caller")),
  projectId: ProjectId.make("project-a"),
  enterpriseOwnerEmail: "owner@x.test",
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
const authors = Layer.mock(EnterpriseThreadAuthor.EnterpriseThreadAuthor)({
  author: (session) =>
    Effect.succeed(
      session.sessionId === "client" ? { email: "client@x.test", displayName: "Client" } : null,
    ),
});
const handlers = (shell: typeof caller | null = caller, read = true) =>
  McpToolAccess.HandlersLayer.layer(layer).pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        Layer.mock(ThreadManagement.ThreadManagementService)({
          getThreadShell: () => Effect.succeed(shell),
        }),
        authors,
        Layer.mock(ProjectBoards.ProjectBoards)({
          get: (owner) =>
            Effect.sync(() => {
              expect(read).toBe(true);
              expect(owner).toBe("owner@x.test");
              return { revision: 1, boards: [{ id: "board", name: "Sprint", tasks }] };
            }),
        }),
      ),
    ),
  );

const clientScope: McpInvocationContext.McpInvocationScope = {
  ...scope,
  capabilities: new Set(["orchestration"]),
  thread: undefined,
  client: { sessionId: "client", label: "CLI", access: "full-access" },
};

const card = (id: string, status: "backlog" | "complete" = "backlog") => ({
  id,
  title: id,
  description: "",
  status,
  priority: null,
  assignees: [],
  tags: [],
  dueDate: null,
});
const asThread = (email: string | undefined) => ({
  ...caller,
  ...(email === undefined ? {} : { enterpriseOwnerEmail: email }),
});
const realBoards = (shell: ReturnType<typeof asThread>) =>
  McpToolAccess.HandlersLayer.layer(layer).pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        Layer.mock(ThreadManagement.ThreadManagementService)({
          getThreadShell: () => Effect.succeed(shell),
        }),
        authors,
        ProjectBoards.layer,
      ),
    ),
  );
const result = <A, R>(stream: Stream.Stream<{ readonly result: A }, never, R>) =>
  Stream.runCollect(stream).pipe(Effect.map((all) => all.at(-1)?.result));

it.effect("keeps each identity's boards private and lets the agent move cards", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* Legacy;
    yield* Migration;
    const call = <E, E2, R, R2>(
      shell: ReturnType<typeof asThread>,
      run: (
        toolkit: Effect.Success<typeof ProjectBoardToolkit>,
      ) => Effect.Effect<Stream.Stream<{ readonly result: unknown }, E, R>, E2, R2>,
    ) =>
      Effect.gen(function* () {
        return yield* result(Stream.unwrap(run(yield* ProjectBoardToolkit)).pipe(Stream.orDie));
      }).pipe(
        Effect.provide(realBoards(shell)),
        Effect.provideService(McpInvocationContext.McpInvocationContext, {
          ...scope,
          capabilities: new Set(["orchestration"] as const),
        }),
      );
    const ana = asThread("ana@x.test");
    const bruno = asThread("bruno@x.test");
    const boards = [
      { id: "todo", name: "Todo", tasks: [card("c1")] },
      { id: "done", name: "Done", tasks: [] },
    ];
    expect(
      yield* call(ana, (t) => t.handle("project_board_save", { revision: 0, boards })),
    ).toMatchObject({
      revision: 1,
    });
    expect(yield* call(bruno, (t) => t.handle("project_board_get", {}))).toEqual({
      revision: 0,
      boards: [],
    });
    expect(yield* call(asThread(undefined), (t) => t.handle("project_board_get", {}))).toEqual({
      revision: 0,
      boards: [],
    });
    expect(
      yield* call(ana, (t) => t.handle("project_board_save", { revision: 0, boards: [] })),
    ).toMatchObject({
      code: "invalid_request",
    });
    const moved = yield* call(ana, (t) =>
      t.handle("project_board_move_card", {
        cardId: "c1",
        toBoardId: "done",
        status: "complete",
      }),
    );
    expect(moved).toMatchObject({ revision: 2 });
    expect(
      (moved as { boards: ReadonlyArray<{ tasks: ReadonlyArray<unknown> }> }).boards[1]?.tasks,
    ).toMatchObject([{ id: "c1", status: "complete" }]);
    expect(
      yield* call(bruno, (t) =>
        t.handle("project_board_move_card", { cardId: "c1", status: "blocked" }),
      ),
    ).toMatchObject({
      code: "invalid_request",
    });
    expect(yield* sql`SELECT owner FROM user_boards ORDER BY owner`).toEqual([
      { owner: "ana@x.test" },
    ]);
  }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
);

it.effect(
  "resolves a linked client's board from its enrolled member and refuses read-only writes",
  () =>
    Effect.gen(function* () {
      const toolkit = yield* ProjectBoardToolkit;
      const saved = yield* result(
        toolkit
          .handle("project_board_save", { revision: 1, boards: [] })
          .pipe(Stream.unwrap, Stream.orDie),
      );
      expect(saved).toMatchObject({ revision: 2 });
      const readOnly = yield* result(
        toolkit
          .handle("project_board_save", { revision: 1, boards: [] })
          .pipe(Stream.unwrap, Stream.orDie),
      ).pipe(
        Effect.provideService(McpInvocationContext.McpInvocationContext, {
          ...clientScope,
          client: { ...clientScope.client!, access: "read-only" },
        }),
      );
      expect(readOnly).toMatchObject({ code: "capability_denied" });
    }).pipe(
      Effect.provide(
        McpToolAccess.HandlersLayer.layer(layer).pipe(
          Layer.provideMerge(
            Layer.mergeAll(
              Layer.mock(ThreadManagement.ThreadManagementService)({}),
              authors,
              Layer.mock(ProjectBoards.ProjectBoards)({
                save: (owner, input) => {
                  expect(owner).toBe("client@x.test");
                  return Effect.succeed({ revision: 2, boards: input.boards });
                },
              }),
            ),
          ),
        ),
      ),
      Effect.provideService(McpInvocationContext.McpInvocationContext, clientScope),
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
