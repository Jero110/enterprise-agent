# Spec: Team identity

**Module:** `team-identity` · **Map:** [TEAM-PILOT-MAP.md](TEAM-PILOT-MAP.md)

## Objective

Give an enterprise pilot a verified Google identity and a server-controlled membership allowlist. `jeronimo.deli@gmail.com` is the initial administrator and authorized member, displayed as **Jero**. A second independently running Dev IDE may use a clearly labeled anonymous _test_ identity, displayed as **Gerry**, without repeated Google login; this is never a production login. Each instance's sign-in/out remains independent, and both can be open simultaneously. Signing out changes the visible user and immediately removes the former user's privileged reads.

## Tech Stack

Existing TypeScript/Electron/web UI, server-side Effect services and SQLite persistence, existing Clerk/Google sign-in integrations where compatible. Reuse the repository's configured identity provider only if its token can be verified by this application's server; otherwise implement a dedicated Google OAuth/OIDC integration with verified ID tokens, using developer-supplied credentials in ignored local configuration. Never trust an email posted by the browser. Do not use T3 Connect relay identity as environment authorization.

## Commands

From `enterprise-ide/`: `pnpm dev:desktop`; focused tests: `pnpm exec vp test run <changed-test-file>`; suite: `pnpm test`; typecheck: `pnpm typecheck`; lint: `pnpm lint`. Configure OAuth credentials in ignored local env; do not put credentials or live tokens in test fixtures or documentation.

## Project Structure

`apps/web/src/components/onboarding/` and `apps/web/src/components/clerk/`: login and switch/logout UI; `apps/server/src/auth/`: verified identity and membership enforcement; `packages/contracts/src/`: interoperable auth contracts when needed; adjacent `*.test.ts`/`*.browser.test.tsx`: behavior tests. New files belong near related existing code, not a second auth system silently bypassing existing server sessions.

## Code Style

Follow current typed contracts and explicit names, for example:

```ts
function canEnterTeam(identity: VerifiedIdentity, allowedEmails: ReadonlySet<string>): boolean {
  return allowedEmails.has(identity.email.toLowerCase());
}
```

`VerifiedIdentity` must originate from a server-verified provider token, never a client field.

## Testing Strategy

Write failing tests first: unverified/unknown email denied, case-normalized allowlisted email accepted, admin-only allowlist mutation, logout revokes former user's reads, development anonymous identity receives only development membership, production rejects it even if a client claims development mode. Browser test switching identities; server integration test direct unauthorized calls. No dependence on real Google in deterministic tests; use a fake token verifier, with a separate manual Google smoke test when credentials are configured.

## Boundaries

- Always: server-verify Google subject and verified email; enforce membership on every request; keep secrets out of git and logs; leave current standalone T3 login usable when not enrolled.
- Ask first: switching identity provider or introducing a third-party hosted organization backend; executor reports BLOCKED if user action is required rather than bypassing verification.
- Never: grant access from a client-submitted email, enable anonymous identity in production, persist OAuth secrets in source, expose an admin session through development tokens.

## Success Criteria

- `jeronimo.deli@gmail.com` signs in with Google and is admin; a different unauthorized verified Google email is denied pending admin authorization.
- Admin can authorize an email; a non-admin cannot, including through direct API calls.
- The Jero Dev IDE can be Google-authenticated while a second independent Dev IDE named Gerry uses the anonymous test identity; production refuses anonymous identity; login/logout switching updates effective permissions without stale content.
- A missing OAuth configuration displays an actionable setup message, never a silent mock login.

## Open Questions

- Technical investigation during planning: whether the current Clerk configuration exposes a server-verifiable Google identity independent of T3 Connect; choose the smallest compatible provider path, not a client-only shortcut.
