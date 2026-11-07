// Run on the server host. Prints a one-time admin link: for the first admin, or with
// --break-glass when every admin is locked out. Having the host is the root of trust.
//
//   deno task admin-link --email ana@example.com
//   deno task admin-link --email ana@example.com --break-glass

import { loadEnvConfig } from "../src/config.ts";
import { openDb } from "../src/db.ts";
import { AppError } from "../src/errors.ts";
import { createHostAdminInvite } from "../src/services/admins.ts";

const args = Deno.args;
const emailIndex = args.indexOf("--email");
const email = emailIndex >= 0 ? args[emailIndex + 1] : undefined;
const breakGlass = args.includes("--break-glass");

if (!email) {
  console.error("Usage: deno task admin-link --email <person@company> [--break-glass]");
  Deno.exit(1);
}

const { config, dbPath } = await loadEnvConfig();
const db = openDb(dbPath);
try {
  const invite = await createHostAdminInvite(db, config, email, { breakGlass });
  console.log(`\nOne-time admin link for ${email.toLowerCase()}`);
  console.log(`Works once. Expires ${new Date(invite.expiresAt!).toLocaleString()}.\n`);
  console.log(invite.link);
  console.log(
    "\nSend it to them privately. Opening it changes nothing until they click Confirm and create a passkey.",
  );
  if (breakGlass) console.log("This was logged as an emergency link, and existing admins will be told.");
} catch (err) {
  if (err instanceof AppError) {
    console.error(err.message);
    Deno.exit(1);
  }
  throw err;
} finally {
  db.close();
}
