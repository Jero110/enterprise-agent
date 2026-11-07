import assert from "node:assert/strict";
import { all } from "../src/db.ts";
import {
  bootstrapAdmin,
  DAY,
  deviceSignIn,
  enroll,
  issueToken,
  makeEnv,
  MINUTE,
  newDeviceKeys,
  ORIGIN,
  passkeyFor,
  signProof,
} from "./helpers.ts";
import { SoftAuthenticator } from "./soft-authenticator.ts";

async function setup() {
  const env = await makeEnv();
  const { cookie } = await bootstrapAdmin(env);
  return { env, cookie };
}

Deno.test("person: token → enroll → signed challenge → access", async () => {
  const { env, cookie } = await setup();
  const token = await issueToken(env, cookie, "ben@example.com", ["cx"]);
  assert.ok(token.startsWith("ea_join_"));

  const { res, device } = await enroll(env, token, "Work laptop");
  assert.equal(res.status, 201);
  assert.deepEqual(res.data.user.areas, ["general", "cx"], "everyone gets general");

  const signIn = await deviceSignIn(env, device!);
  assert.equal(signIn.status, 200);
  const me = await env.call("GET", "/api/me", undefined, { bearer: signIn.token });
  assert.equal(me.status, 200);
  assert.equal(me.data.email, "ben@example.com");
  assert.equal(me.data.devices.length, 1);
  assert.ok(me.data.notifications[0].message.includes('New device "Work laptop"'), "person is told about each device");
});

Deno.test("tokens are stored only as hashes", async () => {
  const { env, cookie } = await setup();
  const token = await issueToken(env, cookie, "ben@example.com");
  const dump = JSON.stringify(all(env.db, "SELECT * FROM join_tokens"));
  assert.ok(!dump.includes(token));
});

Deno.test("only people on the company list get tokens, and only known areas", async () => {
  const { env, cookie } = await setup();
  const stranger = await env.call("POST", "/api/admin/user-tokens", { email: "x@evil.com" }, { cookie });
  assert.equal(stranger.data.error, "not_in_people_list");
  const badArea = await env.call("POST", "/api/admin/user-tokens", { email: "ben@example.com", areas: ["hr"] }, { cookie });
  assert.equal(badArea.data.error, "unknown_area");
  const noAdmin = await env.call("POST", "/api/admin/user-tokens", { email: "ben@example.com" });
  assert.equal(noAdmin.status, 401);
});

Deno.test("a token enrolls at most 2 devices, and the person at most 2 devices", async () => {
  const { env, cookie } = await setup();
  const token = await issueToken(env, cookie, "ben@example.com");
  assert.equal((await enroll(env, token, "Laptop")).res.status, 201);
  assert.equal((await enroll(env, token, "Desktop")).res.status, 201);
  const third = await enroll(env, token, "Stranger's PC");
  assert.equal(third.res.data.error, "token_used_up");

  // A fresh token doesn't get around the per-person device cap.
  const second = await issueToken(env, cookie, "ben@example.com");
  assert.equal((await enroll(env, second, "Phone")).res.data.error, "device_limit");
});

Deno.test("personal tokens last 30 days", async () => {
  const { env, cookie } = await setup();
  const token = await issueToken(env, cookie, "ben@example.com");
  env.clock.t += 29 * DAY;
  assert.equal((await enroll(env, token, "Laptop")).res.status, 201, "still good on day 29");
  env.clock.t += DAY + 1;
  assert.equal((await enroll(env, token, "Desktop")).res.data.error, "token_expired");
});

Deno.test("a token's first use creates the person's passkey, tied to that token", async () => {
  const { env, cookie } = await setup();
  const token = await issueToken(env, cookie, "ben@example.com");
  const first = await enroll(env, token, "Laptop");
  assert.equal(first.start.data.mode, "register");
  assert.equal(first.start.data.person.name, "ben");
  const second = await enroll(env, token, "Desktop");
  assert.equal(second.start.data.mode, "authenticate", "later uses need the same passkey");
  assert.equal(second.res.status, 201);

  const rows = all<{ token_id: string }>(env.db, "SELECT token_id FROM user_passkeys");
  assert.equal(rows.length, 1);
  const tokenRow = all<{ id: string }>(env.db, "SELECT id FROM join_tokens WHERE kind = 'invite'")[0];
  assert.equal(rows[0].token_id, tokenRow.id);
  const { token: access } = await deviceSignIn(env, second.device!);
  assert.equal((await env.call("GET", "/api/me", undefined, { bearer: access })).data.passkeys, 1);
});

