import type { Config } from "./config.ts";
import { AppError } from "./errors.ts";

export const SESSION_COOKIE = "ea_admin";

const SECURITY_HEADERS: Record<string, string> = {
  "content-security-policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
};

export function withSecurityHeaders(res: Response): Response {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.headers.set(k, v);
  return res;
}

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

export function errorJson(err: AppError): Response {
  return json({ error: err.code, message: err.message }, err.status);
}

const MAX_BODY = 64 * 1024;

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  if (!req.headers.get("content-type")?.includes("application/json")) {
    throw new AppError(415, "json_required", "Send a JSON body.");
  }
  const raw = await req.text();
  if (raw.length > MAX_BODY) throw new AppError(413, "body_too_large", "Request body is too large.");
  try {
    const body = JSON.parse(raw || "{}");
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return body;
  } catch {
    throw new AppError(400, "invalid_json", "The request body isn't valid JSON.");
  }
}

export function getCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return undefined;
}

export function bearer(req: Request): string | undefined {
  const value = req.headers.get("authorization");
  return value?.startsWith("Bearer ") ? value.slice(7).trim() : undefined;
}

// HttpOnly: page scripts can't read it. SameSite=Strict: other sites can't ride on it.
export function sessionCookie(config: Config, token: string): string {
  const secure = config.origin.startsWith("https:") ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${
    Math.floor(config.adminSessionTtlMs / 1000)
  }${secure}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
}
