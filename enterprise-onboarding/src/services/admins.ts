import type { Config, Person } from "../config.ts";
import { type DB, one, run, tx } from "../db.ts";
import { b64url, fromB64url, newId, randomSecret, secretPair, sha256Hex } from "../encoding.ts";
import { AppError } from "../errors.ts";
import { audit, notifyAdmins } from "../events.ts";
import {
  type AuthenticationResponse,
  authenticationOptions,
  type RegistrationResponse,
  registrationOptions,
  verifyAuthentication,
  verifyRegistration,
} from "../passkeys.ts";

export interface Admin {
  id: string;
  email: string;
}

interface InviteRow {
  id: string;
  email: string;
  admin_id: string;
  secret_hash: string;
  status: "awaiting_approval" | "ready" | "used" | "revoked";
  created_by: string | null;
  approved_by: string | null;
  break_glass: number;
  expires_at: number | null;
  registration_challenge: string | null;
  registration_challenge_expires_at: number | null;
}

export interface CreatedInvite {
  id: string;
  link: string;
  status: "awaiting_approval" | "ready";
  expiresAt: number | null;
}

export function normalizeEmail(email: unknown): string {
  if (typeof email !== "string" || !email.includes("@") || email.length > 254) {
    throw new AppError(400, "invalid_email", "Enter a valid email address.");
  }
  return email.trim().toLowerCase();
}

export function requirePerson(config: Config, email: string): Person {
  const person = config.people.find((p) => normalizeEmail(p.email) === email);
  if (!person) throw new AppError(400, "not_in_people_list", `${email} isn't on the company people list.`);
  return person;
}

export function activeAdminCount(db: DB): number {
  return one<{ c: number }>(db, "SELECT COUNT(*) AS c FROM admins WHERE status = 'active'")!.c;
}

function assertNotActiveAdmin(db: DB, email: string) {
  if (one(db, "SELECT 1 FROM admins WHERE email = ? AND status = 'active'", email)) {
    throw new AppError(409, "already_admin", `${email} is already an admin.`);
  }
}

// The secret travels after "#", so browsers never send it to a server, proxy or log.
export function inviteLink(config: Config, id: string, secret: string): string {
  return `${config.origin}/admin/join#invite=${id}.${secret}`;
}

