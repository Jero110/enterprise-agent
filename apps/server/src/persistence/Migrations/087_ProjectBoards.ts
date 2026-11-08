import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE project_boards (
    project_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, boards_json TEXT NOT NULL
  )`;
});
