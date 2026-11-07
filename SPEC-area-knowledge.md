# Spec: Area knowledge and approval

**Module:** `area-knowledge` · **Map:** [TEAM-PILOT-MAP.md](TEAM-PILOT-MAP.md) · **Depends on:** [identity](SPEC-team-identity.md), [enrollment](SPEC-team-enrollment.md)

## Objective

Seed three harmless Markdown documents: `general.md` available to both pilot identities, `auth.md` only to verified `jeronimo.deli@gmail.com` (Auth area), and `no-mail.md` only to the Dev anonymous test identity (No Mail area). Admin assigns memberships and can approve or deny requests for additional areas. Asking alone changes no permissions. Server filters both lists and direct reads using the same policy. Documents represent company context, not teammates' conversation history or arbitrary host files.

## Tech Stack

Existing TypeScript backend, contracts, SQLite and frontend state. Markdown is seeded content under version control; durable team membership/requests stored under server-managed pilot data. No search index, hosted storage, or document upload is required.

## Commands

From `enterprise-ide/`: `pnpm dev:desktop`; focused: `pnpm exec vp test run <changed-test-file>`; complete: `pnpm test && pnpm typecheck && pnpm lint`.

## Project Structure

Put Markdown fixtures in a narrowly scoped new knowledge folder, not user filesystem paths. Put authorization, request/approval handlers and tests in server domain code near auth; wire schemas in `packages/contracts/src/`; any list UI in `apps/web/src/components/`.

## Code Style

The policy takes a server-derived principal, not an email supplied by the caller:

```ts
function canReadDocument(principal: TeamPrincipal, area: AreaId): boolean {
  return area === "general" || principal.areaIds.includes(area);
}
```

## Testing Strategy

Red-green-refactor for list filtering and _direct document read_ (including forged ids), anonymous Dev isolation, unauthorized email, pending/denied/approved area requests, admin-only approval, revocation and logout. Test two independently running local instances if the team issuer supports it; no browser-only permission tests in place of server tests.

## Boundaries

- Always: enforce per-document read policy server-side on every request, including agent tools; use innocuous fixture text.
- Ask first: adding arbitrary Markdown upload or deriving privileges from repository paths.
- Never: return unauthorized document body or metadata, expose host files through company knowledge, grant an area on request without admin approval.

## Success Criteria

- Jeronimo sees general + auth but cannot read no-mail, even by guessed id or direct API call.
- Dev anonymous sees general + no-mail but cannot read auth by any path; production never grants anonymous access.
- A new area request is pending until the admin explicitly approves; rejection and revocation remove access.
- Three Markdown fixtures and their audience are easy to inspect in the UI and in tests.

## Open Questions

- Technical planning chooses local persistence and issuer integration without confusing a server-local area assignment with a company-wide synchronized assignment.
