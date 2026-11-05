import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE enterprise_knowledge_proposals (
    id TEXT PRIMARY KEY,
    payload TEXT NOT NULL
  )`;
});