async function insertInvite(
  db: DB,
  config: Config,
  email: string,
  opts: { createdBy: string | null; status: "awaiting_approval" | "ready"; breakGlass: boolean },
): Promise<CreatedInvite> {
  const id = newId();
  const secret = randomSecret(32);
  const secretHash = await sha256Hex(secret);
  const now = config.now();
  // An approval-gated link starts its 60 minutes when the second admin approves it.
  const expiresAt = opts.status === "ready" ? now + config.adminInviteTtlMs : null;
  tx(db, () => {
    run(
      db,
      "UPDATE admin_invites SET status = 'revoked' WHERE email = ? AND status IN ('awaiting_approval', 'ready')",
      email,
    );
    run(
      db,
      `INSERT INTO admin_invites (id, email, admin_id, secret_hash, status, created_by, break_glass, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      email,
      newId(),
      secretHash,
      opts.status,
      opts.createdBy,
      opts.breakGlass ? 1 : 0,
      expiresAt,
      now,
    );
  });
  return { id, link: inviteLink(config, id, secret), status: opts.status, expiresAt };
}

/**
 * Run on the server host. Creates the very first admin's link, or, with breakGlass,
 * a recovery link when every admin is locked out. Host access is the root of trust.
 */
export async function createHostAdminInvite(
  db: DB,
  config: Config,
  rawEmail: unknown,
  { breakGlass = false } = {},
): Promise<CreatedInvite> {
  const email = normalizeEmail(rawEmail);
  requirePerson(config, email);
  if (activeAdminCount(db) > 0 && !breakGlass) {
    throw new AppError(
      409,
      "admins_exist",
      "Admins already exist. Ask one of them for a link, or use --break-glass if every admin is locked out.",
    );
  }
  assertNotActiveAdmin(db, email);
  const invite = await insertInvite(db, config, email, { createdBy: null, status: "ready", breakGlass });
  const now = config.now();
  audit(db, now, {
    actorType: "host",
    action: breakGlass ? "admin_invite.break_glass" : "admin_invite.bootstrap",
    target: email,
    detail: { inviteId: invite.id },
  });
  if (breakGlass) {
    notifyAdmins(db, now, `Emergency admin link created on the server host for ${email}.`, {
      kind: "admin_invite",
      id: invite.id,
    });
  }
  return invite;
}

/** Two-person rule: once there are 2+ admins, a new admin's link needs a second admin's approval. */
export async function createAdminInvite(
  db: DB,
  config: Config,
  actor: Admin,
  rawEmail: unknown,
  ip: string,
): Promise<CreatedInvite> {
  const email = normalizeEmail(rawEmail);
  requirePerson(config, email);
  assertNotActiveAdmin(db, email);
  const needsApproval = activeAdminCount(db) >= 2;
  const invite = await insertInvite(db, config, email, {
    createdBy: actor.id,
    status: needsApproval ? "awaiting_approval" : "ready",
    breakGlass: false,
  });
  const now = config.now();
  audit(db, now, {
    actorType: "admin",
    actorId: actor.id,
    action: "admin_invite.created",
    target: email,
    detail: { inviteId: invite.id, needsApproval },
    ip,
  });
  notifyAdmins(
    db,
    now,
    needsApproval
      ? `${actor.email} created an admin link for ${email}. Another admin must approve it.`
      : `${actor.email} created an admin link for ${email}.`,
    { kind: "admin_invite", id: invite.id },
  );
  return invite;
}

export function approveAdminInvite(db: DB, config: Config, actor: Admin, inviteId: string, ip: string) {
  const now = config.now();
  return tx(db, () => {
    const invite = one<InviteRow>(db, "SELECT * FROM admin_invites WHERE id = ?", inviteId);
    if (!invite) throw new AppError(404, "invite_not_found", "That admin link doesn't exist.");
    if (invite.status !== "awaiting_approval") {
      throw new AppError(409, "not_awaiting_approval", "That admin link isn't waiting for approval.");
    }
    if (invite.created_by === actor.id) {
      throw new AppError(403, "two_person_rule", "The admin who created a link can't approve it.");
    }
    const expiresAt = now + config.adminInviteTtlMs;
    run(
      db,
      "UPDATE admin_invites SET status = 'ready', approved_by = ?, expires_at = ? WHERE id = ?",
      actor.id,
      expiresAt,
      inviteId,
    );
    audit(db, now, {
      actorType: "admin",
      actorId: actor.id,
      action: "admin_invite.approved",
      target: invite.email,
      detail: { inviteId },
      ip,
    });
    notifyAdmins(db, now, `${actor.email} approved the admin link for ${invite.email}.`, {
      kind: "admin_invite",
      id: inviteId,
    });
    return { expiresAt };
  });
}

export function revokeAdminInvite(db: DB, config: Config, actor: Admin, inviteId: string, ip: string): void {
  tx(db, () => {
    const invite = one<{ email: string }>(
      db,
      "SELECT email FROM admin_invites WHERE id = ? AND status IN ('awaiting_approval', 'ready')",
      inviteId,
    );
    if (!invite) throw new AppError(409, "invite_not_open", "That admin link is already used or revoked.");
    run(db, "UPDATE admin_invites SET status = 'revoked' WHERE id = ?", inviteId);
    audit(db, config.now(), {
      actorType: "admin",
      actorId: actor.id,
      action: "admin_invite.revoked",
      target: invite.email,
      detail: { inviteId },
      ip,
    });
  });
}

function parseInviteRef(ref: unknown): { id: string; secret: string } {
  const dot = typeof ref === "string" ? ref.indexOf(".") : -1;
  if (typeof ref !== "string" || dot < 1 || ref.length > 200) {
    throw new AppError(404, "invite_invalid", "This admin link isn't valid.");
  }
  return { id: ref.slice(0, dot), secret: ref.slice(dot + 1) };
}

/** Synchronous so callers can re-check inside the same tick as their write. */
function usableInvite(db: DB, config: Config, id: string, secretHash: string): InviteRow {
  const invite = one<InviteRow>(db, "SELECT * FROM admin_invites WHERE id = ?", id);
  // Same answer for "no such link" and "wrong secret", so ids can't be probed.
  if (!invite || invite.secret_hash !== secretHash) {
    throw new AppError(404, "invite_invalid", "This admin link isn't valid.");
  }
  switch (invite.status) {
    case "awaiting_approval":
      throw new AppError(409, "needs_approval", "This link is waiting for a second admin to approve it.");
    case "used":
      throw new AppError(410, "invite_used", "This link has already been used.");
    case "revoked":
      throw new AppError(410, "invite_revoked", "This link was revoked. Ask an admin for a new one.");
  }
  if (invite.expires_at === null || invite.expires_at <= config.now()) {
    throw new AppError(410, "invite_expired", "This link has expired. Ask an admin for a new one.");
  }
  return invite;
}

async function loadInvite(db: DB, config: Config, ref: unknown) {
  const { id, secret } = parseInviteRef(ref);
  const secretHash = await sha256Hex(secret);
  return { id, secretHash, invite: usableInvite(db, config, id, secretHash) };
}

/** Opening the link only shows who it's for. Nothing changes until Confirm, so link scanners can't burn it. */
export async function previewInvite(db: DB, config: Config, ref: unknown) {
  const { invite } = await loadInvite(db, config, ref);
  return { email: invite.email, expiresAt: invite.expires_at, breakGlass: invite.break_glass === 1 };
}

export async function startInviteRegistration(db: DB, config: Config, ref: unknown) {
  const { invite } = await loadInvite(db, config, ref);
  const options = await registrationOptions(config, { id: invite.admin_id, email: invite.email });
  run(
    db,
    "UPDATE admin_invites SET registration_challenge = ?, registration_challenge_expires_at = ? WHERE id = ?",
    options.challenge,
    config.now() + config.challengeTtlMs,
    invite.id,
  );
  return options;
}

/** Confirm: verifies the new passkey, uses up the link and activates the admin in one step. */
export async function redeemInvite(
  db: DB,
  config: Config,
  ref: unknown,
  response: RegistrationResponse,
  ip: string,
): Promise<{ admin: Admin; sessionToken: string }> {
  const { id, secretHash, invite } = await loadInvite(db, config, ref);
  const challenge = invite.registration_challenge;
  if (!challenge || (invite.registration_challenge_expires_at ?? 0) <= config.now()) {
    throw new AppError(409, "registration_not_started", "That took too long. Click Confirm again.");
  }
  const passkey = await verifyRegistration(config, response, challenge);
  const session = await secretPair("ea_admin_");
  const now = config.now();

  const admin = tx(db, () => {
    // Re-check after the awaits: another request may have used the link meanwhile.
    const fresh = usableInvite(db, config, id, secretHash);
    if (fresh.registration_challenge !== challenge) {
      throw new AppError(409, "registration_not_started", "That took too long. Click Confirm again.");
    }
    const existing = one<{ id: string; status: string }>(
      db,
      "SELECT id, status FROM admins WHERE email = ?",
      fresh.email,
    );
    if (existing?.status === "active") throw new AppError(409, "already_admin", `${fresh.email} is already an admin.`);
    const adminId = existing?.id ?? fresh.admin_id;
    if (existing) {
      // A returning admin starts clean: their old passkeys stay dead.
      run(db, "DELETE FROM admin_credentials WHERE admin_id = ?", adminId);
      run(db, "UPDATE admins SET status = 'active', revoked_at = NULL WHERE id = ?", adminId);
    } else {
      run(
        db,
        "INSERT INTO admins (id, email, status, created_at) VALUES (?, ?, 'active', ?)",
        adminId,
        fresh.email,
        now,
      );
    }
    run(
      db,
      "INSERT INTO admin_credentials (id, admin_id, public_key, counter, transports, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      passkey.id,
      adminId,
      b64url(passkey.publicKey),
      passkey.counter,
      JSON.stringify(passkey.transports),
      now,
    );
    run(
      db,
      "UPDATE admin_invites SET status = 'used', used_at = ?, registration_challenge = NULL WHERE id = ?",
      now,
      id,
    );
    insertSession(db, config, adminId, session.hash);
    audit(db, now, {
      actorType: "admin",
      actorId: adminId,
      action: "admin.activated",
      target: fresh.email,
      detail: { inviteId: id, breakGlass: fresh.break_glass === 1 },
      ip,
    });
    notifyAdmins(db, now, `New admin ${fresh.email} activated their account.`, { kind: "admin", id: adminId });
    return { id: adminId, email: fresh.email };
  });
  return { admin, sessionToken: session.secret };
}

function insertSession(db: DB, config: Config, adminId: string, tokenHash: string) {
  const now = config.now();
  run(
    db,
    "INSERT INTO admin_sessions (token_hash, admin_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
    tokenHash,
    adminId,
    now + config.adminSessionTtlMs,
    now,
  );
}

export async function adminFromSession(db: DB, config: Config, token: string | undefined): Promise<Admin> {
  if (!token) throw new AppError(401, "not_signed_in", "Sign in with your passkey.");
  const hash = await sha256Hex(token);
  const admin = one<Admin>(
    db,
    `SELECT a.id, a.email FROM admin_sessions s JOIN admins a ON a.id = s.admin_id
     WHERE s.token_hash = ? AND s.expires_at > ? AND a.status = 'active'`,
    hash,
    config.now(),
  );
  if (!admin) throw new AppError(401, "not_signed_in", "Your session ended. Sign in with your passkey.");
  return admin;
}

export async function endSession(db: DB, token: string | undefined): Promise<void> {
  if (token) run(db, "DELETE FROM admin_sessions WHERE token_hash = ?", await sha256Hex(token));
}

export async function startLogin(db: DB, config: Config) {
  const options = await authenticationOptions(config);
  const loginId = newId();
  run(
    db,
    "INSERT INTO admin_login_challenges (id, challenge, expires_at) VALUES (?, ?, ?)",
    loginId,
    options.challenge,
    config.now() + config.challengeTtlMs,
  );
  return { loginId, options };
}

interface CredentialRow {
  id: string;
  admin_id: string;
  public_key: string;
  counter: number;
  transports: string;
  email: string;
  status: string;
}

export async function finishLogin(
  db: DB,
  config: Config,
  loginId: unknown,
  response: AuthenticationResponse,
  ip: string,
): Promise<{ admin: Admin; sessionToken: string }> {
  const now = config.now();
  const challenge = tx(db, () => {
    const row = one<{ challenge: string; expires_at: number; used_at: number | null }>(
      db,
      "SELECT challenge, expires_at, used_at FROM admin_login_challenges WHERE id = ?",
      typeof loginId === "string" ? loginId : "",
    );
    if (!row || row.used_at !== null || row.expires_at <= now) {
      throw new AppError(400, "login_expired", "Sign-in timed out. Try again.");
    }
    // Each challenge works once, even if verification fails.
    run(db, "UPDATE admin_login_challenges SET used_at = ? WHERE id = ?", now, loginId as string);
    return row.challenge;
  });

  const credentialId = typeof response?.id === "string" ? response.id : "";
  const cred = one<CredentialRow>(
    db,
    `SELECT c.*, a.email, a.status FROM admin_credentials c JOIN admins a ON a.id = c.admin_id WHERE c.id = ?`,
    credentialId,
  );
  if (!cred) {
    audit(db, now, { actorType: "anonymous", action: "admin.sign_in_failed", detail: { reason: "unknown_passkey" }, ip });
    throw new AppError(401, "passkey_unknown", "This passkey isn't registered here.");
  }
  if (cred.status !== "active") throw new AppError(403, "admin_revoked", "This admin account was revoked.");

  const newCounter = await verifyAuthentication(config, response, challenge, {
    id: cred.id,
    publicKey: fromB64url(cred.public_key),
    counter: cred.counter,
    transports: JSON.parse(cred.transports),
  }).catch((err) => {
    audit(db, now, {
      actorType: "admin",
      actorId: cred.admin_id,
      action: "admin.sign_in_failed",
      detail: { reason: "bad_signature" },
      ip,
    });
    throw err;
  });
  const session = await secretPair("ea_admin_");

  tx(db, () => {
    if (!one(db, "SELECT 1 FROM admins WHERE id = ? AND status = 'active'", cred.admin_id)) {
      throw new AppError(403, "admin_revoked", "This admin account was revoked.");
    }
    run(db, "UPDATE admin_credentials SET counter = ? WHERE id = ?", newCounter, cred.id);
    insertSession(db, config, cred.admin_id, session.hash);
    audit(db, now, { actorType: "admin", actorId: cred.admin_id, action: "admin.signed_in", ip });
  });
  return { admin: { id: cred.admin_id, email: cred.email }, sessionToken: session.secret };
}

export function revokeAdmin(db: DB, config: Config, actor: Admin, targetId: string, ip: string): void {
  const now = config.now();
  tx(db, () => {
    const target = one<{ email: string; status: string }>(db, "SELECT email, status FROM admins WHERE id = ?", targetId);
    if (!target) throw new AppError(404, "admin_not_found", "That admin doesn't exist.");
    if (target.status !== "active") throw new AppError(409, "already_revoked", "That admin is already revoked.");
    if (activeAdminCount(db) <= 1) throw new AppError(409, "last_admin", "You can't revoke the last admin.");
    run(db, "UPDATE admins SET status = 'revoked', revoked_at = ? WHERE id = ?", now, targetId);
    run(db, "DELETE FROM admin_sessions WHERE admin_id = ?", targetId);
    // Links a revoked admin created must not outlive them.
    run(
      db,
      "UPDATE admin_invites SET status = 'revoked' WHERE created_by = ? AND status IN ('awaiting_approval', 'ready')",
      targetId,
    );
    audit(db, now, { actorType: "admin", actorId: actor.id, action: "admin.revoked", target: target.email, ip });
    notifyAdmins(db, now, `${actor.email} revoked admin ${target.email}.`, { kind: "admin", id: targetId });
  });
}
