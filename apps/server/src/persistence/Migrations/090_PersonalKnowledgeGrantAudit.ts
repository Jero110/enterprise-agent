import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE enterprise_knowledge_shares ADD COLUMN granted_by TEXT`;
  yield* sql`ALTER TABLE enterprise_knowledge_shares ADD COLUMN granted_at TEXT`;
});
