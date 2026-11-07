import type { Config } from "../config.ts";
import { all, type DB, one, run, tx } from "../db.ts";
import { b64url, fromB64url, newId, randomSecret, secretPair, sha256Hex, utf8 } from "../encoding.ts";
import { AppError } from "../errors.ts";
import { audit, notifyUser } from "../events.ts";
import {
  type AuthenticationResponse,
  authenticationOptions,
  type RegistrationResponse,
  registrationOptions,
  verifyAuthentication,
  verifyRegistration,
} from "../passkeys.ts";
import { type Admin, normalizeEmail, requirePerson } from "./admins.ts";

export const JOIN_TOKEN_PREFIX = "ea_join_";

interface UserRow {
  id: string;
  email: string;
  name: string;
  areas: string;
  status: "active" | "deactivated";
}

interface TokenRow {
  id: string;
  user_id: string;
  kind: "invite" | "transfer";
  max_enrollments: number;
  enrollments: number;
  expires_at: number;
  revoked_at: number | null;
}

interface DeviceRow {
  id: string;
  user_id: string;
  name: string;
  public_jwk: string;
  revoked_at: number | null;
}

/** What a signed-in device is allowed to act as. */
export interface DeviceAuth {
  userId: string;
  deviceId: string;
}

function text(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new AppError(400, `invalid_${field}`, `Missing or invalid ${field}.`);
  }
  return value.trim();
}

/**
 * Admin issues a personal token for one named person. Issuing a new one replaces any
 * unused token they had, so a lost or leaked token can be killed by issuing another.
 */
export async function issueUserToken(
  db: DB,
  config: Config,
  actor: Admin,
  rawEmail: unknown,
  rawAreas: unknown,
  ip: string,
) {
  const email = normalizeEmail(rawEmail);
  const person = requirePerson(config, email);
  if (rawAreas !== undefined && !Array.isArray(rawAreas)) {
    throw new AppError(400, "invalid_areas", "Areas must be a list.");
  }
  const wanted = new Set(["general", ...((rawAreas as unknown[] | undefined) ?? [])]);
  for (const id of wanted) {
    if (!config.areas.some((a) => a.id === id)) throw new AppError(400, "unknown_area", `Unknown area: ${String(id)}`);
  }
  const areas = config.areas.filter((a) => wanted.has(a.id)).map((a) => a.id);
  const token = await secretPair(JOIN_TOKEN_PREFIX);
  const now = config.now();
  const expiresAt = now + config.userTokenTtlMs;

  const userId = tx(db, () => {
    const existing = one<UserRow>(db, "SELECT * FROM users WHERE email = ?", email);
    if (existing?.status === "deactivated") {
      throw new AppError(409, "user_deactivated", "Reactivate this person before giving them a new token.");
    }
    const id = existing?.id ?? newId();
    if (existing) {
      run(db, "UPDATE users SET areas = ?, updated_at = ? WHERE id = ?", JSON.stringify(areas), now, id);
    } else {
      run(
        db,
        "INSERT INTO users (id, email, name, areas, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, ?)",
        id,
        email,
        person.name,
        JSON.stringify(areas),
        now,
        now,
      );
    }
    run(
      db,
      "UPDATE join_tokens SET revoked_at = ? WHERE user_id = ? AND kind = 'invite' AND revoked_at IS NULL",
      now,
      id,
    );
    const tokenId = newId();
    run(
      db,
      `INSERT INTO join_tokens (id, user_id, kind, token_hash, max_enrollments, expires_at, created_by, created_at)
       VALUES (?, ?, 'invite', ?, ?, ?, ?, ?)`,
      tokenId,
      id,
      token.hash,
      config.userTokenMaxEnrollments,
      expiresAt,
      `admin:${actor.id}`,
      now,
    );
    audit(db, now, {
      actorType: "admin",
      actorId: actor.id,
      action: "user_token.issued",
      target: email,
      detail: { tokenId, areas },
      ip,
    });
    return id;
  });

  return {
    token: token.secret,
    userId,
    email,
    areas,
    expiresAt,
    maxDevices: config.userTokenMaxEnrollments,
  };
}

