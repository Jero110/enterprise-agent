# Technical plan: Jero & Gerry enterprise pilot

**Date:** 2026-11-04 · **Branch:** main · **Specs:** [TEAM-PILOT-MAP.md](../TEAM-PILOT-MAP.md) and [SPEC-*.md](../SPEC-team-identity.md) · **Scope:** local Dev pilot, not a production hosted team.

## Goal

Run two independent Dev IDEs on one Mac: Jero signs in using Google as preauthorized administrator `jeronimo.deli@gmail.com`; Gerry uses a conspicuous Dev-only anonymous identity. Both belong to the same **enterprise** and see a Team page showing the organization directory; Team → Agents below Projects shows live activity grouped by person. Jero starts in Admin team, Gerry in No Team. Both can work in either environment only after explicit revocable cross-environment grants. Both see `general.md`; only Jero sees `auth.md`, only Gerry sees `no-mail.md`, including via agent reads.

Admin (Jero) can:

- Open profiles in Team → People: see usage stats (conversations and tokens for today, 7 days, all-time).
- Authorize/deauthorize emails, create/rename/delete teams, move members between teams.
- View usage of all teams and members.

Non-admins see their own stats and their team’s. Usage is attributed to the **team of the person who started** the conversation, not the environment owner. Everyone in the enterprise contributes to general context; deeper interaction happens within teams.

## Technical direction

1. **Investigate existing boundaries before choosing adapters.** Verify how Clerk tokens can be server-validated for enterprise Google login, how Electron Dev resolves `userData` and single-instance/protocol registrations, how environment discovery and MCP read tools are wired. Preserve existing standalone T3 use. If a provider cannot be verified, use a separate Google OIDC integration with developer-supplied credentials; never treat a browser email field as proof.
2. **Local team authority.** A separately running local service/data store, reachable by two independent T3 Dev backends, owns verified membership, admin allowlist, invitations, area grants and requests, and an environment directory. It must not own agents, provider credentials, or arbitrary host files. Both installations register with it after enrollment; invite secrets are expiring/revocable and do not grant privileges without identity. Do not claim internet reachability.
3. **Two actual desktop processes.** Add an explicit Dev instance identifier (`Jero`, `Gerry`) that isolates Electron `userData`, T3 home, ports, singleton and protocol-handler behavior. Never point both processes at one SQLite database; leave the installed Beta untouched.
4. **Authorize at the owning server.** Seed three innocuous Markdown fixtures; evaluate reads at the API and agent-tool boundary from server-verified identity and current area membership. Admin is preallowlisted by exact verified normalized email. Development anonymous Gerry is fail-closed outside Dev. A pending area request does not grant a document. Cross-environment actions require a separately granted, revocable scoped session on the owner, not team membership.
5. **Client and agent surfaces.** Add a collapsible Team section in the existing sidebar, independent of Projects; list Jero/Gerry and running agents under each with accurate active counts, and label projects/conversations by owner. Add a per-session 'Your context' panel near session activity with authorized Markdown and a read-only, identity-aware agent tool. Logout/revocation invalidates cached content and active capabilities.
6. **Integration.** Use deterministic fake token verification for automated auth tests; real Google login is a manual acceptance step performed by the user after private OAuth configuration. Run two local Dev instances and verify cross-process updates, cross-writes with explicit grants, denied reads and revocation. Do not automate login to the user's account.

## Dependencies and checkpoints

- Identity and local team authority first; automatic tests prove unauthorized callers fail before any UI.
- Enrollment next; restart two independent instances and verify each keeps its own environment ID and same team membership.
- Knowledge and desktop profile isolation can progress on disjoint files after stable team contracts.
- Team activity and context UI consume those contracts; browser and server tests must precede implementation (RED → GREEN → REFACTOR).
- Final integrated pass: two Dev desktops (Jero/Gerry), both project/agent feeds, both documents sets, explicit bilateral action grants, logout/revoke/offline behavior, lint/typecheck/tests and no leaked secrets.

## Risks and mitigations

- **Existing cloud login may not authorize our local server:** verify token server-side; otherwise implement standalone OIDC, block real-login acceptance until OAuth config is provided. Never silently fake Google authentication.
- **Electron's Dev profile and custom protocol are global:** isolate profile and secondary handler registration; tests for two concurrent processes; preserve original Dev launch.
- **Two independently running instances need an issuer:** start/stop an explicit local team authority with persistent test state; no copied DB or browser-only mock.
- **Anonymous identity could escape Dev:** guard on server startup/runtime mode, not a browser flag, and test packaged production denial.
- **Cross-write could bypass area controls:** use existing scoped owner-issued sessions; distinguish environment action scopes from knowledge-area scopes; test revocation directly at backend.
- **Existing Beta may not implement new protocol:** build both clients from this repo; leave Beta untouched.
- **OAuth user action is not available to an executor:** implement and test fake verifier path and document exact private configuration; report manual Google smoke as pending until the user performs login.

## Verification strategy

From `enterprise-ide/`: focused `pnpm exec vp test run <test-file>` for each RED/GREEN cycle; `pnpm test`, `pnpm typecheck`, `pnpm lint` after integration; manual local smoke with two `pnpm dev:desktop` instances under distinct documented identities. Check direct unauthorized document/API/tool reads and write attempts, not merely absence of UI controls. Inspect `git diff --check` and staged diff for secrets before atomic commits.

## Out of scope

Hosted organization service, email invitation delivery, production anonymous login, cloud deployment, automatic document ingestion, full conversation sharing, token usage dashboard and durable cross-machine job dependencies. No modification of the installed Beta binary.
