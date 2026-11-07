import type { Config } from "./config.ts";
import type { DB } from "./db.ts";
import { AppError } from "./errors.ts";
import {
  bearer,
  clearSessionCookie,
  errorJson,
  getCookie,
  json,
  readJson,
  SESSION_COOKIE,
  sessionCookie,
  withSecurityHeaders,
} from "./http.ts";
import type { AuthenticationResponse, RegistrationResponse } from "./passkeys.ts";
import { RateLimiter } from "./ratelimit.ts";
import * as admins from "./services/admins.ts";
import { adminOverview } from "./services/overview.ts";
import * as users from "./services/users.ts";

export interface ConnInfo {
  remoteAddr?: { hostname?: string };
}

export type Handler = (req: Request, info?: ConnInfo) => Promise<Response>;

interface Ctx {
  req: Request;
  params: Record<string, string>;
  ip: string;
}

type Route = { method: string; pattern: URLPattern; handle: (ctx: Ctx) => Promise<Response> | Response };

const STATIC_TYPES: Record<string, string> = {
  "style.css": "text/css; charset=utf-8",
  "common.js": "text/javascript; charset=utf-8",
  "webauthn.js": "text/javascript; charset=utf-8",
  "admin.js": "text/javascript; charset=utf-8",
  "admin-join.js": "text/javascript; charset=utf-8",
  "join.js": "text/javascript; charset=utf-8",
};
const PAGES: Record<string, string> = {
  "/join": "join.html",
  "/admin": "admin.html",
  "/admin/join": "admin-join.html",
};

async function loadStatic(): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  for (const name of [...Object.keys(STATIC_TYPES), ...Object.values(PAGES)]) {
    files.set(name, await Deno.readTextFile(new URL(`../static/${name}`, import.meta.url)));
  }
  return files;
}

