import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE enterprise_run_records (
    member TEXT NOT NULL, turn_id TEXT NOT NULL, team_id TEXT,
    thread_id TEXT NOT NULL, record_json TEXT NOT NULL,
    PRIMARY KEY (member, turn_id)
  )`;
  yield* sql`CREATE TABLE enterprise_run_outbox (
    hub_id TEXT NOT NULL, member TEXT NOT NULL, turn_id TEXT NOT NULL,
    record_json TEXT NOT NULL, delivered INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (hub_id, member, turn_id)
  )`;
});