Deno.test("a leaked token is useless without the person's passkey", async () => {
  const { env, cookie } = await setup();
  const token = await issueToken(env, cookie, "ben@example.com");
  assert.equal((await enroll(env, token, "Ben's laptop")).res.status, 201);

  // The thief has the token but their own passkey, not Ben's.
  const thief = new SoftAuthenticator(ORIGIN, "localhost");
  await thief.create({ challenge: "x", user: { id: "dGhpZWY" } });
  const stolen = await enroll(env, token, "Thief's PC", undefined, thief);
  assert.equal(stolen.res.status, 401);
  assert.equal(stolen.res.data.error, "passkey_not_for_token");
});

Deno.test("another person's passkey can't unlock someone's token", async () => {
  const { env, cookie } = await setup();
  const benToken = await issueToken(env, cookie, "ben@example.com");
  const carlaToken = await issueToken(env, cookie, "carla@example.com");
  await enroll(env, benToken, "Ben laptop");
  await enroll(env, carlaToken, "Carla laptop");
  const res = await enroll(env, benToken, "Sneaky", undefined, passkeyFor(carlaToken));
  assert.equal(res.res.data.error, "passkey_not_for_token");
});

Deno.test("personal tokens can't join without a passkey; transfer codes don't need one", async () => {
  const { env, cookie } = await setup();
  const token = await issueToken(env, cookie, "ben@example.com");
  const { publicKey } = await newDeviceKeys();
  const bare = await env.call("POST", "/api/enroll", { token, deviceName: "x", publicKey }, { origin: null });
  assert.equal(bare.data.error, "passkey_required");

  const laptop = (await enroll(env, token, "Laptop")).device!;
  const { token: access } = await deviceSignIn(env, laptop);
  const { data } = await env.call("POST", "/api/me/transfer-code", {}, { bearer: access });
  const start = await env.call("POST", "/api/enroll/start", { token: data.code }, { origin: null });
  assert.equal(start.data.mode, "none");
  const moved = await env.call("POST", "/api/enroll", { token: data.code, deviceName: "New PC", publicKey }, {
    origin: null,
  });
  assert.equal(moved.status, 201);
});

Deno.test("each passkey answer works once", async () => {
  const { env, cookie } = await setup();
  const token = await issueToken(env, cookie, "ben@example.com");
  const start = await env.call("POST", "/api/enroll/start", { token }, { origin: null });
  const passkey = await passkeyFor(token).create(start.data.options);
  const body = async (name: string) => ({ token, deviceName: name, publicKey: (await newDeviceKeys()).publicKey, enrollId: start.data.enrollId, passkey });
  assert.equal((await env.call("POST", "/api/enroll", await body("A"), { origin: null })).status, 201);
  const replay = await env.call("POST", "/api/enroll", await body("B"), { origin: null });
  assert.equal(replay.data.error, "join_expired");
});

Deno.test("deactivating someone cancels their passkeys; a new token makes a new one", async () => {
  const { env, cookie } = await setup();
  await enroll(env, await issueToken(env, cookie, "ben@example.com"));
  const userId = (await env.call("GET", "/api/admin/overview", undefined, { cookie })).data.users[0].id;
  await env.call("POST", `/api/admin/users/${userId}/deactivate`, {}, { cookie });
  assert.equal(all(env.db, "SELECT * FROM user_passkeys WHERE revoked_at IS NULL").length, 0);
  await env.call("POST", `/api/admin/users/${userId}/reactivate`, {}, { cookie });
  const again = await enroll(env, await issueToken(env, cookie, "ben@example.com"));
  assert.equal(again.start.data.mode, "register");
  assert.equal(again.res.status, 201);
});

Deno.test("issuing a new token cancels the unused old one", async () => {
  const { env, cookie } = await setup();
  const leaked = await issueToken(env, cookie, "ben@example.com");
  await issueToken(env, cookie, "ben@example.com");
  assert.equal((await enroll(env, leaked)).res.data.error, "token_revoked");
});

