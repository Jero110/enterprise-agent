# Enterprise Agent onboarding

How people and admins join the enterprise:

- **Each person gets a personal token** from an admin, good for 30 days. The first time they use it, they create a passkey (fingerprint, face or PIN) that's tied to that token. Using the token again later needs that same passkey.
- **Each admin gets a one-time link**, opened in a browser, that creates a passkey (fingerprint, face or device PIN).

This is the onboarding piece of the Context Service. It's written in TypeScript on Deno, so it can later move into the Enterprise Agent repo.

## Run it

This folder is a standalone Deno service, separate from the pnpm workspace. `vp check` and the root tests skip it (see `vite.config.ts`); run everything from inside the folder:

```bash
cd enterprise-onboarding
```

You need [Deno](https://deno.com) 2.x. Nothing else: the database is the SQLite built into Deno.

```bash
deno task start
```

The server listens on `http://localhost:8787` (localhost only). Then create the first admin's link on the same machine:

```bash
deno task admin-link --email ana@example.com
```

Open the link, click **Confirm and create passkey**, and you're in the admin console at `/admin`.

People join at `/join`, which stands in for the IDE's join screen. Use Chrome or Edge: passkeys didn't work in the Claude app's built-in browser pane.

A terminal can't create passkeys, so the terminal client only joins with transfer codes:

```bash
deno task join enroll --token <transfer code> --name "Work laptop"
deno task join me
deno task join transfer
```

Run the tests with `deno task test`.

## The two flows

**Person, with a personal token**
1. An admin picks the person from the company people list (`data/people.json`) and their areas (`data/areas.json`). Everyone also gets Enterprise general.
2. The admin console shows the token once. The admin sends it privately.
3. The person pastes it on the join page.
   - **First use:** they create a passkey, and it's tied to this token.
   - **Later uses** (their second computer): they must use that same passkey, for example from their phone or a password manager. Without it, the token is refused.
4. The device makes its own key pair and sends only the public half.
5. From then on, the device signs in by signing a one-time challenge and gets a 15-minute access token. The token isn't needed again on that device.
6. Moving to a new computer: the person makes a one-use **transfer code** on a device they've already joined. No admin and no passkey needed.

**Admin, with a one-time link**
1. The first admin's link comes from the server host (`deno task admin-link`). After that, admins create links in the console.
2. Opening the link only shows who it's for. **Confirm** creates a passkey, uses up the link and signs the admin in.
3. Every admin is notified, with a one-click **Revoke**.
4. If every admin is locked out: `deno task admin-link --email ... --break-glass` on the host. It's logged and announced to the other admins.

## Rules and why

| Rule | Why |
|---|---|
| A token is for one named person on the company list, never shared | So each device can be traced to a person |
| A token lasts 30 days (`EA_USER_TOKEN_DAYS`) and works on at most 2 devices; a person has at most 2 devices | People get time to join without chasing admins |
| A token's first use creates a passkey tied to it; later uses need that exact passkey | A stolen or leaked token is useless without the person's finger, face or PIN, so the long lifetime is safe |
| Transfer codes need no passkey, but they last 15 minutes, work once, and only an already-joined device can make them | Moving to a new laptop stays easy |
| Issuing a new token cancels the person's unused one | Killing a leaked token is one click |
| The person is told every time a device joins their account | They spot a stolen token quickly |
| Tokens, links, sessions and access tokens are stored only as SHA-256 hashes | A copied database doesn't hand out access |
| The device's private key never leaves it; a JWK containing `d` is refused | Proof of identity stays on the device |
| Access tokens last 15 minutes and are rechecked on every request | Deactivating someone or removing a device takes effect at once |
| An admin link works once and expires after 60 minutes | A forwarded or old link is useless |
| The link's secret goes after `#` and is wiped from the address bar | It never reaches servers, proxies or logs |
| Opening a link changes nothing; only **Confirm** does | Email scanners and chat previews can't use it up |
| Admins sign in with a passkey that requires fingerprint, face or PIN | Passkeys can't be phished or reused on another site |
| Two-person rule: with 2+ admins, a new admin link needs a different admin's approval | One compromised admin can't create more admins |
| The last admin can't be revoked; revoking an admin cancels links they created | Nobody gets locked out, and no orphan links remain |
| Deactivating a person removes every device and cancels their tokens and passkeys | Offboarding is one click |
| Admin actions must come from the console's own address (`Origin` check), with an HttpOnly, SameSite=Strict cookie | Other sites can't trigger admin actions |
| Token redemption is rate limited (10 per 10 minutes per IP) and failed attempts are logged | Guessing is impractical, and visible |
| Strict Content Security Policy; the pages never insert text as HTML | Names and emails can't inject scripts |

## What's simplified for the hackathon

- **Delivery:** there's no email sending. The console shows the token or link once, and the admin sends it through company email or chat. Notifications live in the console and on the person's page.
- **People list:** comes from `data/people.json`, not a company directory. Offboarding is manual: an admin clicks **Deactivate**.
- **Rate limits:** kept in memory, so they assume a single server process.
- **Passkeys inside the IDE:** the Claude app's browser pane showed the Windows Hello prompt but couldn't create the passkey. The real Electron-based IDE may behave the same way. If so, its join screen should open the system browser for the passkey step.
- **Demo CLI key storage:** the demo CLI (`cli/join.ts`) keeps its private key in `.ea-device.json`. The browser join page keeps it non-extractable in IndexedDB. The real IDE should use the OS keychain.
- **Restricted areas:** stored and shown, but the approval prompt at session start belongs to the Context Service, not this service.

## Settings

| Variable | Default |
|---|---|
| `EA_PORT` | `8787` |
| `EA_HOST` | `127.0.0.1` |
| `EA_ORIGIN` | `http://localhost:<port>`. Must be the exact address people open; passkeys are bound to it. Use https outside localhost. |
| `EA_DB` | `data/onboarding.db` |
| `EA_USER_TOKEN_DAYS` | `30` |
| `EA_PEOPLE` / `EA_AREAS` | `data/people.json` / `data/areas.json` |

## Layout

- `src/services/admins.ts`: admin links, two-person rule, passkey sign-in, sessions
- `src/services/users.ts`: personal tokens, device enrollment, device sign-in, transfer codes, deactivation
- `src/app.ts`: HTTP routes, rate limits, origin checks
- `static/`: the join page, the admin link page and the admin console
- `cli/`: `admin-link` (run on the host) and `join` (terminal stand-in for the IDE)
- `tests/`: 38 tests, including a software passkey, so the real passkey verification runs
