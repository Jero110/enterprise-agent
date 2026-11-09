import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

// JSON array of member emails a thread is shared with; NULL keeps the owner's whole team.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE enterprise_team_threads ADD COLUMN publication_audience TEXT`;
});
