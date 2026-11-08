import {
  ProjectBoard,
  ProjectBoardError,
  ProjectBoardSnapshot,
  type ProjectBoardSaveInput,
  type ProjectId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

export class ProjectBoards extends Context.Service<
  ProjectBoards,
  {
    readonly get: (input: {
      readonly projectId: ProjectId;
    }) => Effect.Effect<ProjectBoardSnapshot, ProjectBoardError>;
    readonly save: (
      input: ProjectBoardSaveInput,
    ) => Effect.Effect<ProjectBoardSnapshot, ProjectBoardError>;
  }
>()("t3/project/ProjectBoards") {}

const decodeSnapshot = Schema.decodeUnknownEffect(ProjectBoardSnapshot);
const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(ProjectBoardSnapshot));

const encodeBoards = Schema.encodeEffect(Schema.fromJsonString(Schema.Array(ProjectBoard)));

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const storageError = () => new ProjectBoardError({ code: "storage" });
  const assertProject = Effect.fn("ProjectBoards.assertProject")(function* (projectId: ProjectId) {
    const rows =
      yield* sql`SELECT 1 FROM projection_projects WHERE project_id = ${projectId} AND deleted_at IS NULL`.pipe(
        Effect.mapError(storageError),
      );
    if (rows.length === 0) return yield* new ProjectBoardError({ code: "not_found" });
  });
  const get = Effect.fn("ProjectBoards.get")(function* ({
    projectId,
  }: {
    readonly projectId: ProjectId;
  }) {
    yield* assertProject(projectId);
    const rows = yield* sql<{
      revision: number;
      boards_json: string;
    }>`SELECT revision, boards_json FROM project_boards WHERE project_id = ${projectId}`.pipe(
      Effect.mapError(storageError),
    );
    const row = rows[0];
    if (row === undefined) return { revision: 0, boards: [] };
    return yield* decodeJson(`{"revision":${row.revision},"boards":${row.boards_json}}`).pipe(
      Effect.mapError(storageError),
    );
  });
  const save = Effect.fn("ProjectBoards.save")(function* (input: ProjectBoardSaveInput) {
    const snapshot = yield* decodeSnapshot(input).pipe(
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
    return yield* sql
      .withTransaction(
        Effect.gen(function* () {
          yield* assertProject(input.projectId);
          const current = yield* get(input);
          if (current.revision !== input.revision)
            return yield* new ProjectBoardError({ code: "conflict" });
          const revision = current.revision + 1;
          yield* sql`INSERT INTO project_boards (project_id, revision, boards_json)
        VALUES (${input.projectId}, ${revision}, ${json})
        ON CONFLICT(project_id) DO UPDATE SET revision = excluded.revision, boards_json = excluded.boards_json`.pipe(
            Effect.mapError(storageError),
          );
          return { revision, boards: snapshot.boards };
        }),
      )
      .pipe(Effect.catchTags({ SqlError: () => Effect.fail(storageError()) }));
  });
  return ProjectBoards.of({ get, save });
});
export const layer = Layer.effect(ProjectBoards, make);
