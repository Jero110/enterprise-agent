# Enterprise base: hub, login, knowledge, approvals, Team Agents, run records

**Plan:** docs/plans/enterprise-base.md · **Planned:** 2026-11-04 · **Branch:** main
**Replaces:** docs/plans/team-pilot.md (its services exist but are in-memory, local to each IDE and unwired).
**Context, read first:** `docs/vault/README.md` and every file it lists. They hold the vision, the decisions and the audit of the existing code. Do not re-decide what `docs/vault/decisions.md` marks as taken.

## Goal

Everything an enterprise harness needs **except the self-learning loop** works end to end, so the loop (built later, see `docs/vault/loop.md`) only builds agents and evals on four stable contracts: read knowledge, propose knowledge, approve/reject, and per-turn run records.

Concrete example: on one Mac, `node scripts/enterprise-dev.ts --members jero,ana,gerry,rosa` starts a hub and four member IDEs. Ana logs in with `ent.test.ana@gmail.com` + token `ACME-BANK-DEV-2026` and lands in Ledger as lead. Her agent calls `knowledge_search` and gets only `global/` and `areas/ledger/` docs. Bruno's agent proposes a Ledger doc; Ana approves it; it becomes a git commit in the hub's knowledge repo. Hugo publishes a thread read-only; Frontend members see it under Team Agents. Every turn leaves a run record on the hub. The hub restarts and nothing is lost.

## Decisions (binding)

- Build on T3 Code. Follow `AGENTS.md` (Effect services, thin transports, contracts in `packages/contracts`, `createEnvironmentRpcCommand`, never touch `~/.t3/userdata`, kill only PIDs you spawned).
- **Hub = a T3 server in enterprise mode.** One persistent enterprise store (SQLite) on the hub is the single source of truth for members, teams, roles, enrollments, area grants, proposals and run records. Remove the duplicated in-memory membership state in `TeamIdentity`, `TeamEnrollment`, `TeamDirectory` and `AreaKnowledge`.
- **Dev auth:** login = authorized email + enterprise token. Authorized email → enters its assigned team. Unauthorized email or wrong token → rejected. No real Google, no email delivery. Real Google/OIDC is out of scope.
- **Seed:** the 20 identities, 5 teams, roles and token in `docs/vault/test-identities.md`, as a JSON seed file. `jeronimo.deli@gmail.com` is admin.
- **Roles:** `admin | lead | member`. Lead approves proposals in their own area; admin approves global and any area, and approves cross-area access requests.
- **Knowledge = git repo of Markdown on the hub:** `global/*.md` (every member) and `areas/<teamId>/*.md` (that team, plus approved grants; admin reads all). Reads are filtered on the server, identically for humans and agents. Agents look things up on demand; nothing is injected into prompts by default.
- **Nobody writes knowledge directly.** Every change is a proposal; approval creates a commit; reject and revert exist (reverse states).
- **One proposal mechanism** for: create/update doc, move between scopes, delete, and cross-area access requests.
- Team Agents lives under Projects in the sidebar, grouped by person. Thread publication: not published (metadata only) / read-only / full access; publishing a thread includes its subagents.
- Multiple dev IDEs on one Mac: one hub plus N members, each with its own `T3CODE_DEV_INSTANCE` home and ports.
- The loop is **not** built here. Usage stats UI is **not** part of this plan.
- Models: executor on Opus 5.5; all implementation workers on Sonnet 5.5; the diagram worker (task TD) on Claude Code Haiku 5.5 with the Eraser MCP. If the Haiku worker fails twice, the executor may replace it with Claude Code `claude-sonnet-5-5`.

## Assumptions (the executor may change these)