/** Accepts only a public P-256 key. A JWK carrying "d" is a private key and is refused outright. */
export function validatePublicJwk(value: unknown): JsonWebKey {
  if (!value || typeof value !== "object") throw new AppError(400, "invalid_key", "Missing device public key.");
  const jwk = value as Record<string, unknown>;
  if ("d" in jwk) {
    throw new AppError(400, "private_key_sent", "Send only the public key. The private key must never leave the device.");
  }
  if (
    jwk.kty !== "EC" || jwk.crv !== "P-256" || typeof jwk.x !== "string" || typeof jwk.y !== "string" ||
    jwk.x.length > 64 || jwk.y.length > 64
  ) {
    throw new AppError(400, "invalid_key", "The device key must be an EC P-256 public key.");
  }
  return { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y };
}

async function importDeviceKey(jwk: JsonWebKey): Promise<CryptoKey> {
  try {
    return await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  } catch {
    throw new AppError(400, "invalid_key", "The device key isn't a valid P-256 key.");
  }
}

/** Logs failed join attempts (no token in the log) so admins can spot guessing. */
async function auditingFailures<T>(db: DB, config: Config, ip: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof AppError) {
      audit(db, config.now(), { actorType: "anonymous", action: "device.enroll_failed", detail: { code: err.code }, ip });
    }
    throw err;
  }
}

/**
 * Every check a token must pass to add a device. Synchronous, so it runs again inside
 * the final transaction and two devices can't both take the last slot.
 */
function usableToken(db: DB, config: Config, tokenHash: string, now: number): { t: TokenRow; user: UserRow } {
  const t = one<TokenRow>(db, "SELECT * FROM join_tokens WHERE token_hash = ?", tokenHash);
  if (!t) throw new AppError(401, "token_invalid", "This token isn't valid. Check you copied all of it.");
  if (t.revoked_at !== null) {
    throw new AppError(410, "token_revoked", "This token was replaced or revoked. Ask an admin for a new one.");
  }
  if (t.expires_at <= now) throw new AppError(410, "token_expired", "This token has expired. Ask an admin for a new one.");
  if (t.enrollments >= t.max_enrollments) {
    throw new AppError(410, "token_used_up", "This token has already been used on as many devices as it allows.");
  }
  const user = one<UserRow>(db, "SELECT * FROM users WHERE id = ?", t.user_id)!;
  if (user.status !== "active") throw new AppError(403, "user_deactivated", "Your account is deactivated. Contact an admin.");
  const { c: deviceCount } = one<{ c: number }>(
    db,
    "SELECT COUNT(*) AS c FROM devices WHERE user_id = ? AND revoked_at IS NULL",
    user.id,
  )!;
  if (deviceCount >= config.maxDevicesPerUser) {
    throw new AppError(
      409,
      "device_limit",
      `You already have ${deviceCount} devices. Remove one from a device you've already joined, or ask an admin.`,
    );
  }
  return { t, user };
}

interface PasskeyRow {
  id: string;
  public_key: string;
  counter: number;
  transports: string;
}

function tokenPasskeys(db: DB, tokenId: string): PasskeyRow[] {
  return all<PasskeyRow>(
    db,
    "SELECT id, public_key, counter, transports FROM user_passkeys WHERE token_id = ? AND revoked_at IS NULL",
    tokenId,
  );
}

/**
 * Step 1 of joining: checks the token without using it up and says what the person must do.
 * A personal token's first use creates a passkey tied to that token ("register"); every later
 * use needs that same passkey ("authenticate"). A leaked token alone is useless.
 * Transfer codes come from an already-trusted device and need no passkey ("none").
 */
