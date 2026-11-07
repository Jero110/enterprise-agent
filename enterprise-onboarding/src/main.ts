import { createApp } from "./app.ts";
import { loadEnvConfig } from "./config.ts";
import { openDb } from "./db.ts";

const { config, port, host, dbPath } = await loadEnvConfig();
const db = openDb(dbPath);
const handler = await createApp({ db, config });

Deno.serve({
  port,
  hostname: host,
  onListen: () => {
    console.log(`Enterprise Agent onboarding at ${config.origin}`);
    console.log(`  People join at   ${config.origin}/join`);
    console.log(`  Admin console at ${config.origin}/admin`);
    console.log(`  No admins yet? Run: deno task admin-link --email <you@company>`);
  },
}, (req, info) => handler(req, info as { remoteAddr: Deno.NetAddr }));
