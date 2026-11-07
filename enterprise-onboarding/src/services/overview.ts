import type { Config } from "../config.ts";
import { all, type DB } from "../db.ts";
import { activeAdminCount, type Admin } from "./admins.ts";

/** Everything the admin console shows. No secrets or hashes leave this function. */
export function adminOverview(db: DB, config: Config, me: Admin) {
  const now = config.now();
  const users = all<{ id: string; email: string; name: string; areas: string; status: string; created_at: number }>(
    db,
    "SELECT id, email, name, areas, status, created_at FROM users ORDER BY email",
  );
  const devices = all<{ id: string; user_id: string; name: string; created_at: number; last_seen_at: number | null }>(
    db,
    "SELECT id, user_id, name, created_at, last_seen_at FROM devices WHERE revoked_at IS NULL ORDER BY created_at",
  );
  const openTokens = all<{
    user_id: string;
    kind: string;
    enrollments: number;
    max_enrollments: number;
    expires_at: number;
  }>(
    db,
    `SELECT user_id, kind, enrollments, max_enrollments, expires_at FROM join_tokens
     WHERE revoked_at IS NULL AND expires_at > ? AND enrollments < max_enrollments`,
    now,
  );
  const passkeyCounts = new Map(
    all<{ user_id: string; c: number }>(
      db,
      "SELECT user_id, COUNT(*) AS c FROM user_passkeys WHERE revoked_at IS NULL GROUP BY user_id",
    ).map((r) => [r.user_id, r.c]),
  );
  const admins = all<{ id: string; email: string; status: string; created_at: number; revoked_at: number | null }>(
    db,
    "SELECT id, email, status, created_at, revoked_at FROM admins ORDER BY created_at",
  );
  const emailOfAdmin = new Map(admins.map((a) => [a.id, a.email]));
  const emailOfUser = new Map(users.map((u) => [u.id, u.email]));
  const invites = all<{
    id: string;
    email: string;
    status: string;
    created_by: string | null;
    approved_by: string | null;
    break_glass: number;
    expires_at: number | null;
    created_at: number;
    used_at: number | null;
  }>(
    db,
    `SELECT id, email, status, created_by, approved_by, break_glass, expires_at, created_at, used_at
     FROM admin_invites ORDER BY created_at DESC LIMIT 30`,
  );
  const notifications = all<{ id: string; message: string; ref_kind: string | null; ref_id: string | null; created_at: number }>(
    db,
    "SELECT id, message, ref_kind, ref_id, created_at FROM notifications WHERE recipient_type = 'admins' ORDER BY created_at DESC LIMIT 30",
  );
  const auditRows = all<{
    at: number;
    actor_type: string;
    actor_id: string | null;
    action: string;
    target: string | null;
    ip: string | null;
  }>(db, "SELECT at, actor_type, actor_id, action, target, ip FROM audit_log ORDER BY id DESC LIMIT 100");

  // Audit targets are emails or device ids; show devices as "name (owner)".
  const deviceLabel = new Map(
    all<{ id: string; name: string; user_id: string }>(db, "SELECT id, name, user_id FROM devices").map((
      d,
    ) => [d.id, `${d.name} (${emailOfUser.get(d.user_id) ?? "unknown"})`]),
  );
  const actorLabel = (type: string, id: string | null) =>
    type === "admin" ? emailOfAdmin.get(id ?? "") ?? "admin" : type === "user" ? emailOfUser.get(id ?? "") ?? "user" : type;

  return {
    me,
    rules: {
      userTokenTtlMs: config.userTokenTtlMs,
      maxDevicesPerUser: config.maxDevicesPerUser,
      adminInviteTtlMs: config.adminInviteTtlMs,
      twoPersonRule: activeAdminCount(db) >= 2,
    },
    areas: config.areas,
    people: config.people.map((p) => {
      const user = users.find((u) => u.email === p.email.toLowerCase());
      return { email: p.email.toLowerCase(), name: p.name, status: user?.status ?? "not_invited" };
    }),
    users: users.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      areas: JSON.parse(u.areas) as string[],
      status: u.status,
      passkeys: passkeyCounts.get(u.id) ?? 0,
      devices: devices
        .filter((d) => d.user_id === u.id)
        .map((d) => ({ id: d.id, name: d.name, createdAt: d.created_at, lastSeenAt: d.last_seen_at })),
      openTokens: openTokens
        .filter((t) => t.user_id === u.id)
        .map((t) => ({ kind: t.kind, usesLeft: t.max_enrollments - t.enrollments, expiresAt: t.expires_at })),
    })),
    admins: admins.map((a) => ({ id: a.id, email: a.email, status: a.status, createdAt: a.created_at })),
    invites: invites.map((i) => ({
      id: i.id,
      email: i.email,
      status: i.status === "ready" && (i.expires_at ?? 0) <= now ? "expired" : i.status,
      createdBy: i.created_by ? emailOfAdmin.get(i.created_by) ?? "admin" : "server host",
      createdByMe: i.created_by === me.id,
      approvedBy: i.approved_by ? emailOfAdmin.get(i.approved_by) ?? "admin" : null,
      breakGlass: i.break_glass === 1,
      expiresAt: i.expires_at,
      createdAt: i.created_at,
    })),
    notifications: notifications.map((n) => ({
      id: n.id,
      message: n.message,
      ref: n.ref_kind ? { kind: n.ref_kind, id: n.ref_id } : null,
      createdAt: n.created_at,
    })),
    audit: auditRows.map((r) => ({
      at: r.at,
      actor: actorLabel(r.actor_type, r.actor_id),
      action: r.action,
      target: r.target ? deviceLabel.get(r.target) ?? r.target : null,
      ip: r.ip,
    })),
  };
}
