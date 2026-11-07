# Context changes and staged ingest

**Plan:** docs/plans/context-changes-ingest.md · **Planned:** 2026-11-05 · **Branch:** main

## Goal

A connected enterprise member opens “Context changes” beside “Current context”: the same context graph is dimmed and only pending changes stand out, organized by personal recipient, each accessible area, and company. They see proposals they authored or must review, including history and the actual uploaded files. For example, Bruno uploads a PDF for Ana’s personal context; Ana alone can approve it. Approval records it as accepted but **does not** put its contents into active knowledge until a future ingestion agent processes it.

## Decisions (binding)

- Each proposed context change is a durable proposal; never silently apply directly. Reuse and extend the existing enterprise proposal mechanism, not GitHub PRs.
- Personal proposals may target another enrolled person; only the recipient can approve/reject them. Area proposals are reviewable by leads of that specific area (admins may also approve areas); only admins approve global proposals. A person can belong to several areas and independently be lead in some, member in others.
- The inbox shows proposals authored by the current member and those assigned to them, even when the author cannot approve, and includes approved/rejected history. Show who may approve and actual action availability; enforce every permission on the hub.
- “Context changes” uses the existing graph, dimmed except for pending proposal nodes, including several distinct area groupings; review details and attachments are accessible from a selected node and from the inbox. Avoid injecting uploaded-file content into the existing graph’s active knowledge source.
- “Ingest” selects personal (with recipient), one accessible area, or company; supports multiple individual files from the **client device** across remote connections. Retain bytes and allow authorized review/download and safe inline preview where supported. No folder upload required in this phase.
- Until the ingestion agent exists, ingestion creates durable file-backed proposed-upload records (author, scope, recipient/area, filenames, files, status), not automatically generated document changes. Approval records “approved, awaiting processing”; no knowledge document or agent context is changed. Show an honest pending-processing state, not a fake successful ingest. Keep existing manual/agent knowledge-document proposals functional.
- Existing legacy server-folder ingestion is not the new user-facing upload flow; do not run a paid model or build an ingestion agent.
- Preserve all pre-existing working-tree changes. In particular `apps/web/src/components/enterprise/KnowledgeMap.tsx` and `apps/web/public/context-graph/` are currently untracked user work, and `ChatView.tsx` / `EnterpriseHeaderControls.tsx` are modified. Inspect before editing; never overwrite, reset, or commit user changes indiscriminately.
- Follow repository AGENTS.md when it differs from selected generic skills: no repo-wide test/check commands, no PR without request, no committed plan/research artifacts.

## Assumptions (the executor may change these)

- Store upload blobs in the hub’s isolated data directory using opaque IDs, with metadata/proposals in the existing enterprise store; reuse the signed-asset/upload HTTP infrastructure if its authorization model fits, otherwise add a dedicated streamed authenticated upload route. Never put base64 file bodies in WebSocket proposals or SQLite.
- Initially limit batches and bytes on both client and server (e.g. 20 files, 10 MiB each), show clear errors; keep binary files opaque and serve dangerous types as downloads. Decide exact limits based on existing attachment constraints.
- For personal and approved file-backed proposals, no real individual knowledge scope or agent visibility is created yet. This first phase represents scope faithfully in proposal UI, not in active knowledge. Existing document proposals continue to apply as before.
- Area roles should attach to area membership/grants rather than making an existing global `lead` role apply to all granted areas. Keep backwards compatibility for primary-team membership and migration/seed fixtures.
- Native mobile currently has no enterprise UI; implement a compact native inbox/upload entry if practical using existing document picker/runtime. If native tooling makes upload impossible in this slice, report the precise blocker rather than pretending parity; server APIs must work remotely and on mobile.
- The user did not specify models; use authenticated `openai-codex/gpt-6-sol` (the current session model). The Claude account is currently exhausted, so do not route workers to it.

## Skills

| Skill                       | Author | Path                                                                                             | What it changes in this work                                                             |
| --------------------------- | ------ | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| test-driven-development     | Addy   | /Users/jeronimo.deli/Desktop/other/vs/pi-house/skills/build/test-driven-development/SKILL.md     | Red/green focused service tests for permissions, upload lifecycle and isolation.         |
| git-workflow-and-versioning | Addy   | /Users/jeronimo.deli/Desktop/other/vs/pi-house/skills/build/git-workflow-and-versioning/SKILL.md | Review diffs, keep logical increments isolated and avoid committing unrelated user work. |