Deno.test("a device must never send its private key", async () => {
  const { env, cookie } = await setup();
  const token = await issueToken(env, cookie, "ben@example.com");
  const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const privateJwk = await crypto.subtle.exportKey("jwk", keys.privateKey);
  const res = await env.call("POST", "/api/enroll", { token, deviceName: "x", publicKey: privateJwk }, { origin: null });
  assert.equal(res.data.error, "private_key_sent");
  // The refused attempt didn't use up the token.
  assert.equal((await enroll(env, token)).res.status, 201);
});

Deno.test("device proof: wrong key, reused challenge and expired challenge all fail", async () => {
  const { env, cookie } = await setup();
  const { device } = await enroll(env, await issueToken(env, cookie, "ben@example.com"));

  const ch = await env.call("POST", "/api/device/challenge", { deviceId: device!.deviceId }, { origin: null });
  const other = await newDeviceKeys();
  const forged = await env.call("POST", "/api/device/token", {
    deviceId: device!.deviceId,
    challengeId: ch.data.challengeId,
    signature: await signProof(other.keys, ch.data.challengeId, ch.data.challenge),
  }, { origin: null });
  assert.equal(forged.data.error, "proof_invalid");

  // That challenge is now spent, even with the right signature.
  const reused = await env.call("POST", "/api/device/token", {
    deviceId: device!.deviceId,
    challengeId: ch.data.challengeId,
    signature: await signProof(device!.keys, ch.data.challengeId, ch.data.challenge),
  }, { origin: null });
  assert.equal(reused.data.error, "challenge_invalid");

  const late = await env.call("POST", "/api/device/challenge", { deviceId: device!.deviceId }, { origin: null });
  env.clock.t += 3 * MINUTE;
  const expired = await env.call("POST", "/api/device/token", {
    deviceId: device!.deviceId,
    challengeId: late.data.challengeId,
    signature: await signProof(device!.keys, late.data.challengeId, late.data.challenge),
  }, { origin: null });
  assert.equal(expired.data.error, "challenge_invalid");
});

Deno.test("access tokens last 15 minutes", async () => {
  const { env, cookie } = await setup();
  const { device } = await enroll(env, await issueToken(env, cookie, "ben@example.com"));
  const { token } = await deviceSignIn(env, device!);
  env.clock.t += 16 * MINUTE;
  assert.equal((await env.call("GET", "/api/me", undefined, { bearer: token })).status, 401);
  assert.equal((await deviceSignIn(env, device!)).status, 200, "the device just signs a new challenge");
});

Deno.test("deactivating a person cuts off every device immediately", async () => {
  const { env, cookie } = await setup();
  const { device } = await enroll(env, await issueToken(env, cookie, "ben@example.com"));
  const { token } = await deviceSignIn(env, device!);
  const userId = (await env.call("GET", "/api/admin/overview", undefined, { cookie })).data.users[0].id;

  await env.call("POST", `/api/admin/users/${userId}/deactivate`, {}, { cookie });
  assert.equal((await env.call("GET", "/api/me", undefined, { bearer: token })).status, 401, "live token dies at once");
  assert.equal((await deviceSignIn(env, device!)).status, 403);
  const blocked = await env.call("POST", "/api/admin/user-tokens", { email: "ben@example.com" }, { cookie });
  assert.equal(blocked.data.error, "user_deactivated");

  // Reactivating doesn't bring old devices back: they join again with a new token.
  await env.call("POST", `/api/admin/users/${userId}/reactivate`, {}, { cookie });
  assert.equal((await deviceSignIn(env, device!)).data.error, "device_revoked");
  assert.equal((await enroll(env, await issueToken(env, cookie, "ben@example.com"))).res.status, 201);
});

Deno.test("the console's audit log names devices and revoked links, not raw ids", async () => {
  const { env, cookie } = await setup();
  const { device } = await enroll(env, await issueToken(env, cookie, "ben@example.com"), "Laptop");
  await env.call("POST", `/api/admin/devices/${device!.deviceId}/revoke`, {}, { cookie });
  const link = await env.call("POST", "/api/admin/admin-invites", { email: "dan@example.com" }, { cookie });
  await env.call("POST", `/api/admin/admin-invites/${link.data.id}/revoke`, {}, { cookie });
  const { audit } = (await env.call("GET", "/api/admin/overview", undefined, { cookie })).data;
  const target = (action: string) => audit.find((r: { action: string }) => r.action === action)?.target;
  assert.equal(target("device.revoked"), "Laptop (ben@example.com)");
  assert.equal(target("admin_invite.revoked"), "dan@example.com");
});

