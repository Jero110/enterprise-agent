import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE enterprise_team_threads (
    owner_email TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    parent_thread_id TEXT,
    title TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN (\'active\', \'idle\', \'archived\')),
    updated_at TEXT NOT NULL,
    publication_status TEXT NOT NULL DEFAULT \'unpublished\' CHECK (publication_status IN (\'unpublished\', \'read-only\')),
    publication_team_id TEXT,
    snapshot_json TEXT,
    PRIMARY KEY (owner_email, thread_id)
  )`;
});
