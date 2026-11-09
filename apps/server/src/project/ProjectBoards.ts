import {
  ProjectBoard,
  ProjectBoardError,
  ProjectBoardSnapshot,
  type ProjectBoardMoveCardInput,
  type ProjectBoardSaveInput,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

/** The authenticated member's email, or null for the shared space used without an identity. */
export type BoardOwner = string | null;
const ownerKey = (owner: BoardOwner) => owner?.trim().toLowerCase() ?? "";

export class ProjectBoards extends Context.Service<
  ProjectBoards,
  {
    readonly get: (owner: BoardOwner) => Effect.Effect<ProjectBoardSnapshot, ProjectBoardError>;
    readonly save: (
      owner: BoardOwner,
      input: ProjectBoardSaveInput,
    ) => Effect.Effect<ProjectBoardSnapshot, ProjectBoardError>;
    /** Atomic read-modify-write, so an agent never races the revision it just read. */
    readonly moveCard: (
      owner: BoardOwner,
      input: ProjectBoardMoveCardInput,
    ) => Effect.Effect<ProjectBoardSnapshot, ProjectBoardError>;
  }
>()("t3/project/ProjectBoards") {}

const decodeSnapshot = Schema.decodeUnknownEffect(ProjectBoardSnapshot);
const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(ProjectBoardSnapshot));

const encodeBoards = Schema.encodeEffect(Schema.fromJsonString(Schema.Array(ProjectBoard)));

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const storageError = () => new ProjectBoardError({ code: "storage" });
  const get = Effect.fn("ProjectBoards.get")(function* (owner: BoardOwner) {
    const rows = yield* sql<{
      revision: number;
      boards_json: string;
    }>`SELECT revision, boards_json FROM user_boards WHERE owner = ${ownerKey(owner)}`;
    let row = rows[0];
    if (row === undefined && ownerKey(owner) !== "") {
      // The first identified member to open boards claims the pre-identity shared space once.
      const shared = yield* sql<{
        revision: number;
        boards_json: string;
      }>`SELECT revision, boards_json FROM user_boards WHERE owner = ''`;
      if (shared[0] !== undefined) {
        yield* sql`INSERT INTO user_boards (owner, revision, boards_json)
          VALUES (${ownerKey(owner)}, ${shared[0].revision}, ${shared[0].boards_json})`;
        yield* sql`DELETE FROM user_boards WHERE owner = ''`;
        row = shared[0];
      }
    }
    if (row === undefined) return { revision: 0, boards: [] };
    return yield* decodeJson(`{"revision":${row.revision},"boards":${row.boards_json}}`);
  }, Effect.mapError(storageError));
  const commit = Effect.fn("ProjectBoards.commit")(function* (
    owner: BoardOwner,
    update: (
      current: ProjectBoardSnapshot,
    ) => Effect.Effect<ProjectBoardSnapshot["boards"], ProjectBoardError>,
  ) {
    return yield* sql
      .withTransaction(
        Effect.gen(function* () {
          const current = yield* get(owner);
          const next = yield* update(current);
          const snapshot = yield* decodeSnapshot({ revision: 0, boards: next }).pipe(
            Effect.mapError(() => new ProjectBoardError({ code: "invalid" })),
          );
          const ids = snapshot.boards.flatMap((board) => [
            board.id,
            ...board.tasks.map((task) => task.id),
          ]);
          const json = yield* encodeBoards(snapshot.boards).pipe(
            Effect.mapError(() => new ProjectBoardError({ code: "invalid" })),
          );
          if (new Set(ids).size !== ids.length || json.length > 2_000_000)
            return yield* new ProjectBoardError({ code: "invalid" });
          const revision = current.revision + 1;
          yield* sql`INSERT INTO user_boards (owner, revision, boards_json)
        VALUES (${ownerKey(owner)}, ${revision}, ${json})
        ON CONFLICT(owner) DO UPDATE SET revision = excluded.revision, boards_json = excluded.boards_json`.pipe(
            Effect.mapError(storageError),
          );
          return { revision, boards: snapshot.boards };
        }),
      )
      .pipe(Effect.catchTags({ SqlError: () => Effect.fail(storageError()) }));
  });
  const save = Effect.fn("ProjectBoards.save")(function* (
    owner: BoardOwner,
    input: ProjectBoardSaveInput,
  ) {
    return yield* commit(owner, (current) =>
      current.revision === input.revision
        ? Effect.succeed(input.boards)
        : Effect.fail(new ProjectBoardError({ code: "conflict" })),
    );
  });
  const moveCard = Effect.fn("ProjectBoards.moveCard")(function* (
    owner: BoardOwner,
    input: ProjectBoardMoveCardInput,
  ) {
    return yield* commit(owner, (current) => {
      const from = current.boards.find((board) => board.tasks.some((t) => t.id === input.cardId));
      const card = from?.tasks.find((task) => task.id === input.cardId);
      const target = input.toBoardId ?? from?.id;
      if (card === undefined || !current.boards.some((board) => board.id === target))
        return Effect.fail(new ProjectBoardError({ code: "not_found" }));
      const moved = { ...card, status: input.status ?? card.status };
      return Effect.succeed(
        current.boards.map((board) => {
          const rest = board.tasks.filter((task) => task.id !== input.cardId);
          return board.id === target
            ? { ...board, tasks: [...rest, moved] }
            : { ...board, tasks: rest };
        }),
      );
    });
  });
  return ProjectBoards.of({ get, save, moveCard });
});
export const layer = Layer.effect(ProjectBoards, make);
