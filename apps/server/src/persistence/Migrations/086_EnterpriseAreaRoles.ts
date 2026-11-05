import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE enterprise_area_grants ADD COLUMN role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('lead', 'member'))`;
});
