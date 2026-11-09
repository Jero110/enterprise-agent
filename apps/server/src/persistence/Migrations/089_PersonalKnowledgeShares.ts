import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE enterprise_knowledge_shares (
    path TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('member', 'area')),
    target TEXT NOT NULL,
    PRIMARY KEY (path, kind, target)
  )`;
});
