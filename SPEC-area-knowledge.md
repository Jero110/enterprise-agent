# Spec: Area knowledge and approval

**Module:** `area-knowledge` · **Map:** [TEAM-PILOT-MAP.md](TEAM-PILOT-MAP.md) · **Depends on:** [identity](SPEC-team-identity.md), [enrollment](SPEC-team-enrollment.md)

## Objective

Seed three harmless Markdown documents: `general.md` available to both pilot identities, `auth.md` only to verified `jeronimo.deli@gmail.com` (Auth area), and `no-mail.md` only to the Dev anonymous test identity (No Mail area). Admin assigns memberships; an area's lead or an admin can approve or deny requests for that area. Asking alone changes no permissions. Server filters document lists, content search and direct reads using the same read policy. The graph alone exposes safe node previews to enrolled members, including nodes in areas they cannot read. Documents represent company context, not teammates' conversation history or arbitrary host files.

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

- Always: enforce per-document read policy server-side on every request, including agent tools, document lists, content search and guessed-path direct reads; use innocuous fixture text.
- Graph-only exception: enrolled members may receive node IDs, titles, descriptions, area, layer, private/accessibility flags and links as safe previews across areas. Preview fields must be suitable for every enrolled member; sensitive facts belong in gated bodies. This exception does not authorize direct reads, document lists, content search or snippets from inaccessible bodies.
- Ask first: adding arbitrary Markdown upload or deriving privileges from repository paths.
- Never: return an unauthorized document body on any surface, return unauthorized metadata outside the graph-preview exception, expose host files through company knowledge, or grant an area merely because it was requested. A lead for that area or an admin must approve.

## Success Criteria

- Jeronimo can read general + auth but cannot read the no-mail body, even by guessed id or direct API call. Graph previews do not change that boundary.
- Dev anonymous can read general + no-mail but cannot read the auth body by any path; production never grants anonymous access or graph-preview privileges.
- Enrolled members can find a locked area's node by its safe graph title and request access without receiving its body. Document lists, content search and direct reads remain gated.
- A new area request is pending until that area's lead or an admin explicitly approves. Approval makes the body readable without a client reload; rejection leaves access unchanged, and revocation removes body access while preserving safe graph previews.
- Three Markdown fixtures and their audience are easy to inspect in the UI and in tests.

## Open Questions

- Technical planning chooses local persistence and issuer integration without confusing a server-local area assignment with a company-wide synchronized assignment.
