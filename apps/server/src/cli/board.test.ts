import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as TestConsole from "effect/testing/TestConsole";
import { Command } from "effect/cli";

import { makeBoardCommand } from "./board.ts";
import { type ThreadTools, ThreadToolFailedError } from "./thread.ts";

it.effect("the CLI creates and edits cards using the server revision and keeps other cards", () =>
  Effect.gen(function* () {
    const existing = {
      id: "card-1",
      title: "Existing",
      description: "",
      status: "backlog",
      priority: null,
      assignees: [],
      tags: [],
      dueDate: null,
    };
    let snapshot: {
      revision: number;
      boards: Array<{ id: string; name: string; tasks: Array<typeof existing> }>;
    } = {
      revision: 4,
      boards: [{ id: "board-1", name: "Sprint", tasks: [existing] }],
    };
    const calls: Array<{ tool: string; input: Readonly<Record<string, unknown>> }> = [];
    const tools = {
      call: ((tool, input, schema) => {
        calls.push({ tool, input });
        const response =
          tool === "project_board_get"
            ? snapshot
            : tool === "project_board_move_card"
              ? snapshot
              : (() => {
                  expect(input).toMatchObject({ revision: snapshot.revision });
                  snapshot = {
                    revision: snapshot.revision + 1,
                    boards: input.boards as typeof snapshot.boards,
                  };
                  return snapshot;
                })();
        return Schema.decodeEffect(schema)(response).pipe(
          Effect.mapError(() => new ThreadToolFailedError({ tool, detail: "Invalid response" })),
        );
      }) as ThreadTools["call"],
    };
    const command = makeBoardCommand((_flags, run) => run(tools));
    yield* Command.runWith(command, { version: "0.0.0" })([
      "card",
      "add",
      "board-1",
      "New card",
      "--status",
      "in_progress",
      "--priority",
      "high",
      "--assignees",
      "AB, CD",
      "--tags",
      "finance,qa",
      "--due-date",
      "2026-12-01",
    ]);
    expect(snapshot.revision).toBe(5);
    expect(snapshot.boards[0]?.tasks).toHaveLength(2);
    expect(snapshot.boards[0]?.tasks[0]).toEqual(existing);
    const added = snapshot.boards[0]!.tasks[1]!;
    expect(added).toMatchObject({
      title: "New card",
      status: "in_progress",
      priority: "high",
      assignees: ["AB", "CD"],
      tags: ["finance", "qa"],
      dueDate: "2026-12-01",
    });
    yield* Command.runWith(command, { version: "0.0.0" })([
      "card",
      "edit",
      "board-1",
      added.id,
      "--title",
      "Revised",
      "--priority",
      "none",
      "--due-date",
      "none",
      "--assignees",
      "CD",
    ]);
    expect(snapshot.boards[0]?.tasks[1]).toMatchObject({
      title: "Revised",
      status: "in_progress",
      priority: null,
      dueDate: null,
      assignees: ["CD"],
      tags: ["finance", "qa"],
    });
    expect(calls.map(({ tool }) => tool)).toEqual([
      "project_board_get",
      "project_board_save",
      "project_board_get",
      "project_board_save",
    ]);
    const invalid = yield* Effect.exit(
      Command.runWith(command, { version: "0.0.0" })([
        "card",
        "edit",
        "board-1",
        added.id,
        "--status",
        "not-a-status",
      ]),
    );
    expect(invalid._tag).toBe("Failure");
    expect(calls.at(-1)?.tool).toBe("project_board_get");
    expect(snapshot.revision).toBe(6);
    yield* Command.runWith(command, { version: "0.0.0" })(["add", "Next sprint"]);
    const created = snapshot.boards[1]!;
    expect(created).toMatchObject({ name: "Next sprint", tasks: [] });
    yield* Command.runWith(command, { version: "0.0.0" })(["rename", created.id, "Later"]);
    expect(snapshot.boards[1]?.name).toBe("Later");
    yield* Command.runWith(command, { version: "0.0.0" })(["remove", created.id]);
    expect(snapshot.boards).toHaveLength(1);
    yield* Command.runWith(command, { version: "0.0.0" })(["card", "remove", "board-1", added.id]);
    expect(snapshot.boards[0]?.tasks).toEqual([existing]);
    yield* Command.runWith(command, { version: "0.0.0" })([
      "card",
      "move",
      "card-1",
      "--board",
      "board-2",
      "--status",
      "complete",
    ]);
    expect(calls.at(-1)).toEqual({
      tool: "project_board_move_card",
      input: { cardId: "card-1", toBoardId: "board-2", status: "complete" },
    });
  }).pipe(Effect.provide(Layer.mergeAll(NodeServices.layer, TestConsole.layer))),
);