Deno.test("an admin can remove one stolen device; the other keeps working", async () => {
  const { env, cookie } = await setup();
  const token = await issueToken(env, cookie, "ben@example.com");
  const laptop = (await enroll(env, token, "Laptop")).device!;
  const desktop = (await enroll(env, token, "Desktop")).device!;
  await env.call("POST", `/api/admin/devices/${laptop.deviceId}/revoke`, {}, { cookie });
  assert.equal((await deviceSignIn(env, laptop)).data.error, "device_revoked");
  assert.equal((await deviceSignIn(env, desktop)).status, 200);
});

Deno.test("transfer code: move to a new device without an admin", async () => {
  const { env, cookie } = await setup();
  const token = await issueToken(env, cookie, "ben@example.com");
  const laptop = (await enroll(env, token, "Laptop")).device!;
  const desktop = (await enroll(env, token, "Desktop")).device!;
  const { token: access } = await deviceSignIn(env, laptop);

  const { data: transfer } = await env.call("POST", "/api/me/transfer-code", {}, { bearer: access });
  // At the cap: the person removes the old desktop from the laptop, then the new PC joins.
  assert.equal((await enroll(env, transfer.code, "New PC")).res.data.error, "device_limit");
  await env.call("POST", `/api/me/devices/${desktop.deviceId}/remove`, {}, { bearer: access });
  assert.equal((await enroll(env, transfer.code, "New PC")).res.status, 201);
  assert.equal((await enroll(env, transfer.code, "Another")).res.data.error, "token_used_up", "transfer codes work once");
});

Deno.test("transfer codes expire after 15 minutes", async () => {
  const { env, cookie } = await setup();
  const laptop = (await enroll(env, await issueToken(env, cookie, "ben@example.com"))).device!;
  const { token: access } = await deviceSignIn(env, laptop);
  const { data } = await env.call("POST", "/api/me/transfer-code", {}, { bearer: access });
  env.clock.t += 16 * MINUTE;
  assert.equal((await enroll(env, data.code, "New PC")).res.data.error, "token_expired");
});

Deno.test("a person can't remove someone else's device", async () => {
  const { env, cookie } = await setup();
  const ben = (await enroll(env, await issueToken(env, cookie, "ben@example.com"))).device!;
  const carla = (await enroll(env, await issueToken(env, cookie, "carla@example.com"))).device!;
  const { token } = await deviceSignIn(env, ben);
  const res = await env.call("POST", `/api/me/devices/${carla.deviceId}/remove`, {}, { bearer: token });
  assert.equal(res.status, 404);
  assert.equal((await deviceSignIn(env, carla)).status, 200);
});

Deno.test("guessing tokens is rate limited per IP", async () => {
  const { env } = await setup();
  const { publicKey } = await newDeviceKeys();
  const statuses: number[] = [];
  for (let i = 0; i < 22; i++) {
    const res = await env.call("POST", "/api/enroll", { token: `ea_join_guess${i}`, deviceName: "x", publicKey }, {
      origin: null,
      ip: "203.0.113.9",
    });
    statuses.push(res.status);
  }
  assert.deepEqual(statuses.slice(0, 20), Array(20).fill(401));
  assert.deepEqual(statuses.slice(20), [429, 429]);
  // Failed guesses are logged for admins to see.
  const failures = all(env.db, "SELECT * FROM audit_log WHERE action = 'device.enroll_failed'");
  assert.equal(failures.length, 20);
});

Deno.test("two devices racing to use the last slot of a token: only one wins", async () => {
  const { env, cookie } = await setup();
  const token = await issueToken(env, cookie, "ben@example.com");
  await enroll(env, token, "First");
  const results = await Promise.all([enroll(env, token, "A"), enroll(env, token, "B"), enroll(env, token, "C")]);
  assert.equal(results.filter((r) => r.res.status === 201).length, 1);
});
