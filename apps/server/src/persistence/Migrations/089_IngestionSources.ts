import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE enterprise_ingestion_sources (
    run_id TEXT NOT NULL REFERENCES enterprise_ingestion_runs(id),
    path TEXT NOT NULL,
    hash TEXT NOT NULL,
    PRIMARY KEY (run_id, path)
  )`;
  yield* sql`CREATE INDEX enterprise_ingestion_sources_hash ON enterprise_ingestion_sources(hash)`;
});
