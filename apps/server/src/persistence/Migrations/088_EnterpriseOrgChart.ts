import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE enterprise_members ADD COLUMN reports_to TEXT`;
  yield* sql`ALTER TABLE enterprise_teams ADD COLUMN description TEXT`;
});