export function startEnrollment(db: DB, config: Config, body: { token?: unknown }, ip: string) {
  return auditingFailures(db, config, ip, async () => {
    const tokenHash = await sha256Hex(text(body.token, "token", 200));
    const { t, user } = usableToken(db, config, tokenHash, config.now());
    const person = { name: user.name, email: user.email };
    if (t.kind === "transfer") return { mode: "none" as const, person };

    const bound = tokenPasskeys(db, t.id);
    const mode = bound.length ? "authenticate" as const : "register" as const;
    const options = mode === "register"
      ? await registrationOptions(config, { id: user.id, email: user.email })
      : await authenticationOptions(config, bound.map((p) => ({ id: p.id, transports: JSON.parse(p.transports) })));
    const enrollId = newId();
    run(
      db,
      "INSERT INTO enroll_challenges (id, token_id, mode, challenge, expires_at) VALUES (?, ?, ?, ?, ?)",
      enrollId,
      t.id,
      mode,
      options.challenge,
      config.now() + config.challengeTtlMs,
    );
    return { mode, enrollId, options, person };
  });
}

/**
 * Checks the passkey for a personal token. Returns a synchronous commit step that runs
 * inside the final transaction: it saves a new passkey or the used passkey's counter.
 */
async function verifyTokenPasskey(
  db: DB,
  config: Config,
  t: TokenRow,
  enrollId: unknown,
  passkey: unknown,
): Promise<{ created: boolean; commit: () => void }> {
  if (typeof enrollId !== "string" || !passkey || typeof passkey !== "object") {
    throw new AppError(
      400,
      "passkey_required",
      "This token needs your passkey. Join from the join page in Chrome or Edge.",
    );
  }
  const now = config.now();
  const challenge = tx(db, () => {
    const row = one<{ mode: string; challenge: string; expires_at: number; used_at: number | null }>(
      db,
      "SELECT mode, challenge, expires_at, used_at FROM enroll_challenges WHERE id = ? AND token_id = ?",
      enrollId,
      t.id,
    );
    if (!row || row.used_at !== null || row.expires_at <= now) {
      throw new AppError(400, "join_expired", "That took too long. Click Join again.");
    }
    run(db, "UPDATE enroll_challenges SET used_at = ? WHERE id = ?", now, enrollId);
    return row;
  });

  if (challenge.mode === "register") {
    const created = await verifyRegistration(config, passkey as RegistrationResponse, challenge.challenge);
    return {
      created: true,
      commit: () => {
        // Another device may have created this token's passkey while we were verifying.
        if (tokenPasskeys(db, t.id).length) {
          throw new AppError(409, "passkey_changed", "This token already has a passkey. Click Join again.");
        }
        run(
          db,
          `INSERT INTO user_passkeys (id, user_id, token_id, public_key, counter, transports, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          created.id,
          t.user_id,
          t.id,
          b64url(created.publicKey),
          created.counter,
          JSON.stringify(created.transports),
          config.now(),
        );
      },
    };
  }

  const credentialId = typeof (passkey as { id?: unknown }).id === "string" ? (passkey as { id: string }).id : "";
  const stored = tokenPasskeys(db, t.id).find((p) => p.id === credentialId);
  if (!stored) {
    throw new AppError(401, "passkey_not_for_token", "That passkey isn't the one tied to this token.");
  }
  const newCounter = await verifyAuthentication(config, passkey as AuthenticationResponse, challenge.challenge, {
    id: stored.id,
    publicKey: fromB64url(stored.public_key),
    counter: stored.counter,
    transports: JSON.parse(stored.transports),
  });
  return {
    created: false,
    commit: () => run(db, "UPDATE user_passkeys SET counter = ? WHERE id = ?", newCounter, stored.id),
  };
}

/**
 * Step 2 of joining: the device sends a public key it generated (the private key stays on
 * the device) plus, for a personal token, the passkey answer. From then on the device
 * proves itself by signing challenges.
 */
export function enrollDevice(
  db: DB,
  config: Config,
  body: { token?: unknown; deviceName?: unknown; publicKey?: unknown; enrollId?: unknown; passkey?: unknown },
  ip: string,
) {
  return auditingFailures(db, config, ip, () => enroll(db, config, body, ip));
}

async function enroll(
  db: DB,
  config: Config,
  body: { token?: unknown; deviceName?: unknown; publicKey?: unknown; enrollId?: unknown; passkey?: unknown },
  ip: string,
) {
  const token = text(body.token, "token", 200);
  const deviceName = text(body.deviceName, "device_name", 60);
  const jwk = validatePublicJwk(body.publicKey);
  await importDeviceKey(jwk);
  const tokenHash = await sha256Hex(token);

  const { t: checked } = usableToken(db, config, tokenHash, config.now());
  const proof = checked.kind === "invite" ? await verifyTokenPasskey(db, config, checked, body.enrollId, body.passkey) : null;
  const now = config.now();

  return tx(db, () => {
    const { t, user } = usableToken(db, config, tokenHash, now);
    proof?.commit();

    const deviceId = newId();
    run(
      db,
      "INSERT INTO devices (id, user_id, name, public_jwk, enrolled_via, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      deviceId,
      user.id,
      deviceName,
      JSON.stringify(jwk),
      t.id,
      now,
    );
    run(db, "UPDATE join_tokens SET enrollments = enrollments + 1 WHERE id = ?", t.id);
    notifyUser(
      db,
      now,
      user.id,
      `New device "${deviceName}" joined your account${t.kind === "transfer" ? " with a transfer code" : ""}. If this wasn't you, contact an admin.`,
      { kind: "device", id: deviceId },
    );
    audit(db, now, {
      actorType: "user",
      actorId: user.id,
      action: "device.enrolled",
      target: deviceId,
      detail: { deviceName, via: t.kind, tokenId: t.id, passkey: proof ? (proof.created ? "created" : "used") : "none" },
      ip,
    });
    return {
      deviceId,
      user: { email: user.email, name: user.name, areas: JSON.parse(user.areas) as string[] },
    };
  });
}

/** The exact bytes a device signs. Versioned and prefixed so a signature can't be reused elsewhere. */
export function deviceProofMessage(challengeId: string, challenge: string): string {
  return `ea-device-auth:v1:${challengeId}:${challenge}`;
}

function activeDevice(db: DB, deviceId: string): DeviceRow & { user_status: string } {
  const device = one<DeviceRow & { user_status: string }>(
    db,
    "SELECT d.*, u.status AS user_status FROM devices d JOIN users u ON u.id = d.user_id WHERE d.id = ?",
    deviceId,
  );
  if (!device) throw new AppError(404, "device_unknown", "This device isn't enrolled. Join with a token.");
  if (device.revoked_at !== null) {
    throw new AppError(403, "device_revoked", "This device was removed. Join again with a new token.");
  }
  if (device.user_status !== "active") {
    throw new AppError(403, "user_deactivated", "Your account is deactivated. Contact an admin.");
  }
  return device;
}

export function createDeviceChallenge(db: DB, config: Config, rawDeviceId: unknown) {
  const device = activeDevice(db, text(rawDeviceId, "device_id", 64));
  const challengeId = newId();
  const challenge = randomSecret(32);
  const expiresAt = config.now() + config.challengeTtlMs;
  run(
    db,
    "INSERT INTO device_challenges (id, device_id, challenge, expires_at) VALUES (?, ?, ?, ?)",
    challengeId,
    device.id,
    challenge,
    expiresAt,
  );
  return { challengeId, challenge, expiresAt };
}

/** Swaps a signed challenge for a 15-minute access token. */
export async function exchangeDeviceProof(
  db: DB,
  config: Config,
  body: { deviceId?: unknown; challengeId?: unknown; signature?: unknown },
  ip: string,
) {
  const deviceId = text(body.deviceId, "device_id", 64);
  const challengeId = text(body.challengeId, "challenge_id", 64);
  const signature = text(body.signature, "signature", 200);
  const now = config.now();

  const challenge = tx(db, () => {
    const row = one<{ challenge: string; expires_at: number; used_at: number | null }>(
      db,
      "SELECT challenge, expires_at, used_at FROM device_challenges WHERE id = ? AND device_id = ?",
      challengeId,
      deviceId,
    );
    if (!row || row.used_at !== null || row.expires_at <= now) {
      throw new AppError(401, "challenge_invalid", "Sign-in timed out. Try again.");
    }
    run(db, "UPDATE device_challenges SET used_at = ? WHERE id = ?", now, challengeId);
    return row.challenge;
  });

  const device = activeDevice(db, deviceId);
  const key = await importDeviceKey(JSON.parse(device.public_jwk));
  let valid = false;
  try {
    valid = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      fromB64url(signature),
      utf8(deviceProofMessage(challengeId, challenge)),
    );
  } catch {
    valid = false;
  }
  if (!valid) {
    audit(db, now, { actorType: "anonymous", action: "device.proof_failed", target: deviceId, ip });
    throw new AppError(401, "proof_invalid", "This device couldn't prove its identity.");
  }

  const token = await secretPair("ea_at_");
  const expiresAt = config.now() + config.accessTokenTtlMs;
  tx(db, () => {
    const fresh = activeDevice(db, deviceId); // revoked while we were verifying?
    run(
      db,
      "INSERT INTO access_tokens (token_hash, device_id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
      token.hash,
      fresh.id,
      fresh.user_id,
      expiresAt,
      now,
    );
    run(db, "UPDATE devices SET last_seen_at = ? WHERE id = ?", now, fresh.id);
  });
  return { accessToken: token.secret, expiresAt };
}

