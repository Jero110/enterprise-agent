# Spec: Two-instance Team activity

**Module:** `team-activity` · **Map:** [TEAM-PILOT-MAP.md](TEAM-PILOT-MAP.md) · **Depends on:** [identity](SPEC-team-identity.md), [enrollment](SPEC-team-enrollment.md)

## Objective

Run two truly separate Electron Dev IDEs on one Mac: **Jero** is the Google-authenticated `jeronimo.deli@gmail.com` admin and **Gerry** is the anonymous Dev test identity. Both IDE windows visibly bear their distinct names. A **Team page** shows an organization-wide directory of members and their team assignment (Jero initially Admin team, Gerry initially No Team). Admin (Jero) can:

- Open any member’s profile and see their usage stats: conversations and tokens for today, last 7 days and all-time.
- Authorize/deauthorize emails, create/rename/delete teams, move members between teams.
- View usage of all teams; non-admin members see their own and their team’s usage.

Usage is attributed to the **team of the person who started** the conversation, regardless of which environment executes it. Everyone in the enterprise can contribute to general context; deeper interaction and area-specific context happen within teams. A collapsible **Team → Agents** section sits below Projects and shows live agents/open conversations across the enterprise grouped by person: `Jero (4 active)` would contain Jero's four running agents if four actually ran; both groups start with zero, no fake agents. Unpublished conversations expose only title, owner and status; owners may opt in by clicking **Publish to my team** on a thread, making its content readable only by current members of that team. Collapsing Team retains its header and does not hide Projects. Both may send messages/start agents in either environment **only after the owner explicitly grants revocable action permissions**. This pilot is not a change to the installed official Beta binary.

## Tech Stack

Existing Electron Dev runner, per-instance Electron userData plus per-instance T3 home/ports, environment RPC subscriptions and client runtime, server-issued scoped pairing grants. Do not reuse a SQLite file, bearer credential, Electron singleton/profile, or app protocol handler across concurrently running Dev instances. Select a safe method for dev-profile and protocol separation based on repository behavior; an installed beta must remain unchanged. Team discovery is a local-pilot authority reachable by both instances rather than a UI-only mocked list.

## Commands

From `enterprise-ide/`: `pnpm dev:desktop` with documented distinct per-instance profile/home/port settings added by this module. Focused: `pnpm exec vp test run <changed-test-file>`; complete: `pnpm test && pnpm typecheck && pnpm lint`. Manual: run both Dev IDEs simultaneously, sign into one, leave the other anonymous, join the same team, start a thread on each side and observe both sides.

## Project Structure

`apps/desktop/src/app/DesktopUserData.ts`, Electron Dev launcher and `scripts/dev-runner.ts` for isolation; `packages/client-runtime/src/` for connection subscriptions; `apps/web/src/components/` for Team section/sidebar; `apps/server/src/auth/` for grants and access enforcement; adjacent tests for each boundary.

## Code Style

Use environment-scoped, unambiguous identifiers:

```ts
type TeamActivity = {
  readonly environmentId: string;
  readonly memberId: string;
  readonly activeAgentCount: number;
};
```

## Testing Strategy

Red tests for two distinct Electron userData/home/ports and no profile collision, two independent environment IDs, both sides receiving actual live agent/open-conversation updates, offline/reconnect and clean collapse/expand. Team directory tests list all enterprise members with assignments; admin move recomputes team readership. Publication tests deny direct read of an unpublished thread, allow only the current author's team after explicit publication, and revoke on unpublish/team move; activity list returns only metadata before publication. Server integration tests reject cross-environment message/start without grant, accept with explicit grant, reject again after revocation, and ensure Dev anonymous cannot acquire an admin grant by declaring itself the admin. UI tests distinguish owner and environment, exclude nonmembers from Team, and retain independent Projects section when Team collapses.

## Boundaries

- Always: real local cross-instance activity, server-enforced publication/read rules and action grants; server execution remains on the owning environment; protect existing Dev and Beta profiles.
- Ask first: exposing pilot to external network or adding production cross-company access.
- Never: infer full-access permissions from a shared team link, share local bearer tokens, mutate Beta installation, present two browser views of one database as two independent environments.

## Success Criteria

- Two Electron Dev IDEs are open simultaneously, each with independent userData, backend DB and environment ID, and neither steals focus/terminates the other.
- Both windows are visibly named Jero and Gerry; a Team page lists all organization members with assignments, Jero=Admin and Gerry=No Team initially. The admin can put both in one team. Team → Agents below Projects shows actual live/open activity grouped by owner with accurate per-person counts (zero initially; four under Jero only when four are running). Team collapses to a header without hiding Projects.
- Unpublished thread listing exposes only title, owner and status; only a thread explicitly published to its owner's team reveals messages to that team's current members; other teams and unenrolled clients are denied by the server.
- Both can write in both environments only after explicit bilateral grants; revoked grant immediately blocks new actions even if the UI has stale state.
- Jero (Google, Admin team) sees `general.md` + `auth.md`; Gerry (anonymous Dev, No Team) sees `general.md` + `no-mail.md`. Team activity and usage stats do not change knowledge-area permissions.
- Admin sees usage of all members/teams; each member sees their own and their team’s stats (conversations today/week/all-time, tokens by period and model).

## Open Questions

- Technical investigation: Electron single-instance/profile and protocol scheme isolation and a smallest local team authority shared by both instances; implementation must not promise cross-network operation without a reachable authority.