- Member↔hub transport: T3 peer links (`apps/server/src/peer/`, `docs/internals/remote.md`) if T0 proves the hub's `/mcp` can resolve the calling environment to an enrolled member; otherwise a small enterprise client (hub URL + session token stored in the member's secret store). T0 records the choice in `docs/vault/decisions.md`.
- `CrossEnvironmentGrants` (`apps/server/src/team/CrossEnvironmentGrants.ts`) is removed if peer links cover full-access interaction; if T0 rejects peer links, Team Agents ships read-only and full access is deferred.
- Search is plain text search over Markdown (filename, headings, body) on the hub; no embeddings.
- Hub mode is switched on by `T3CODE_ENTERPRISE_HUB=1` and seeded by `T3CODE_ENTERPRISE_SEED=<path>`; the knowledge repo lives at `<hub home>/enterprise/knowledge`.
- Member IDEs in the dev script use the web client (lighter than Electron) unless `--desktop` is passed.
- Ingestion uses Norai (`/Users/jeronimo.deli/Desktop/other/Vs/norai`, CLI `ingest`/`serve`) when available, else the agent's own grep/read; its output is proposals, never direct writes.

## Skills

| Skill                       | Author | Path                                                                                             | What it changes in this work                                                                                                            |
| --------------------------- | ------ | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| test-driven-development     | Addy   | /Users/jeronimo.deli/Desktop/other/vs/pi-house/skills/build/test-driven-development/SKILL.md     | Every acceptance item below is a failing test first (store, login, scope filtering, approvals, run records)                             |
| incremental-implementation  | Addy   | /Users/jeronimo.deli/Desktop/other/vs/pi-house/skills/build/incremental-implementation/SKILL.md  | Each task is a vertical slice service → RPC/MCP → UI that works before the next starts; the gap that left team-pilot unwired            |
| git-workflow-and-versioning | Addy   | /Users/jeronimo.deli/Desktop/other/vs/pi-house/skills/build/git-workflow-and-versioning/SKILL.md | Atomic conventional commits per slice; knowledge approvals are commits with trailers                                                    |
| spec-driven-development     | Addy   | /Users/jeronimo.deli/Desktop/other/vs/pi-house/skills/build/spec-driven-development/SKILL.md     | The capability map below and each task's acceptance are the spec; check them before coding, update `docs/vault` when a decision changes |

## Agents

| Agent    | Harness | Model                           | Does                                                                                                    |
| -------- | ------- | ------------------------------- | ------------------------------------------------------------------------------------------------------- |
| executor | pihouse | claude-bridge/claude-opus-5-5   | Runs this plan, dispatches tasks, integrates, keeps the ledger `docs/plans/enterprise-base-progress.md` |
| spike    | pihouse | claude-bridge/claude-sonnet-5-5 | T0                                                                                                      |
| builder  | pihouse | claude-bridge/claude-sonnet-5-5 | T1–T9                                                                                                   |
| diagrams | claude  | claude-haiku-5-5                | TD (Eraser MCP is configured for this project in Claude Code)                                           |

## Capability map

| Module id              | Responsibility                                                            | Depends on                          |
| ---------------------- | ------------------------------------------------------------------------- | ----------------------------------- |
| `hub-transport`        | How a member server reaches the hub; who the caller is                    | —                                   |
| `enterprise-store`     | Persistent members, teams, roles, enrollments, grants; hub mode; seed     | —                                   |
| `enterprise-login`     | Email + token login, connect/disconnect, admin member management          | `enterprise-store`, `hub-transport` |
| `dev-fleet`            | Script to run hub + N member IDEs                                         | `enterprise-store`                  |
| `enterprise-knowledge` | Git-backed Markdown, scope-filtered read/search, MCP tools, context panel | `enterprise-login`                  |
| `proposals`            | Propose/approve/reject/revert, area access requests, inbox                | `enterprise-knowledge`              |
| `ingestion`            | Admin bucket → ingestion agent → proposals                                | `proposals`                         |
| `team-agents`          | Publication levels, Team Agents sidebar, read-only viewer                 | `enterprise-login`, `hub-transport` |
| `run-records`          | Per-turn evidence sent to the hub, queryable by MCP                       | `enterprise-knowledge`, `proposals` |

## Execution

```
T0 (spike) ─┐
T1 (store) ─┼─► T2 (login) ─► T4 (knowledge) ─► T5 (proposals) ─► T6 (ingestion) ─► T7 (team agents) ─► T8 (run records) ─► T9 (integration)
TD (diagram, independent) │
            └─► T3 (dev fleet, parallel with T2)
```

