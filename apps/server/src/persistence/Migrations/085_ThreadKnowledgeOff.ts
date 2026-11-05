import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  // Rows exist only for levels a conversation switched off; no row means the default (on).
  yield* sql`CREATE TABLE enterprise_thread_knowledge_off (
    thread_id TEXT NOT NULL, scope TEXT NOT NULL,
    PRIMARY KEY (thread_id, scope)
  )`;
});