/** Checked on every request, so deactivating a person or removing a device takes effect at once. */
export async function authenticateDevice(db: DB, config: Config, bearer: string | undefined): Promise<DeviceAuth> {
  if (!bearer) throw new AppError(401, "not_authenticated", "Sign in from this device first.");
  const row = one<{ device_id: string; user_id: string }>(
    db,
    `SELECT t.device_id, t.user_id FROM access_tokens t
     JOIN devices d ON d.id = t.device_id JOIN users u ON u.id = t.user_id
     WHERE t.token_hash = ? AND t.expires_at > ? AND d.revoked_at IS NULL AND u.status = 'active'`,
    await sha256Hex(bearer),
    config.now(),
  );
  if (!row) throw new AppError(401, "not_authenticated", "Your session ended. Sign in again from this device.");
  return { userId: row.user_id, deviceId: row.device_id };
}

export function getMe(db: DB, config: Config, auth: DeviceAuth) {
  const user = one<UserRow>(db, "SELECT * FROM users WHERE id = ?", auth.userId)!;
  const areaIds = JSON.parse(user.areas) as string[];
  const devices = all<{ id: string; name: string; created_at: number; last_seen_at: number | null }>(
    db,
    "SELECT id, name, created_at, last_seen_at FROM devices WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at",
    auth.userId,
  );
  const notifications = all<{ message: string; created_at: number }>(
    db,
    "SELECT message, created_at FROM notifications WHERE recipient_type = 'user' AND recipient_id = ? ORDER BY created_at DESC LIMIT 20",
    auth.userId,
  );
  return {
    email: user.email,
    name: user.name,
    areas: config.areas.filter((a) => areaIds.includes(a.id)),
    devices: devices.map((d) => ({
      id: d.id,
      name: d.name,
      createdAt: d.created_at,
      lastSeenAt: d.last_seen_at,
      current: d.id === auth.deviceId,
    })),
    maxDevices: config.maxDevicesPerUser,
    passkeys: one<{ c: number }>(
      db,
      "SELECT COUNT(*) AS c FROM user_passkeys WHERE user_id = ? AND revoked_at IS NULL",
      auth.userId,
    )!.c,
    notifications: notifications.map((n) => ({ message: n.message, createdAt: n.created_at })),
  };
}

