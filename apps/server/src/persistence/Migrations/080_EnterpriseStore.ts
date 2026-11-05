import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // Hub-only tables; a server without T3CODE_ENTERPRISE_HUB never reads or writes them.
  yield* sql`
    CREATE TABLE IF NOT EXISTS enterprise (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      name TEXT NOT NULL,
      token_salt TEXT NOT NULL,
      token_hash TEXT NOT NULL
    )
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS enterprise_teams (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      created_by TEXT NOT NULL
    )
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS enterprise_members (
      email TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      team_id TEXT REFERENCES enterprise_teams(id) ON DELETE SET NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'lead', 'member')),
      authorized INTEGER NOT NULL DEFAULT 1,
      revoked INTEGER NOT NULL DEFAULT 0,
      authorized_at TEXT NOT NULL,
      authorized_by TEXT NOT NULL
    )
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS enterprise_enrollments (
      environment_id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      enrolled_at TEXT NOT NULL
    )
  `;
  yield* sql`
    CREATE TABLE IF NOT EXISTS enterprise_area_grants (
      email TEXT NOT NULL,
      area_id TEXT NOT NULL,
      granted_at TEXT NOT NULL,
      granted_by TEXT NOT NULL,
      PRIMARY KEY (email, area_id)
    )
  `;
});
