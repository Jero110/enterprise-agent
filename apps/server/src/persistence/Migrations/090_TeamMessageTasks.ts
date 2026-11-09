import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

// SQLite can't widen a CHECK in place, so the table is rebuilt with board-card requests allowed.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE enterprise_team_messages_next (
    id TEXT PRIMARY KEY,
    from_email TEXT NOT NULL,
    to_email TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('message', 'skill', 'task')),
    note TEXT,
    skill_json TEXT,
    task_json TEXT,
    via_agent INTEGER NOT NULL DEFAULT 0 CHECK (via_agent IN (0, 1)),
    status TEXT NOT NULL DEFAULT 'unread' CHECK (status IN ('unread', 'read', 'installed', 'accepted', 'declined')),
    created_at TEXT NOT NULL
  )`;
  yield* sql`INSERT INTO enterprise_team_messages_next (id, from_email, to_email, kind, note, skill_json, status, created_at)
    SELECT id, from_email, to_email, kind, note, skill_json, status, created_at FROM enterprise_team_messages`;
  yield* sql`DROP TABLE enterprise_team_messages`;
  yield* sql`ALTER TABLE enterprise_team_messages_next RENAME TO enterprise_team_messages`;
  yield* sql`CREATE INDEX enterprise_team_messages_to ON enterprise_team_messages (to_email, created_at)`;
  yield* sql`CREATE INDEX enterprise_team_messages_from ON enterprise_team_messages (from_email, created_at)`;
});
