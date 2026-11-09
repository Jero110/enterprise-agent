import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

// publication_status keeps its CHECK; the view says what a shared thread exposes.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE enterprise_team_threads ADD COLUMN publication_view TEXT NOT NULL DEFAULT 'full' CHECK (publication_view IN ('full', 'summary'))`;
});
