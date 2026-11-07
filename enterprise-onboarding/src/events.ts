import { type DB, run } from "./db.ts";
import { newId } from "./encoding.ts";

export type ActorType = "admin" | "user" | "host" | "anonymous";

export interface AuditEntry {
  actorType: ActorType;
  actorId?: string | null;
  action: string;
  target?: string | null;
  detail?: unknown;
  ip?: string | null;
}

/** Records who did what. Never pass secrets in detail: the log is shown in the admin console. */
export function audit(db: DB, at: number, e: AuditEntry): void {
  run(
    db,
    "INSERT INTO audit_log (at, actor_type, actor_id, action, target, detail, ip) VALUES (?, ?, ?, ?, ?, ?, ?)",
    at,
    e.actorType,
    e.actorId ?? null,
    e.action,
    e.target ?? null,
    e.detail === undefined ? null : JSON.stringify(e.detail),
    e.ip ?? null,
  );
}

export interface Ref {
  kind: string;
  id: string;
}

export function notifyUser(db: DB, at: number, userId: string, message: string, ref?: Ref): void {
  insert(db, at, "user", userId, message, ref);
}

/** A notice every admin sees in the console, e.g. "new admin activated" with a one-click revoke. */
export function notifyAdmins(db: DB, at: number, message: string, ref?: Ref): void {
  insert(db, at, "admins", null, message, ref);
}

function insert(db: DB, at: number, type: string, recipient: string | null, message: string, ref?: Ref) {
  run(
    db,
    "INSERT INTO notifications (id, recipient_type, recipient_id, message, ref_kind, ref_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    newId(),
    type,
    recipient,
    message,
    ref?.kind ?? null,
    ref?.id ?? null,
    at,
  );
}
