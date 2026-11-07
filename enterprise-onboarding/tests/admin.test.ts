import assert from "node:assert/strict";
import { createHostAdminInvite } from "../src/services/admins.ts";
import { all } from "../src/db.ts";
import {
  addAdmin,
  bootstrapAdmin,
  inviteRef,
  makeEnv,
  MINUTE,
  ORIGIN,
  redeemAdminLink,
  sessionFrom,
} from "./helpers.ts";

Deno.test("first admin: host link → preview → passkey → signed in", async () => {
  const env = await makeEnv();
  const invite = await createHostAdminInvite(env.db, env.config, "Ana@Example.com");
  assert.equal(invite.status, "ready");
  assert.ok(invite.link.startsWith(`${ORIGIN}/admin/join#invite=`), "secret travels after #");

  // Previewing (what a link scanner or a curious click does) changes nothing.
  const ref = inviteRef(invite.link);
  for (let i = 0; i < 3; i++) {
    const preview = await env.call("POST", "/api/admin-invites/preview", { invite: ref });
    assert.equal(preview.status, 200);
    assert.equal(preview.data.email, "ana@example.com");
  }

  const { redeemed, cookie } = await redeemAdminLink(env, invite.link);
  assert.equal(redeemed.status, 201);
  assert.match(redeemed.headers.get("set-cookie")!, /HttpOnly; SameSite=Strict/);

  const overview = await env.call("GET", "/api/admin/overview", undefined, { cookie });
  assert.equal(overview.status, 200);
  assert.equal(overview.data.me.email, "ana@example.com");
  assert.ok(overview.data.notifications.some((n: { message: string }) => n.message.includes("activated")));
});

Deno.test("admin link works once", async () => {
  const env = await makeEnv();
  const invite = await createHostAdminInvite(env.db, env.config, "ana@example.com");
  assert.equal((await redeemAdminLink(env, invite.link)).redeemed.status, 201);
  const again = await env.call("POST", "/api/admin-invites/preview", { invite: inviteRef(invite.link) });
  assert.equal(again.status, 410);
  assert.equal(again.data.error, "invite_used");
});

Deno.test("admin link expires after 60 minutes", async () => {
  const env = await makeEnv();
  const invite = await createHostAdminInvite(env.db, env.config, "ana@example.com");
  env.clock.t += 61 * MINUTE;
  const res = await env.call("POST", "/api/admin-invites/preview", { invite: inviteRef(invite.link) });
  assert.equal(res.data.error, "invite_expired");
});

Deno.test("a wrong secret looks the same as a missing link", async () => {
  const env = await makeEnv();
  const invite = await createHostAdminInvite(env.db, env.config, "ana@example.com");
  const [id] = inviteRef(invite.link).split(".");
  const wrong = await env.call("POST", "/api/admin-invites/preview", { invite: `${id}.not-the-secret` });
  const missing = await env.call("POST", "/api/admin-invites/preview", { invite: `${crypto.randomUUID()}.x` });
  assert.equal(wrong.status, 404);
  assert.deepEqual(wrong.data, missing.data);
});

Deno.test("only hashes of admin link secrets are stored", async () => {
  const env = await makeEnv();
  const invite = await createHostAdminInvite(env.db, env.config, "ana@example.com");
  const secret = inviteRef(invite.link).split(".")[1];
  const dump = JSON.stringify(all(env.db, "SELECT * FROM admin_invites"));
  assert.ok(!dump.includes(secret));
});

Deno.test("host can't mint more admins once admins exist, except with break-glass", async () => {
  const env = await makeEnv();
  await bootstrapAdmin(env);
  await assert.rejects(createHostAdminInvite(env.db, env.config, "ben@example.com"), /Admins already exist/);
  const emergency = await createHostAdminInvite(env.db, env.config, "ben@example.com", { breakGlass: true });
  assert.equal(emergency.status, "ready");
  const actions = all<{ action: string }>(env.db, "SELECT action FROM audit_log").map((r) => r.action);
  assert.ok(actions.includes("admin_invite.break_glass"));
});

Deno.test("people not on the company list can't be invited", async () => {
  const env = await makeEnv();
  await assert.rejects(createHostAdminInvite(env.db, env.config, "mallory@evil.com"), /people list/);
});

Deno.test("two-person rule: with 2+ admins a new link needs a different admin's approval", async () => {
  const env = await makeEnv();
  const ana = await bootstrapAdmin(env);
  // With one admin, the second admin's link works straight away (that's how you reach two).
  const ben = await addAdmin(env, ana.cookie, "ben@example.com");

  const created = await env.call("POST", "/api/admin/admin-invites", { email: "carla@example.com" }, { cookie: ana.cookie });
  assert.equal(created.data.status, "awaiting_approval");
  const ref = inviteRef(created.data.link);
  const early = await env.call("POST", "/api/admin-invites/preview", { invite: ref });
  assert.equal(early.data.error, "needs_approval");

  const self = await env.call("POST", `/api/admin/admin-invites/${created.data.id}/approve`, {}, { cookie: ana.cookie });
  assert.equal(self.status, 403);
  assert.equal(self.data.error, "two_person_rule");

  const approved = await env.call("POST", `/api/admin/admin-invites/${created.data.id}/approve`, {}, { cookie: ben.cookie });
  assert.equal(approved.status, 200);
  const { redeemed } = await redeemAdminLink(env, created.data.link);
  assert.equal(redeemed.status, 201);
});