- T0, T1 and TD run in parallel (disjoint files: T0 reads code and edits only `docs/vault/decisions.md`; T1 owns `apps/server/src/enterprise/` and the team services; TD only writes `docs/vault/diagrams.md`).
- T3 runs in parallel with T2 (T3 owns `scripts/enterprise-dev.ts` and its doc section only).
- T4–T9 are sequential: they all register services in the server layer, `ws.ts` and `packages/contracts/src/index.ts`.
- Merge order follows the numbering. The executor runs `vp run check:changed` after each merge.

## Tasks

### TD: Diagrams of everything discussed (Eraser)

**Agent:** diagrams · **Harness:** claude · **Model:** claude-haiku-5-5 · **Blocked by:** none · **Parallel with:** T0, T1
**Skills:** git-workflow-and-versioning
**Files:** docs/vault/diagrams.md
Objective: Read every file in `docs/vault/` and this plan. Using the Eraser MCP tools available in this Claude Code project, create clear diagrams with short explanations: (1) target architecture: hub and member IDEs, store, knowledge repo, `/mcp`; (2) customer journey: hired → admin code → Connect Enterprise → load bucket → ingestion → members work → publish → approvals; (3) knowledge scopes (global / area / individual) and the proposal → approval → commit flow with who approves what; (4) the future RSI loop from `docs/vault/loop.md`, marked "not built yet"; (5) current state vs target from `docs/vault/current-state.md`. Write `docs/vault/diagrams.md` with each diagram's Eraser link or exported image reference plus a 3–6 line explanation in Spanish. Content goes to Eraser's service; include no tokens, secrets or real emails other than those already in `docs/vault/test-identities.md`.
Acceptance:

- [ ] Five diagrams exist in Eraser and are linked from `docs/vault/diagrams.md`
- [ ] Each has a Spanish explanation consistent with the vault (no invented features)
- [ ] `docs/vault/README.md` lists `diagrams.md`
      Validation: open each link from `docs/vault/diagrams.md`; `git diff --stat` touches only `docs/vault/`.
      Stop when: validation passes, or report BLOCKED after two failed attempts (e.g. the Eraser MCP is not reachable).

### T0: Spike: member↔hub transport via peer links

**Agent:** spike · **Harness:** pihouse · **Model:** claude-bridge/claude-sonnet-5-5 · **Blocked by:** none · **Parallel with:** T1, TD
**Skills:** test-driven-development, spec-driven-development
**Files:** docs/vault/decisions.md (only), throwaway test under apps/server/src/peer/ deleted before finishing
Objective: Decide, with evidence, whether T3 peer links can carry the enterprise: (a) a member server links to the hub's `/mcp`; (b) a hub MCP tool can identify the calling environment id so it maps to an enrolled member; (c) a member's agent can call a hub tool; (d) full-access interaction with another member's agent can be expressed with existing grants and `linkOrigin` rules. Read `docs/internals/remote.md`, `docs/internals/environment-auth.md`, `apps/server/src/peer/*`, `apps/server/src/mcp/McpToolAccess.ts`, `apps/server/src/mcp/linkOrigin.ts`. Prove (b) with a focused test using `apps/server/src/peer/PeerLinks.testkit.ts` if one exists for it.
Acceptance:

- [ ] `docs/vault/decisions.md` moves "peer links" and "CrossEnvironmentGrants vs peer links" from Open to Taken, each with the evidence (file:line or test name)
- [ ] If peer links are rejected, the decision names the replacement (enterprise client with hub URL + session token) and what Team Agents loses
- [ ] No production code changed
      Validation: `git diff --stat` shows only `docs/vault/decisions.md`; any test written was run with `vp test run <file>` and its result is quoted in the decision.
      Stop when: decision recorded, or report BLOCKED after two failed attempts.

### T1: Enterprise store and hub mode