/** Lets a person move to a new device without an admin: a one-use code made on a device they already joined. */
export async function createTransferCode(db: DB, config: Config, auth: DeviceAuth, ip: string) {
  const code = await secretPair(JOIN_TOKEN_PREFIX);
  const now = config.now();
  const expiresAt = now + config.transferCodeTtlMs;
  tx(db, () => {
    const device = one<{ name: string }>(db, "SELECT name FROM devices WHERE id = ?", auth.deviceId)!;
    run(
      db,
      "UPDATE join_tokens SET revoked_at = ? WHERE user_id = ? AND kind = 'transfer' AND revoked_at IS NULL",
      now,
      auth.userId,
    );
    run(
      db,
      `INSERT INTO join_tokens (id, user_id, kind, token_hash, max_enrollments, expires_at, created_by, created_at)
       VALUES (?, ?, 'transfer', ?, 1, ?, ?, ?)`,
      newId(),
      auth.userId,
      code.hash,
      expiresAt,
      `device:${auth.deviceId}`,
      now,
    );
    notifyUser(db, now, auth.userId, `A transfer code was created on "${device.name}".`);
    audit(db, now, { actorType: "user", actorId: auth.userId, action: "transfer_code.created", target: auth.deviceId, ip });
  });
  return { code: code.secret, expiresAt };
}