Deno.test("approved link's 60 minutes start at approval", async () => {
  const env = await makeEnv();
  const ana = await bootstrapAdmin(env);
  const ben = await addAdmin(env, ana.cookie, "ben@example.com");
  const created = await env.call("POST", "/api/admin/admin-invites", { email: "carla@example.com" }, { cookie: ana.cookie });
  env.clock.t += 50 * MINUTE; // approved 50 minutes after creation
  const approved = await env.call("POST", `/api/admin/admin-invites/${created.data.id}/approve`, {}, { cookie: ben.cookie });
  assert.equal(approved.status, 200);
  env.clock.t += 30 * MINUTE; // 80 minutes after creation, 30 after approval: still valid
  const preview = await env.call("POST", "/api/admin-invites/preview", { invite: inviteRef(created.data.link) });
  assert.equal(preview.status, 200);
  env.clock.t += 31 * MINUTE; // 61 minutes after approval: expired
  const late = await env.call("POST", "/api/admin-invites/preview", { invite: inviteRef(created.data.link) });
  assert.equal(late.data.error, "invite_expired");
});

Deno.test("passkey sign-in after logout; revoked admins can't sign in", async () => {
  const env = await makeEnv();
  const ana = await bootstrapAdmin(env);
  const ben = await addAdmin(env, ana.cookie, "ben@example.com");

  await env.call("POST", "/api/admin/logout", {}, { cookie: ana.cookie });
  assert.equal((await env.call("GET", "/api/admin/overview", undefined, { cookie: ana.cookie })).status, 401);

  const options = await env.call("POST", "/api/admin/login/options", {});
  const assertion = await ana.authenticator.get(options.data.options);
  const login = await env.call("POST", "/api/admin/login/verify", { loginId: options.data.loginId, response: assertion });
  assert.equal(login.status, 200);
  const cookie = sessionFrom(login.headers);
  assert.equal((await env.call("GET", "/api/admin/overview", undefined, { cookie })).status, 200);

  // Replaying the same signed answer fails: each challenge works once.
  const replay = await env.call("POST", "/api/admin/login/verify", { loginId: options.data.loginId, response: assertion });
  assert.equal(replay.status, 400);

  await env.call("POST", `/api/admin/admins/${ana.admin.id}/revoke`, {}, { cookie: ben.cookie });
  assert.equal((await env.call("GET", "/api/admin/overview", undefined, { cookie })).status, 401, "sessions end at once");
  const again = await env.call("POST", "/api/admin/login/options", {});
  const denied = await env.call("POST", "/api/admin/login/verify", {
    loginId: again.data.loginId,
    response: await ana.authenticator.get(again.data.options),
  });
  assert.equal(denied.status, 403);
});

Deno.test("the last admin can't be revoked", async () => {
  const env = await makeEnv();
  const ana = await bootstrapAdmin(env);
  const res = await env.call("POST", `/api/admin/admins/${ana.admin.id}/revoke`, {}, { cookie: ana.cookie });
  assert.equal(res.data.error, "last_admin");
});

Deno.test("revoking an admin kills the links they created", async () => {
  const env = await makeEnv();
  const ana = await bootstrapAdmin(env);
  const ben = await addAdmin(env, ana.cookie, "ben@example.com");
  const created = await env.call("POST", "/api/admin/admin-invites", { email: "dan@example.com" }, { cookie: ben.cookie });
  await env.call("POST", `/api/admin/admins/${ben.admin.id}/revoke`, {}, { cookie: ana.cookie });
  const preview = await env.call("POST", "/api/admin-invites/preview", { invite: inviteRef(created.data.link) });
  assert.equal(preview.data.error, "invite_revoked");
});

Deno.test("admin actions from another site are refused (CSRF)", async () => {
  const env = await makeEnv();
  const ana = await bootstrapAdmin(env);
  const res = await env.call("POST", "/api/admin/user-tokens", { email: "ben@example.com" }, {
    cookie: ana.cookie,
    origin: "https://evil.example",
  });
  assert.equal(res.status, 403);
  assert.equal(res.data.error, "bad_origin");
});

Deno.test("a passkey made for another site is rejected", async () => {
  const env = await makeEnv();
  const invite = await createHostAdminInvite(env.db, env.config, "ana@example.com");
  const ref = inviteRef(invite.link);
  const options = await env.call("POST", "/api/admin-invites/registration-options", { invite: ref });
  const { SoftAuthenticator } = await import("./soft-authenticator.ts");
  const phished = await new SoftAuthenticator("https://evil.example", "evil.example").create(options.data);
  const res = await env.call("POST", "/api/admin-invites/redeem", { invite: ref, response: phished });
  assert.equal(res.status, 400);
  assert.equal(res.data.error, "passkey_invalid");
  // The link survives a failed attempt, so the real admin can still use it.
  assert.equal((await env.call("POST", "/api/admin-invites/preview", { invite: ref })).status, 200);
});

Deno.test("pages send strict security headers", async () => {
  const env = await makeEnv();
  const res = await env.call("GET", "/admin/join");
  assert.match(res.headers.get("content-security-policy")!, /script-src 'self'/);
  assert.equal(res.headers.get("referrer-policy"), "no-referrer");
});