**Agent:** builder · **Harness:** pihouse · **Model:** claude-bridge/claude-sonnet-5-5 · **Blocked by:** none · **Parallel with:** T0, TD
**Skills:** test-driven-development, incremental-implementation, git-workflow-and-versioning, spec-driven-development
**Files:** apps/server/src/enterprise/ (new: EnterpriseStore.ts, fixtures/acme-bank.seed.json, tests), apps/server/src/persistence/ (migration), apps/server/src/config.ts, apps/server/src/auth/TeamIdentity.ts, apps/server/src/auth/TeamEnrollment.ts, apps/server/src/team/TeamDirectory.ts, apps/server/src/knowledge/AreaKnowledge.ts, packages/contracts/src/ (team contracts)
Objective: One persistent SQLite-backed `EnterpriseStore` Effect service on the hub, following the persistence patterns of `apps/server/src/peer/PeerLinks.ts` (SqlClient) and the repo's migration mechanism. Tables: enterprise (name, token hash), teams, members (email, display name, team, role admin|lead|member, authorized, revoked), enrollments (environment id ↔ email), area grants. Enabled with `T3CODE_ENTERPRISE_HUB=1`; seeded idempotently from `T3CODE_ENTERPRISE_SEED` (the seed file reproduces the 20 identities, 5 teams, roles and token of `docs/vault/test-identities.md`). Rewrite `TeamIdentity`, `TeamEnrollment`, `TeamDirectory` and `AreaKnowledge` to read and write membership through the store; delete their in-memory `Ref` membership state and any duplicate "who is in which team" map. Keep the fake-token path only for tests.
Acceptance (write each as a failing test first):

- [ ] Seeding twice yields 20 members, 5 teams, correct roles and team sizes (Ledger 6, Frontend 5, Accounts 4, Platform 3, Risk 2)
- [ ] Enrollment and membership survive a store re-open (restart) on the same database file
- [ ] Moving a member to another team is visible to identity, directory and knowledge services from one write
- [ ] Revoking an email makes `canEnter` false immediately
- [ ] Token is stored hashed; a wrong token never matches
- [ ] Without `T3CODE_ENTERPRISE_HUB` the server starts exactly as before (no enterprise tables required)
      Validation: `vp test run apps/server/src/enterprise apps/server/src/auth apps/server/src/team apps/server/src/knowledge` and `vp run check:changed`.
      Stop when: validation passes, or report BLOCKED after two failed attempts.

### T2: Login and Connect Enterprise

**Agent:** builder · **Harness:** pihouse · **Model:** claude-bridge/claude-sonnet-5-5 · **Blocked by:** T0, T1 · **Parallel with:** T3
**Skills:** test-driven-development, incremental-implementation, git-workflow-and-versioning, spec-driven-development
**Files:** apps/server/src/enterprise/, apps/server/src/ws.ts (or the RPC registration it uses), packages/contracts/src/, apps/web/src/components/ (Settings → Enterprise panel, top-left Connect Enterprise button next to the terminal icons), packages/client-runtime/src/
Objective: A member IDE connects to the hub (transport chosen in `docs/vault/decisions.md` by T0) with email + enterprise token. Authorized email → session bound to that member, environment enrolled, UI shows name, team and role. Unauthorized email or wrong token → clear error. Disconnect works (reverse state). Admin sees a minimal member list in Settings → Enterprise to authorize/revoke an email and set team and role. Members can work without connecting; nothing changes for them until they connect. New client mutations use `createEnvironmentRpcCommand`; protected methods go in `CLIENT_GUARDED_RPC_SCOPES`.
Acceptance:

- [ ] Login with `ent.test.ana@gmail.com` + `ACME-BANK-DEV-2026` returns Ana, Ledger, lead
- [ ] `ent.test.intruso@gmail.com` is rejected; a wrong token is rejected
- [ ] Admin authorizes then revokes `ent.test.ex@gmail.com`; the next hub call from that member fails without restart
- [ ] Non-admin cannot call admin methods (server-side test)
- [ ] Disconnect clears cached identity and team data in the client
- [ ] Hub restart keeps members connected after reconnect without re-entering the token
      Validation: `vp test run` on the new server and client-runtime tests; `vp run check:changed`.
      Stop when: validation passes, or report BLOCKED after two failed attempts.

