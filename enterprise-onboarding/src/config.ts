import { fileURLToPath } from "node:url";

export interface Area {
  id: string;
  name: string;
  /** Restricted areas need an area admin's approval at session start (handled by the Context Service). */
  restricted: boolean;
}

export interface Person {
  email: string;
  name: string;
}

export interface Config {
  /** Where people open the service, e.g. http://localhost:8787. Passkeys and CSRF checks are bound to it. */
  origin: string;
  rpId: string;
  rpName: string;
  people: Person[];
  areas: Area[];
  userTokenTtlMs: number;
  userTokenMaxEnrollments: number;
  maxDevicesPerUser: number;
  transferCodeTtlMs: number;
  adminInviteTtlMs: number;
  adminSessionTtlMs: number;
  accessTokenTtlMs: number;
  challengeTtlMs: number;
  now: () => number;
}

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

export function makeConfig(
  base: Pick<Config, "origin" | "people" | "areas"> & Partial<Config>,
): Config {
  if (!base.areas.some((a) => a.id === "general")) {
    throw new Error('areas must include "general": everyone gets it');
  }
  return {
    rpId: new URL(base.origin).hostname,
    rpName: "Enterprise Agent",
    userTokenTtlMs: 30 * DAY,
    userTokenMaxEnrollments: 2,
    maxDevicesPerUser: 2,
    transferCodeTtlMs: 15 * MINUTE,
    adminInviteTtlMs: 60 * MINUTE,
    adminSessionTtlMs: 60 * MINUTE,
    accessTokenTtlMs: 15 * MINUTE,
    challengeTtlMs: 2 * MINUTE,
    now: () => Date.now(),
    ...base,
  };
}

const projectRoot = new URL("../", import.meta.url);

/** Reads settings from EA_* environment variables, falling back to the files in data/. */
export async function loadEnvConfig(): Promise<{ config: Config; port: number; host: string; dbPath: string }> {
  const env = (name: string) => Deno.env.get(name);
  const port = Number(env("EA_PORT") ?? 8787);
  const host = env("EA_HOST") ?? "127.0.0.1";
  const origin = env("EA_ORIGIN") ?? `http://localhost:${port}`;
  const people = JSON.parse(
    await Deno.readTextFile(env("EA_PEOPLE") ?? new URL("data/people.json", projectRoot)),
  ) as Person[];
  const areas = JSON.parse(
    await Deno.readTextFile(env("EA_AREAS") ?? new URL("data/areas.json", projectRoot)),
  ) as Area[];
  const dbPath = env("EA_DB") ?? fileURLToPath(new URL("data/onboarding.db", projectRoot));
  const tokenDays = env("EA_USER_TOKEN_DAYS");
  const config = makeConfig({
    origin,
    people,
    areas,
    ...(tokenDays ? { userTokenTtlMs: Number(tokenDays) * DAY } : {}),
  });
  return { config, port, host, dbPath };
}
