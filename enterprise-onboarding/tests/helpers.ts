import { createApp } from "../src/app.ts";
import { type Config, makeConfig } from "../src/config.ts";
import { type DB, openDb } from "../src/db.ts";
import { b64url, utf8 } from "../src/encoding.ts";
import { createHostAdminInvite } from "../src/services/admins.ts";
import { SoftAuthenticator } from "./soft-authenticator.ts";

export const ORIGIN = "http://localhost:8787";
export const MINUTE = 60_000;
export const DAY = 24 * 60 * MINUTE;

export interface CallOptions {
  cookie?: string;
  bearer?: string;
  origin?: string | null;
  ip?: string;
}

export interface TestEnv {
  db: DB;
  config: Config;
  clock: { t: number };
  call: (method: string, path: string, body?: unknown, opts?: CallOptions) => Promise<{
    status: number;
    // deno-lint-ignore no-explicit-any
    data: any;
    headers: Headers;
  }>;
}

export async function makeEnv(overrides: Partial<Config> = {}): Promise<TestEnv> {
  const clock = { t: Date.parse("2026-11-07T12:00:00Z") };
  const config = makeConfig({
    origin: ORIGIN,
    people: ["ana", "ben", "carla", "dan", "eva"].map((n) => ({ email: `${n}@example.com`, name: n })),
    areas: [
      { id: "general", name: "Enterprise general", restricted: false },
      { id: "cx", name: "CX", restricted: false },
      { id: "finance", name: "Finance", restricted: true },
    ],
    now: () => clock.t,
    ...overrides,
  });
  const db = openDb(":memory:");
  const handler = await createApp({ db, config });
  const call: TestEnv["call"] = async (method, path, body, opts = {}) => {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["content-type"] = "application/json";
    const origin = opts.origin === undefined ? ORIGIN : opts.origin;
    if (origin) headers.origin = origin;
    if (opts.cookie) headers.cookie = opts.cookie;
    if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`;
    const res = await handler(
      new Request(`${ORIGIN}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      { remoteAddr: { hostname: opts.ip ?? "10.0.0.1" } },
    );
    return { status: res.status, data: await res.json().catch(() => null), headers: res.headers };
  };
  return { db, config, clock, call };
}

export function inviteRef(link: string): string {
  return new URL(link).hash.replace("#invite=", "");
}

export function sessionFrom(headers: Headers): string {
  const cookie = headers.get("set-cookie") ?? "";
  return cookie.split(";")[0];
}

/** Opens an admin link and confirms it with a new software passkey, like a person in a browser. */
export async function redeemAdminLink(env: TestEnv, link: string) {
  const ref = inviteRef(link);
  const authenticator = new SoftAuthenticator(ORIGIN, "localhost");
  const options = await env.call("POST", "/api/admin-invites/registration-options", { invite: ref });
  if (options.status !== 200) throw new Error(`options failed: ${JSON.stringify(options.data)}`);
  const response = await authenticator.create(options.data);
  const redeemed = await env.call("POST", "/api/admin-invites/redeem", { invite: ref, response });
  return { redeemed, authenticator, cookie: sessionFrom(redeemed.headers) };
}

export async function bootstrapAdmin(env: TestEnv, email = "ana@example.com") {
  const invite = await createHostAdminInvite(env.db, env.config, email);
  const { redeemed, authenticator, cookie } = await redeemAdminLink(env, invite.link);
  if (redeemed.status !== 201) throw new Error(`bootstrap failed: ${JSON.stringify(redeemed.data)}`);
  return { cookie, authenticator, admin: redeemed.data.admin };
}

/** Adds a second admin through the console, as the first admin would. */
export async function addAdmin(env: TestEnv, byCookie: string, email: string) {
  const created = await env.call("POST", "/api/admin/admin-invites", { email }, { cookie: byCookie });
  const { redeemed, cookie } = await redeemAdminLink(env, created.data.link);
  if (redeemed.status !== 201) throw new Error(`add admin failed: ${JSON.stringify(redeemed.data)}`);
  return { cookie, admin: redeemed.data.admin };
}

export async function issueToken(env: TestEnv, cookie: string, email: string, areas: string[] = []) {
  const res = await env.call("POST", "/api/admin/user-tokens", { email, areas }, { cookie });
  if (res.status !== 201) throw new Error(`issue failed: ${JSON.stringify(res.data)}`);
  return res.data.token as string;
}

export interface TestDevice {
  deviceId: string;
  keys: CryptoKeyPair;
}

export async function newDeviceKeys() {
  const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
  return { keys, publicKey: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y } };
}

// The person's passkey for each token, so a second computer joining with the same token
// presents the same passkey (as if synced from their phone or password manager).
const personPasskeys = new Map<string, SoftAuthenticator>();

export function passkeyFor(token: string): SoftAuthenticator {
  let authenticator = personPasskeys.get(token);
  if (!authenticator) personPasskeys.set(token, authenticator = new SoftAuthenticator(ORIGIN, "localhost"));
  return authenticator;
}

/** Joins like the join page does: start, create or use the passkey, then enroll the device. */
export async function enroll(
  env: TestEnv,
  token: string,
  deviceName = "Laptop",
  ip?: string,
  passkeys: SoftAuthenticator = passkeyFor(token),
) {
  const start = await env.call("POST", "/api/enroll/start", { token }, { origin: null, ip });
  if (start.status !== 200) return { res: start, device: undefined, start };
  const passkey = start.data.mode === "register"
    ? await passkeys.create(start.data.options)
    : start.data.mode === "authenticate"
    ? await passkeys.get(start.data.options)
    : undefined;
  const { keys, publicKey } = await newDeviceKeys();
  const res = await env.call("POST", "/api/enroll", {
    token,
    deviceName,
    publicKey,
    enrollId: start.data.enrollId,
    passkey,
  }, { origin: null, ip });
  return { res, device: res.status === 201 ? { deviceId: res.data.deviceId as string, keys } : undefined, start };
}

export async function signProof(keys: CryptoKeyPair, challengeId: string, challenge: string) {
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    keys.privateKey,
    utf8(`ea-device-auth:v1:${challengeId}:${challenge}`),
  );
  return b64url(new Uint8Array(signature));
}

/** Signs a fresh challenge and returns the access token (or the failed response). */
export async function deviceSignIn(env: TestEnv, device: TestDevice) {
  const ch = await env.call("POST", "/api/device/challenge", { deviceId: device.deviceId }, { origin: null });
  if (ch.status !== 200) return { status: ch.status, data: ch.data, token: undefined };
  const signature = await signProof(device.keys, ch.data.challengeId, ch.data.challenge);
  const res = await env.call("POST", "/api/device/token", {
    deviceId: device.deviceId,
    challengeId: ch.data.challengeId,
    signature,
  }, { origin: null });
  return { status: res.status, data: res.data, token: res.data?.accessToken as string | undefined };
}