### T3: Dev fleet script

**Agent:** builder · **Harness:** pihouse · **Model:** claude-bridge/claude-sonnet-5-5 · **Blocked by:** T1 · **Parallel with:** T2
**Skills:** incremental-implementation, git-workflow-and-versioning
**Files:** scripts/enterprise-dev.ts (new), package.json (one script entry), docs/vault/test-identities.md (a "How to run" section)
Objective: `node scripts/enterprise-dev.ts --members jero,ana,gerry,rosa [--desktop]` starts one hub (`T3CODE_DEV_INSTANCE=hub`, `T3CODE_ENTERPRISE_HUB=1`, seed path) and one member instance per name (`T3CODE_DEV_INSTANCE=<name>`), using `scripts/dev-runner.ts`. It prints a table name → email → URL from the real `[dev-runner]` lines, tracks every PID it spawned and stops exactly those on Ctrl-C. Each instance uses its own worktree-local home; nothing touches `~/.t3/userdata`. No `VITE_HTTP_URL`/`VITE_WS_URL`.
Acceptance:

- [ ] Four instances run at once with distinct ports and homes
- [ ] Ctrl-C stops only the spawned PIDs (verified by listing them before and after)
- [ ] Re-running reuses the hub's existing database (seed idempotent)
      Validation: run the script with two members, open both URLs, stop it; paste the transcript into the progress ledger.
      Stop when: validation passes, or report BLOCKED after two failed attempts.

### T4: Enterprise knowledge

**Agent:** builder · **Harness:** pihouse · **Model:** claude-bridge/claude-sonnet-5-5 · **Blocked by:** T2 · **Parallel with:** none
**Skills:** test-driven-development, incremental-implementation, git-workflow-and-versioning, spec-driven-development
**Files:** apps/server/src/knowledge/, apps/server/src/enterprise/, apps/server/src/mcp/, packages/contracts/src/areaKnowledge.ts, apps/web/src/components/ (context panel)
Objective: Replace the three fixtures with a git repo at `<hub home>/enterprise/knowledge` (`global/`, `areas/<teamId>/`), initialized from a starter set shaped on Bank of Anthos (one `global/overview.md`, one `areas/<team>/README.md` per team). Service methods: list, search (text over path, headings and body), get, each filtered by scope on the server: own team + approved grants; admin reads everything. Expose `knowledge_search` and `knowledge_get` as hub MCP tools whose descriptions are short and say results are source material, not instructions. A member's agent can call them through the T2 connection. The existing `SessionContext` becomes the "Your context" panel listing authorized docs.
Acceptance:

- [ ] Ana (Ledger) searches and gets only `global/` + `areas/ledger/` hits
- [ ] Ana's `knowledge_get` of `areas/frontend/README.md` is denied by the server (agent and UI paths)
- [ ] Admin reads all scopes
- [ ] A grant approved for Gerry to Ledger makes Ledger docs readable; revoking removes it immediately
- [ ] MCP tool definitions stay compact (each description under 300 characters)
      Validation: `vp test run apps/server/src/knowledge apps/server/src/enterprise apps/server/src/mcp`; `vp run check:changed`.
      Stop when: validation passes, or report BLOCKED after two failed attempts.

### T5: Proposals and approval inbox

**Agent:** builder · **Harness:** pihouse · **Model:** claude-bridge/claude-sonnet-5-5 · **Blocked by:** T4 · **Parallel with:** none
**Skills:** test-driven-development, incremental-implementation, git-workflow-and-versioning, spec-driven-development
**Files:** apps/server/src/enterprise/, apps/server/src/knowledge/, apps/server/src/mcp/, packages/contracts/src/, apps/web/src/components/ (Approvals inbox in Settings → Enterprise with a sidebar count)
Objective: `knowledge_propose(kind, scope, path, content?, targetScope?, reason, evidence[])` as hub MCP tool and RPC, kinds: create, update, move-scope, delete, area-access. Proposals persist in the store. Approval rules: lead approves in their own area; admin approves global, any area and all area-access requests. Approve applies the change as one git commit with trailers `Proposal-Id`, `Proposed-By`, `Approved-By`, `Evidence`. Reject records a reason. Revert of an applied proposal creates a revert commit and marks it reverted. Area access requests from `AreaKnowledge` move onto this mechanism. The inbox shows what each approver can act on.
Acceptance:

- [ ] Bruno proposes a Ledger doc; Ana approves; `git log` shows one commit with the four trailers
- [ ] Gerry (Frontend lead) cannot approve a Ledger proposal; Ana cannot approve a global one
- [ ] Move `areas/ledger/x.md` → `global/` requires admin and appears in global search afterwards
- [ ] Reject keeps the knowledge unchanged; revert restores the previous content
- [ ] Gerry's area-access request is pending until admin approves
- [ ] Concurrent approvals of two proposals on the same file: the second fails with a conflict, not a silent overwrite
      Validation: `vp test run apps/server/src/enterprise apps/server/src/knowledge`; `vp run check:changed`.
      Stop when: validation passes, or report BLOCKED after two failed attempts.

### T6: Ingestion v0

**Agent:** builder · **Harness:** pihouse · **Model:** claude-bridge/claude-sonnet-5-5 · **Blocked by:** T5 · **Parallel with:** none
**Skills:** test-driven-development, incremental-implementation, git-workflow-and-versioning, spec-driven-development
**Files:** apps/server/src/enterprise/ (ingestion service, prompts/ingest.md), apps/web/src/components/ (admin "Load bucket" action)
Objective: The admin picks a folder on the hub machine (repos, docs, sheets). The hub starts an ordinary thread with the admin's selected provider/model and the ingestion prompt. The agent maps what exists per area (Norai CLI at `/Users/jeronimo.deli/Desktop/other/Vs/norai` if available, otherwise grep/read) and writes only `knowledge_propose` calls: a `global/overview.md` of what exists and who owns it, and per-team docs pointing to source paths. The general doc says what exists and points to sources; it does not summarize everything (see `docs/vault/norai-evidence.md`). The admin can approve a batch at once. A second ingestion over a changed folder proposes updates/deletes, not duplicates.
Acceptance:

- [ ] Ingesting a Bank of Anthos clone (`GoogleCloudPlatform/bank-of-anthos`, any recent commit) yields proposals for global plus at least Ledger, Frontend, Accounts, Platform
- [ ] Only admin can start ingestion (server test)
- [ ] Re-ingesting an unchanged folder yields no new create proposals
- [ ] Batch approve applies all selected proposals as separate commits
      Validation: focused tests for authorization and dedupe with `vp test run`; one real ingestion run on the cheapest model of the admin's provider, transcript in the progress ledger; `vp run check:changed`.
      Stop when: validation passes, or report BLOCKED after two failed attempts.

### T7: Team Agents and thread publication

**Agent:** builder · **Harness:** pihouse · **Model:** claude-bridge/claude-sonnet-5-5 · **Blocked by:** T6 · **Parallel with:** none
**Skills:** test-driven-development, incremental-implementation, git-workflow-and-versioning, spec-driven-development
**Files:** apps/server/src/team/TeamPublication.ts, apps/server/src/team/CrossEnvironmentGrants.ts (keep or delete per T0), apps/server/src/enterprise/, packages/contracts/src/teamActivity.ts, apps/web/src/components/ (sidebar section under Projects, thread publish menu), packages/client-runtime/src/
Objective: Each thread has a publish level: not published (team sees title, owner, status only), read-only, or full access (only if T0 approved peer links; otherwise hidden). Publishing a thread includes its subagent threads. The sidebar shows a "Team Agents" section under Projects, grouped by person, listing published and active threads of my team (admin: everyone). Opening a published thread shows it read-only, fetching content only on open; the list carries summaries only (performance: no full transcripts over the websocket). Unpublish removes access (reverse state).
Acceptance:

