import { ProjectBoardSnapshot, type ProjectBoard, ProjectTask } from "@t3tools/contracts";
import * as Console from "effect/Console";
import { uuidV4Unsafe } from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Argument, Command, Flag } from "effect/cli";

import { projectLocationFlags } from "./config.ts";
import {
  reportThreadErrors,
  ThreadToolFailedError,
  type ThreadServerUnreachableError,
  withThreadTools,
  type ThreadTools,
} from "./thread.ts";

const board = Argument.String("board-id");
const card = Argument.String("card-id");
const flags = projectLocationFlags;
const decodeCard = Schema.decodeUnknownEffect(ProjectTask);
const labels = (value: string) =>
  value
    .split(",")
    .map((label) => label.trim())
    .filter(Boolean);
const nullable = (value: string) => (value === "none" ? null : value);
const requireEntry = <A extends { readonly id: string }>(items: ReadonlyArray<A>, id: string) => {
  const entry = items.find((item) => item.id === id);
  return entry === undefined
    ? Effect.fail(new ThreadToolFailedError({ tool: "t3 board", detail: `No item with id ${id}.` }))
    : Effect.succeed(entry);
};

const defaultWithBoardTools = <A, E, R>(
  location: { readonly baseDir: Option.Option<string> },
  run: (tools: ThreadTools) => Effect.Effect<A, E, R>,
) =>
  withThreadTools(location, run, {
    label: "t3 board cli",
    name: "t3-board-cli",
    access: "full-access",
  });

const readBoard = (tools: ThreadTools) => tools.call("project_board_get", {}, ProjectBoardSnapshot);
const print = (value: unknown) => Console.log(JSON.stringify(value, null, 2));

const editBoard = Effect.fn("cli.board.edit")(function* (
  tools: ThreadTools,
  change: (
    boards: ReadonlyArray<ProjectBoard>,
  ) => Effect.Effect<ReadonlyArray<ProjectBoard>, ThreadToolFailedError>,
) {
  const snapshot = yield* readBoard(tools);
  const boards = yield* change(snapshot.boards);
  return yield* tools.call(
    "project_board_save",
    { revision: snapshot.revision, boards },
    ProjectBoardSnapshot,
  );
});