## Agents

| Agent       | Harness | Model                  | Does                                                                                                            |
| ----------- | ------- | ---------------------- | --------------------------------------------------------------------------------------------------------------- |
| implementer | pihouse | openai-codex/gpt-6-sol | Implements the sequenced slices and verifies each in this working tree without disturbing pre-existing changes. |

## Execution

One implementer in sequence because the scope/role model, proposal schema, upload transport and client UI share contracts. Complete and verify T1 before T2, T2 before T3, T3 before T4. Executor performs final integrated client verification and reports any surface it could not exercise. Do not launch concurrent workers editing this dirty checkout. Commit only files produced for this request if committing; never stage all files or add this plan.

## Tasks

### T1: Scope-specific membership and proposal visibility

**Agent:** implementer · **Harness:** pihouse · **Model:** openai-codex/gpt-6-sol · **Blocked by:** none · **Parallel with:** none
**Skills:** test-driven-development, git-workflow-and-versioning
**Files:** `apps/server/src/enterprise/{EnterpriseStore,KnowledgeProposals,EnterpriseHub}.ts`, their existing tests, `apps/server/src/persistence/Migrations/`, `packages/contracts/src/{enterprise,knowledgeProposal}.ts`, `apps/server/src/knowledge/AreaKnowledge.ts`
Objective: Establish durable multi-area memberships with per-area lead capability and a recipient-targeted personal proposal scope, without breaking existing area/global document approval semantics. Inbox/query returns authored and assigned proposals, history, reviewer identity/role (including when caller cannot decide) and correctly counted actionable pending items. Avoid disclosing proposals for unrelated people or inaccessible areas. Verify decisions on hub, including after membership changes.
Acceptance:

- [ ] Existing tests first extended to fail when a person is lead in area A but not B, can propose for both, can approve A but not B; admin can approve both areas and global, not another person’s personal proposal.
- [ ] Only personal recipient can decide a personal proposal; proposer sees their own pending/history without decision rights unless they are the recipient. Unrelated members cannot fetch it by inbox or guessed ID.
- [ ] Different area grants/roles survive store restart; primary-team and legacy grants retain meaningful semantics; proposal lifecycle remains reject/revert compatible where applicable.
      Validation: `vp test run apps/server/src/enterprise/EnterpriseStore.test.ts apps/server/src/enterprise/KnowledgeProposals.test.ts apps/server/src/enterprise/EnterpriseClient.test.ts` (adapt to actual existing filenames) and `vp run typecheck`.
      Stop when: validation passes, or report BLOCKED after two failed attempts.

### T2: Upload staging and file-backed proposals

**Agent:** implementer · **Harness:** pihouse · **Model:** openai-codex/gpt-6-sol · **Blocked by:** T1 · **Parallel with:** none
**Skills:** test-driven-development, git-workflow-and-versioning
**Files:** `packages/contracts/src/{enterprise,knowledgeProposal,rpc,clientRpcPermissions}.ts`, `apps/server/src/{http.ts,enterprise/,assets/}`, `apps/server/src/persistence/Migrations/`, existing associated tests, `packages/client-runtime/src/state/enterprise.ts`
Objective: Authorized, bounded client-device multi-file transfer to the hub (works remotely) creates file-backed upload proposals. Bind each blob to its proposal and reviewer; authorize metadata and bytes on every read, reject orphaned/unauthorized uploads and sanitize preview/download handling. No agent calls and no automatic knowledge commits. Preserve existing document-proposal paths.
Acceptance:

- [ ] Focused failing server tests precede implementation: one upload batch creates inspectable pending proposal(s) with actual bytes/filename; approval becomes approved-awaiting-processing and does not modify knowledge; rejection leaves knowledge untouched.
- [ ] Unauthorized recipients, arbitrary file IDs, inaccessible area/global uploads, oversized/malformed files, traversal names and external HTML/SVG inline execution are denied/served safely. Missing or failed upload never creates an apparently complete proposal.
- [ ] The attachment can be retrieved after hub restart by authorized author/reviewer; revocation takes effect on read; action logs and statuses are consistent.
      Validation: `vp test run apps/server/src/enterprise apps/server/src/http.test.ts` (narrow to touched files during iteration), `vp run typecheck`.
      Stop when: validation passes, or report BLOCKED after two failed attempts.