- [ ] Hugo publishes read-only; Juan (Frontend) can open it; Ana (Ledger) sees no content
- [ ] An unpublished thread shows only title, owner and status to teammates
- [ ] Publishing a parent thread exposes its subagents; unpublishing hides both
- [ ] Full access, if enabled, is granted per thread and revocable; otherwise no control appears
      Validation: server tests for publication access; a browser test for the publish menu states if one fits the existing patterns; `vp run check:changed`.
      Stop when: validation passes, or report BLOCKED after two failed attempts.

### T8: Run records

**Agent:** builder · **Harness:** pihouse · **Model:** claude-bridge/claude-sonnet-5-5 · **Blocked by:** T7 · **Parallel with:** none
**Skills:** test-driven-development, incremental-implementation, git-workflow-and-versioning, spec-driven-development
**Files:** apps/server/src/enterprise/ (RunRecords), apps/server/src/orchestration-v2/ (subscribe only, no orchestration changes), apps/server/src/mcp/, packages/contracts/src/
Objective: When a turn completes on an enrolled member environment, build a run record from the persisted orchestration events (not by polling): thread, turn, member, team, provider, model, input/output tokens, tool calls (name and MCP server), knowledge docs read (from `knowledge_get` calls), proposals made, start/end time, outcome `unknown`. Send it to the hub after the turn commits; the hub stores it. Hub MCP tool `runs_query(filters)` returns records to admin (all) and leads (own team). This is the evidence feed for the future loop; do not build digests or reviews.
Acceptance:

- [ ] A turn that called `knowledge_get` twice and `knowledge_propose` once produces a record listing both reads and the proposal id
- [ ] Records from a member who is not enrolled are not sent
- [ ] A lead cannot query another team's records
- [ ] Hub offline: the member queues and delivers once on reconnect, without duplicates
- [ ] Tests await the persisted event or drain `OrchestrationEffectWorkerV2`, no sleeps
      Validation: `vp test run apps/server/src/enterprise`; `vp run check:changed`.
      Stop when: validation passes, or report BLOCKED after two failed attempts.

### T9: Integration pass

**Agent:** builder · **Harness:** pihouse · **Model:** claude-bridge/claude-sonnet-5-5 · **Blocked by:** T8 · **Parallel with:** none
**Skills:** test-driven-development, git-workflow-and-versioning
**Files:** docs/plans/enterprise-base-progress.md, docs/vault/current-state.md, docs/plans/team-pilot.md (mark superseded at the top), fixes found
Objective: Run `scripts/enterprise-dev.ts` with jero, ana, gerry, rosa and walk the 11 manual tests in `docs/vault/test-identities.md` in a real browser, following `.agents/skills/test-t3-app/SKILL.md` for browser verification. Use the free `Replay (dev)` provider for turns where provider behavior does not matter. Fix what fails, each fix with a failing test first when it is logic. Rewrite `docs/vault/current-state.md` to describe the new state.
Acceptance:

- [ ] All 11 manual tests pass; results recorded in the progress ledger with screenshots paths
- [ ] `docs/vault/current-state.md` matches the code
- [ ] `team-pilot.md` starts with "Superseded by docs/plans/enterprise-base.md"
- [ ] No secrets or real tokens in `git diff`
      Validation: `vp run check:changed && git diff --check`
      Stop when: all pass, or report BLOCKED with the failing items after two attempts each.

## Validation

```bash
cd /Users/jeronimo.deli/Desktop/other/Vs/enterprise-ide
vp run check:changed
git diff --check
node scripts/enterprise-dev.ts --members jero,ana,gerry,rosa   # then the 11 manual tests in docs/vault/test-identities.md
```

## Out of scope

- The self-learning loop: digests, reviews, maintenance agents, promotion heuristics, evals (`docs/vault/loop.md`).
- Real Google/OIDC, OTP, email delivery, hosted enterprise service, cross-machine enrollment.
- Usage stats UI and billing.
- Mobile UI for enterprise features (contracts stay shared so mobile can follow).
- Embeddings or vector search; DuckDB knowledge store.
- Opening PRs or pushing.
