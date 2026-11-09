import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE enterprise_team_messages (
    id TEXT PRIMARY KEY,
    from_email TEXT NOT NULL,
    to_email TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('message', 'skill')),
    note TEXT,
    skill_json TEXT,
    status TEXT NOT NULL DEFAULT 'unread' CHECK (status IN ('unread', 'read', 'installed', 'declined')),
    created_at TEXT NOT NULL
  )`;
  yield* sql`CREATE INDEX enterprise_team_messages_to ON enterprise_team_messages (to_email, created_at)`;
  yield* sql`CREATE INDEX enterprise_team_messages_from ON enterprise_team_messages (from_email, created_at)`;
});