### T3: Web/desktop context changes and ingest UI

**Agent:** implementer · **Harness:** pihouse · **Model:** openai-codex/gpt-6-sol · **Blocked by:** T2 · **Parallel with:** none
**Skills:** test-driven-development, git-workflow-and-versioning
**Files:** `apps/web/src/components/{enterprise/,chat/EnterpriseHeaderControls.tsx,settings/EnterpriseSettingsPanel.tsx}`, `apps/web/src/components/ChatView.tsx`, `apps/web/public/context-graph/`, `apps/web/src/state/enterprise.ts`, `packages/client-runtime/src/state/enterprise.ts`, relevant browser tests
Objective: Add discoverable “Context changes” entry near “Current context” and settings, with authored/assigned/history views, correctly scoped decisions, dimmed graph highlighting pending changes (distinct area identities), file details and safe previews. “Ingest” supports client file picker, multi-file upload, recipient/area selector and visible status without calling the legacy paid ingestion agent. Preserve existing graph behavior and modified user files.
Acceptance:

- [ ] A non-lead sees their authored area/global proposals and designated reviewer, but no approval buttons; a lead sees actionable proposals only for areas they lead. Personal recipient and admins get only their valid actions.
- [ ] Graph’s pending highlights match inbox records and disappear on resolution while the underlying current-context view remains unchanged; missing preview nodes do not masquerade as actual docs.
- [ ] Multi-file upload from a browser to a remote environment yields visible downloadable proposals with an honest awaiting-processing status; errors and interrupted upload are recoverable.
      Validation: `vp test run <changed-web-browser-tests> packages/client-runtime/src/state/commandPermissions.test.ts`, `vp run typecheck`; one `test-t3-app` integrated browser pass after integration (primary executor only), with before/after UI captures kept outside git.
      Stop when: validation passes, or report BLOCKED after two failed attempts.

### T4: Native/mobile path and integration

**Agent:** implementer · **Harness:** pihouse · **Model:** openai-codex/gpt-6-sol · **Blocked by:** T3 · **Parallel with:** none
**Skills:** test-driven-development, git-workflow-and-versioning
**Files:** `apps/mobile/src/` enterprise navigation/components, `packages/client-runtime/src/state/enterprise.ts`, mobile upload integration where existing native picker fits, `docs/user/` relevant guide if usage changed
Objective: Make member inbox/decisions and device-origin file upload reachable from mobile via the same authoritative hub contracts, or explicitly identify a native-client dependency blocker. Keep web/desktop command palette/settings/keybinding entry points consistent where applicable; include a concise user guide for the major feature only.
Acceptance:

- [ ] Mobile shows authored and assigned proposals, reviewer and status, only authorized actions, and uploads selected files if native picker is available; no local file URI is passed as a hub filesystem path.
- [ ] On all clients, a proposal for an inaccessible area/personal recipient cannot be read or acted upon; local, remote/relay and tunnel connections use the same contracts.
- [ ] User-facing documentation explains staging versus processing, who can approve, and how to start a file upload; does not promise the future agent exists.
      Validation: `vp test run <changed-mobile-tests>`, `vp run typecheck`; primary executor runs `test-t3-mobile` once if native device available, else documents concrete blocker.
      Stop when: validation passes, or report BLOCKED after two failed attempts.

## Validation

- Focused `vp test run` for touched server, contracts, client-runtime, web and mobile tests; test permission enforcement at service layer first and extend existing test tables where possible.
- `vp run check:changed` (fast affected checks only); no repo-wide suites. Verify changes against existing dirty worktree using `git diff` and `git status --short` without resetting user files.
- Primary executor performs one integrated real-client web pass (`test-t3-app`) and mobile pass (`test-t3-mobile`) when applicable, with captures; distinguish blocked validation from passing validation.
- Verify no upload triggers `EnterpriseIngestion.start`/paid provider, no approval of file-backed proposal modifies knowledge, and prior manual/agent proposals still work.

## Out of scope

- Agent-based ingestion, Norai integration and analysis/classification/summarization of files; automatic creation of knowledge documents; automatic injection of approved upload bytes into active personal/area/global context.
- Folder-tree uploads, GitHub pull requests, PR creation/push, release/version bump, and replacement of the existing graph with a new visualization.
- Committing this plan or the pre-existing untracked/modified user work.