export const makeBoardCommand = <E, R>(
  withBoardTools: (
    location: { readonly baseDir: Option.Option<string> },
    run: (
      tools: ThreadTools,
    ) => Effect.Effect<void, ThreadToolFailedError | ThreadServerUnreachableError>,
  ) => Effect.Effect<void, E, R>,
) => {
  const boardList = Command.make("list", { ...flags }).pipe(
    Command.withDescription("List your boards and cards."),
    Command.withHandler((input) =>
      reportThreadErrors(
        withBoardTools(input, (tools) => readBoard(tools).pipe(Effect.flatMap(print))),
      ),
    ),
  );
  const boardAdd = Command.make("add", { ...flags, name: Argument.String("name") }).pipe(
    Command.withDescription("Create a board."),
    Command.withHandler((input) =>
      reportThreadErrors(
        withBoardTools(input, (tools) =>
          editBoard(tools, (boards) =>
            Effect.succeed([...boards, { id: uuidV4Unsafe(), name: input.name, tasks: [] }]),
          ).pipe(Effect.flatMap(print)),
        ),
      ),
    ),
  );
  const boardRename = Command.make("rename", {
    ...flags,
    board,
    name: Argument.String("name"),
  }).pipe(
    Command.withDescription("Rename a board."),
    Command.withHandler((input) =>
      reportThreadErrors(
        withBoardTools(input, (tools) =>
          editBoard(tools, (boards) =>
            requireEntry(boards, input.board).pipe(
              Effect.as(
                boards.map((entry) =>
                  entry.id === input.board ? { ...entry, name: input.name } : entry,
                ),
              ),
            ),
          ).pipe(Effect.flatMap(print)),
        ),
      ),
    ),
  );
  const boardRemove = Command.make("remove", { ...flags, board }).pipe(
    Command.withDescription("Delete a board and all its cards."),
    Command.withHandler((input) =>
      reportThreadErrors(
        withBoardTools(input, (tools) =>
          editBoard(tools, (boards) =>
            requireEntry(boards, input.board).pipe(
              Effect.as(boards.filter((entry) => entry.id !== input.board)),
            ),
          ).pipe(Effect.flatMap(print)),
        ),
      ),
    ),
  );
  const cardAdd = Command.make("add", {
    ...flags,
    board,
    title: Argument.String("title"),
    description: Flag.String("description").pipe(Flag.optional),
    status: Flag.String("status").pipe(Flag.optional),
    priority: Flag.String("priority").pipe(Flag.optional),
    assignees: Flag.String("assignees").pipe(Flag.optional),
    tags: Flag.String("tags").pipe(Flag.optional),
    dueDate: Flag.String("due-date").pipe(Flag.optional),
  }).pipe(
    Command.withDescription("Add a card to a board."),
    Command.withHandler((input) =>
      reportThreadErrors(
        withBoardTools(input, (tools) =>
          editBoard(tools, (boards) =>
            Effect.gen(function* () {
              yield* requireEntry(boards, input.board);
              const task = yield* decodeCard({
                id: uuidV4Unsafe(),
                title: input.title,
                description: Option.getOrElse(input.description, () => ""),
                status: Option.getOrElse(input.status, () => "backlog"),
                priority: Option.match(input.priority, { onNone: () => null, onSome: nullable }),
                assignees: Option.match(input.assignees, { onNone: () => [], onSome: labels }),
                tags: Option.match(input.tags, { onNone: () => [], onSome: labels }),
                dueDate: Option.match(input.dueDate, { onNone: () => null, onSome: nullable }),
              }).pipe(
                Effect.mapError(
                  () =>
                    new ThreadToolFailedError({
                      tool: "t3 board card add",
                      detail: "Invalid card title or status.",
                    }),
                ),
              );
              return boards.map((entry) =>
                entry.id === input.board ? { ...entry, tasks: [...entry.tasks, task] } : entry,
              );
            }),
          ).pipe(Effect.flatMap(print)),
        ),
      ),
    ),
  );
  const cardRemove = Command.make("remove", { ...flags, board, card }).pipe(
    Command.withDescription("Delete a card from a board."),
    Command.withHandler((input) =>
      reportThreadErrors(
        withBoardTools(input, (tools) =>
          editBoard(tools, (boards) =>
            Effect.gen(function* () {
              const target = yield* requireEntry(boards, input.board);
              yield* requireEntry(target.tasks, input.card);
              return boards.map((entry) =>
                entry.id === input.board
                  ? { ...entry, tasks: entry.tasks.filter((task) => task.id !== input.card) }
                  : entry,
              );
            }),
          ).pipe(Effect.flatMap(print)),
        ),
      ),
    ),
  );
  const cardEdit = Command.make("edit", {
    ...flags,
    board,
    card,
    title: Flag.String("title").pipe(Flag.optional),
    description: Flag.String("description").pipe(Flag.optional),
    status: Flag.String("status").pipe(Flag.optional),
    priority: Flag.String("priority").pipe(Flag.optional),
    assignees: Flag.String("assignees").pipe(Flag.optional),
    tags: Flag.String("tags").pipe(Flag.optional),
    dueDate: Flag.String("due-date").pipe(Flag.optional),
  }).pipe(
    Command.withDescription("Change a card's fields; use 'none' to clear priority or due date."),
    Command.withHandler((input) =>
      reportThreadErrors(
        withBoardTools(input, (tools) =>
          editBoard(tools, (boards) =>
            Effect.gen(function* () {
              const target = yield* requireEntry(boards, input.board);
              const current = yield* requireEntry(target.tasks, input.card);
              const task = yield* decodeCard({
                ...current,
                title: Option.getOrElse(input.title, () => current.title),
                description: Option.getOrElse(input.description, () => current.description),
                status: Option.getOrElse(input.status, () => current.status),
                priority: Option.match(input.priority, {
                  onNone: () => current.priority,
                  onSome: nullable,
                }),
                assignees: Option.match(input.assignees, {
                  onNone: () => current.assignees,
                  onSome: labels,
                }),
                tags: Option.match(input.tags, {
                  onNone: () => current.tags,
                  onSome: labels,
                }),
                dueDate: Option.match(input.dueDate, {
                  onNone: () => current.dueDate,
                  onSome: nullable,
                }),
              }).pipe(
                Effect.mapError(
                  () =>
                    new ThreadToolFailedError({
                      tool: "t3 board card edit",
                      detail: "Invalid card fields.",
                    }),
                ),
              );
              return boards.map((entry) =>
                entry.id === input.board
                  ? {
                      ...entry,
                      tasks: entry.tasks.map((item) => (item.id === task.id ? task : item)),
                    }
                  : entry,
              );
            }),
          ).pipe(Effect.flatMap(print)),
        ),
      ),
    ),
  );
  const cardMove = Command.make("move", {
    ...flags,
    card,
    board: Flag.String("board").pipe(Flag.optional),
    status: Flag.String("status").pipe(Flag.optional),
  }).pipe(
    Command.withDescription("Move a card to another board and/or column (status)."),
    Command.withHandler((input) =>
      reportThreadErrors(
        withBoardTools(input, (tools) =>
          tools
            .call(
              "project_board_move_card",
              {
                cardId: input.card,
                ...Option.match(input.board, {
                  onNone: () => ({}),
                  onSome: (toBoardId) => ({ toBoardId }),
                }),
                ...Option.match(input.status, {
                  onNone: () => ({}),
                  onSome: (status) => ({ status }),
                }),
              },
              ProjectBoardSnapshot,
            )
            .pipe(Effect.flatMap(print)),
        ),
      ),
    ),
  );
  const cardCommand = Command.make("card").pipe(
    Command.withDescription("Add, edit, move or remove cards."),
    Command.withSubcommands([cardAdd, cardEdit, cardMove, cardRemove]),
  );
  return Command.make("board").pipe(
    Command.withDescription(
      "Manage your boards: one board space per signed-in member (requires a running local server).",
    ),
    Command.withSubcommands([boardList, boardAdd, boardRename, boardRemove, cardCommand]),
  );
};
export const boardCommand = makeBoardCommand(defaultWithBoardTools);
