import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/** One board space per owner email; "" is the shared space and receives every earlier project board. */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE user_boards (
    owner TEXT PRIMARY KEY, revision INTEGER NOT NULL, boards_json TEXT NOT NULL
  )`;
  yield* sql`INSERT INTO user_boards (owner, revision, boards_json)
    SELECT owner, revision, boards_json FROM (
      SELECT '' AS owner, MAX(revision) + 1 AS revision, json_group_array(json(value)) AS boards_json
      FROM project_boards, json_each(boards_json)
    ) WHERE revision IS NOT NULL`;
});
