import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE enterprise_ingestion_runs (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL UNIQUE,
    admin_email TEXT NOT NULL,
    folder TEXT NOT NULL,
    status TEXT NOT NULL
  )`;
});