export async function createApp({ db, config }: { db: DB; config: Config }): Promise<Handler> {
  const files = await loadStatic();
  const MIN = 60_000;
  const limits = {
    enrollPerIp: new RateLimiter(20, 10 * MIN, config.now), // joining takes 2 calls: start, then enroll
    enrollGlobal: new RateLimiter(300, 10 * MIN, config.now),
    device: new RateLimiter(60, MIN, config.now),
    invite: new RateLimiter(20, 10 * MIN, config.now),
    login: new RateLimiter(30, 10 * MIN, config.now),
  };
  const limit = (limiter: RateLimiter, key: string) => {
    if (!limiter.take(key)) throw new AppError(429, "rate_limited", "Too many attempts. Wait a few minutes and try again.");
  };

  // Browsers always send Origin on POST. Admin actions only count when they come from our own pages.
  const sameOrigin = (ctx: Ctx) => {
    if (ctx.req.headers.get("origin") !== config.origin) {
      throw new AppError(403, "bad_origin", "This request must come from the admin console.");
    }
  };
  const adminOf = (ctx: Ctx) => admins.adminFromSession(db, config, getCookie(ctx.req, SESSION_COOKIE));
  const adminAction = async (ctx: Ctx) => {
    sameOrigin(ctx);
    return await adminOf(ctx);
  };
  const deviceOf = (ctx: Ctx) => users.authenticateDevice(db, config, bearer(ctx.req));

  const routes: Route[] = [];
  const route = (method: string, pathname: string, handle: Route["handle"]) =>
    routes.push({ method, pattern: new URLPattern({ pathname }), handle });

  // Individual: personal token + passkey → enrolled device → signed challenges → short access tokens.
  route("POST", "/api/enroll/start", async (ctx) => {
    limit(limits.enrollPerIp, ctx.ip);
    limit(limits.enrollGlobal, "global");
    return json(await users.startEnrollment(db, config, await readJson(ctx.req), ctx.ip));
  });
  route("POST", "/api/enroll", async (ctx) => {
    limit(limits.enrollPerIp, ctx.ip);
    limit(limits.enrollGlobal, "global");
    return json(await users.enrollDevice(db, config, await readJson(ctx.req), ctx.ip), 201);
  });
  route("POST", "/api/device/challenge", async (ctx) => {
    limit(limits.device, ctx.ip);
    const body = await readJson(ctx.req);
    return json(users.createDeviceChallenge(db, config, body.deviceId));
  });
  route("POST", "/api/device/token", async (ctx) => {
    limit(limits.device, ctx.ip);
    return json(await users.exchangeDeviceProof(db, config, await readJson(ctx.req), ctx.ip));
  });
  route("GET", "/api/me", async (ctx) => json(users.getMe(db, config, await deviceOf(ctx))));
  route("POST", "/api/me/transfer-code", async (ctx) => {
    const auth = await deviceOf(ctx);
    return json(await users.createTransferCode(db, config, auth, ctx.ip), 201);
  });
  route("POST", "/api/me/devices/:id/remove", async (ctx) => {
    const auth = await deviceOf(ctx);
    return json(users.removeOwnDevice(db, config, auth, ctx.params.id, ctx.ip));
  });

  // Administrator: one-time link → passkey → session.
  route("POST", "/api/admin-invites/preview", async (ctx) => {
    sameOrigin(ctx);
    limit(limits.invite, ctx.ip);
    return json(await admins.previewInvite(db, config, (await readJson(ctx.req)).invite));
  });
  route("POST", "/api/admin-invites/registration-options", async (ctx) => {
    sameOrigin(ctx);
    limit(limits.invite, ctx.ip);
    return json(await admins.startInviteRegistration(db, config, (await readJson(ctx.req)).invite));
  });
  route("POST", "/api/admin-invites/redeem", async (ctx) => {
    sameOrigin(ctx);
    limit(limits.invite, ctx.ip);
    const body = await readJson(ctx.req);
    const { admin, sessionToken } = await admins.redeemInvite(
      db,
      config,
      body.invite,
      body.response as RegistrationResponse,
      ctx.ip,
    );
    return json({ admin }, 201, { "set-cookie": sessionCookie(config, sessionToken) });
  });
  route("POST", "/api/admin/login/options", async (ctx) => {
    sameOrigin(ctx);
    limit(limits.login, ctx.ip);
    return json(await admins.startLogin(db, config));
  });
  route("POST", "/api/admin/login/verify", async (ctx) => {
    sameOrigin(ctx);
    limit(limits.login, ctx.ip);
    const body = await readJson(ctx.req);
    const { admin, sessionToken } = await admins.finishLogin(
      db,
      config,
      body.loginId,
      body.response as AuthenticationResponse,
      ctx.ip,
    );
    return json({ admin }, 200, { "set-cookie": sessionCookie(config, sessionToken) });
  });
  route("POST", "/api/admin/logout", async (ctx) => {
    sameOrigin(ctx);
    await admins.endSession(db, getCookie(ctx.req, SESSION_COOKIE));
    return json({ ok: true }, 200, { "set-cookie": clearSessionCookie() });
  });
  route("GET", "/api/admin/overview", async (ctx) => json(adminOverview(db, config, await adminOf(ctx))));
  route("POST", "/api/admin/user-tokens", async (ctx) => {
    const admin = await adminAction(ctx);
    const body = await readJson(ctx.req);
    return json(await users.issueUserToken(db, config, admin, body.email, body.areas, ctx.ip), 201);
  });
  route("POST", "/api/admin/users/:id/deactivate", async (ctx) => {
    users.deactivateUser(db, config, await adminAction(ctx), ctx.params.id, ctx.ip);
    return json({ ok: true });
  });
  route("POST", "/api/admin/users/:id/reactivate", async (ctx) => {
    users.reactivateUser(db, config, await adminAction(ctx), ctx.params.id, ctx.ip);
    return json({ ok: true });
  });
  route("POST", "/api/admin/devices/:id/revoke", async (ctx) => {
    users.revokeDeviceByAdmin(db, config, await adminAction(ctx), ctx.params.id, ctx.ip);
    return json({ ok: true });
  });
  route("POST", "/api/admin/admin-invites", async (ctx) => {
    const admin = await adminAction(ctx);
    const body = await readJson(ctx.req);
    return json(await admins.createAdminInvite(db, config, admin, body.email, ctx.ip), 201);
  });
  route("POST", "/api/admin/admin-invites/:id/approve", async (ctx) => {
    return json(admins.approveAdminInvite(db, config, await adminAction(ctx), ctx.params.id, ctx.ip));
  });
  route("POST", "/api/admin/admin-invites/:id/revoke", async (ctx) => {
    admins.revokeAdminInvite(db, config, await adminAction(ctx), ctx.params.id, ctx.ip);
    return json({ ok: true });
  });
  route("POST", "/api/admin/admins/:id/revoke", async (ctx) => {
    admins.revokeAdmin(db, config, await adminAction(ctx), ctx.params.id, ctx.ip);
    return json({ ok: true });
  });

  const page = (name: string) =>
    new Response(files.get(name), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });

  return async (req, info) => {
    const url = new URL(req.url);
    const ctx: Ctx = { req, params: {}, ip: info?.remoteAddr?.hostname ?? "unknown" };
    try {
      if (req.method === "GET") {
        if (url.pathname === "/") return withSecurityHeaders(new Response(null, { status: 302, headers: { location: "/join" } }));
        const pageFile = PAGES[url.pathname];
        if (pageFile) return withSecurityHeaders(page(pageFile));
        if (url.pathname.startsWith("/static/")) {
          const name = url.pathname.slice("/static/".length);
          const type = STATIC_TYPES[name]; // fixed list: no path traversal possible
          if (type) {
            return withSecurityHeaders(
              new Response(files.get(name), { headers: { "content-type": type, "cache-control": "no-cache" } }),
            );
          }
        }
      }
      for (const r of routes) {
        const match = r.pattern.exec({ pathname: url.pathname });
        if (!match) continue;
        if (r.method !== req.method) continue;
        ctx.params = match.pathname.groups as Record<string, string>;
        return withSecurityHeaders(await r.handle(ctx));
      }
      return withSecurityHeaders(json({ error: "not_found", message: "Not found." }, 404));
    } catch (err) {
      if (err instanceof AppError) return withSecurityHeaders(errorJson(err));
      console.error(err);
      return withSecurityHeaders(json({ error: "internal", message: "Something went wrong." }, 500));
    }
  };
}