export function removeOwnDevice(db: DB, config: Config, auth: DeviceAuth, deviceId: string, ip: string) {
  const now = config.now();
  return tx(db, () => {
    const device = one<{ name: string }>(
      db,
      "SELECT name FROM devices WHERE id = ? AND user_id = ? AND revoked_at IS NULL",
      deviceId,
      auth.userId,
    );
    if (!device) throw new AppError(404, "device_unknown", "That device isn't on your account.");
    revokeDeviceRow(db, now, deviceId);
    notifyUser(db, now, auth.userId, `Device "${device.name}" was removed from your account.`);
    audit(db, now, { actorType: "user", actorId: auth.userId, action: "device.removed_by_user", target: deviceId, ip });
    return { removed: deviceId, current: deviceId === auth.deviceId };
  });
}

function revokeDeviceRow(db: DB, now: number, deviceId: string) {
  run(db, "UPDATE devices SET revoked_at = ? WHERE id = ?", now, deviceId);
  run(db, "DELETE FROM access_tokens WHERE device_id = ?", deviceId);
}

export function revokeDeviceByAdmin(db: DB, config: Config, actor: Admin, deviceId: string, ip: string) {
  const now = config.now();
  tx(db, () => {
    const device = one<{ user_id: string; name: string }>(
      db,
      "SELECT user_id, name FROM devices WHERE id = ? AND revoked_at IS NULL",
      deviceId,
    );
    if (!device) throw new AppError(404, "device_unknown", "That device isn't active.");
    revokeDeviceRow(db, now, deviceId);
    notifyUser(db, now, device.user_id, `An admin removed device "${device.name}" from your account.`);
    audit(db, now, { actorType: "admin", actorId: actor.id, action: "device.revoked", target: deviceId, ip });
  });
}

/**
 * Offboarding: blocks the person, removes every device and kills unused tokens.
 * Reactivating restores the account but not devices: they join again with a new token.
 */
export function deactivateUser(db: DB, config: Config, actor: Admin, userId: string, ip: string) {
  const now = config.now();
  tx(db, () => {
    const user = one<UserRow>(db, "SELECT * FROM users WHERE id = ?", userId);
    if (!user) throw new AppError(404, "user_not_found", "That person doesn't exist.");
    if (user.status === "deactivated") throw new AppError(409, "already_deactivated", "Already deactivated.");
    run(db, "UPDATE users SET status = 'deactivated', updated_at = ? WHERE id = ?", now, userId);
    run(db, "UPDATE devices SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL", now, userId);
    run(db, "DELETE FROM access_tokens WHERE user_id = ?", userId);
    run(db, "UPDATE join_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL", now, userId);
    run(db, "UPDATE user_passkeys SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL", now, userId);
    audit(db, now, { actorType: "admin", actorId: actor.id, action: "user.deactivated", target: user.email, ip });
  });
}

export function reactivateUser(db: DB, config: Config, actor: Admin, userId: string, ip: string) {
  const now = config.now();
  const user = one<UserRow>(db, "SELECT * FROM users WHERE id = ?", userId);
  if (!user) throw new AppError(404, "user_not_found", "That person doesn't exist.");
  if (user.status === "active") throw new AppError(409, "already_active", "Already active.");
  run(db, "UPDATE users SET status = 'active', updated_at = ? WHERE id = ?", now, userId);
  audit(db, now, { actorType: "admin", actorId: actor.id, action: "user.reactivated", target: user.email, ip });
}
