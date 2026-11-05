Superseded by docs/plans/enterprise-base.md

# Jero & Gerry Enterprise Team Pilot

**Plan:** docs/plans/team-pilot.md · **Planned:** 2026-11-04 · **Branch:** main

## Goal

Run two independent Dev IDEs (Jero with Google, Gerry anonymous) on one Mac, both enrolled in one local enterprise. Team page shows org directory with people/teams; Team → Agents sidebar shows live activity grouped by person. Admin manages people, teams, and sees all usage stats. Usage attributed to the team of who started a task. Three Markdown files with area-based permissions. Cross-environment actions require explicit grants. Unpublished threads show only metadata; publishing shares content with team.

## Decisions (binding)

- `jeronimo.deli@gmail.com` is preauthorized admin, displayed as Jero.
- Anonymous Dev identity displayed as Gerry; unavailable in production.
- General context for everyone in enterprise; area Markdown per team permissions.
- Team → Agents shows live agents/open conversations from entire enterprise by person.
- Unpublished threads: only title, owner, status visible; Publish to my team shares content to current team members only.
- Admin can: authorize emails, create/rename/delete teams, move members, view all usage.
- Non-admins see own + team usage stats (conversations/tokens: today, 7 days, all-time).
- Usage attributed to team of person who started, not environment owner.
- Cross-environment write requires explicit revocable grant from owner.
- Two separate Electron Dev processes with isolated userData/home/ports.

## Assumptions (the executor may change these)

- Local team authority is a separate process or embedded service reachable by both Dev instances.
- Clerk/Google tokens can be server-verified; otherwise standalone OIDC with developer-supplied credentials.
- Markdown fixtures are innocuous test content under version control.

## Skills

| Skill                       | Author | Path                                                                                             | What it changes in this work                            |
| --------------------------- | ------ | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| spec-driven-development     | Addy   | /Users/jeronimo.deli/Desktop/other/vs/pi-house/skills/build/spec-driven-development/SKILL.md     | Validates each module spec before implementation        |
| test-driven-development     | Addy   | /Users/jeronimo.deli/Desktop/other/vs/pi-house/skills/build/test-driven-development/SKILL.md     | Write failing tests first for auth, grants, publication |
| git-workflow-and-versioning | Addy   | /Users/jeronimo.deli/Desktop/other/vs/pi-house/skills/build/git-workflow-and-versioning/SKILL.md | Atomic commits per module, no secrets                   |

## Agents

| Agent    | Harness | Model                     | Does                      |
| -------- | ------- | ------------------------- | ------------------------- |
| executor | pihouse | anthropic/claude-opus-4-5 | Runs this plan end to end |

## Execution

Sequential with parallel where files don't overlap:

1. T1: team-identity (Google auth, admin allowlist, Dev anonymous)
2. T2: team-enrollment (local authority, invitation, persistence)
3. T3 & T4 parallel: area-knowledge (Markdown fixtures, server-enforced reads) and two-instance isolation (Electron profile/port separation)
4. T5: team-activity (Team page, People admin, usage stats, Team → Agents sidebar, publication)
5. T6: session-context (Your context panel, agent read tool)
6. T7: Integration test with two running Dev IDEs

## Tasks

### T1: Team identity

**Agent:** executor · **Harness:** pihouse · **Model:** anthropic/claude-opus-4-5 · **Blocked by:** none · **Parallel with:** none
**Skills:** spec-driven-development, test-driven-development, git-workflow-and-versioning
**Files:** apps/server/src/auth/, apps/web/src/components/clerk/, packages/contracts/src/
Objective: Google login with server-verified identity; `jeronimo.deli@gmail.com` preauthorized as admin Jero; Dev-only anonymous Gerry; logout revokes reads.
Acceptance:

- [ ] Server rejects unverified/browser-submitted email
- [ ] Admin allowlist checked on every request
- [ ] Anonymous identity blocked outside Dev mode
- [ ] Logout removes former user's cached permissions
      Validation: `pnpm test && pnpm typecheck && pnpm lint`; failing auth tests pass.
      Stop when: validation passes, or report BLOCKED after two failed attempts.

### T2: Team enrollment

**Agent:** executor · **Harness:** pihouse · **Model:** anthropic/claude-opus-4-5 · **Blocked by:** T1 · **Parallel with:** none
**Skills:** spec-driven-development, test-driven-development, git-workflow-and-versioning
**Files:** apps/server/src/, apps/web/src/components/onboarding/, packages/contracts/src/
Objective: Local team authority; admin-issued invitation; paste in T3 to enroll; survives restart; two Dev instances can enroll in same enterprise.
Acceptance:

- [ ] Invitation issued/revoked by admin only
- [ ] Enrollment persists across restart
- [ ] Invalid/expired invitation rejected
- [ ] Two independent Dev instances share team authority
      Validation: `pnpm test && pnpm typecheck && pnpm lint`
      Stop when: validation passes, or report BLOCKED after two failed attempts.

### T3: Area knowledge

**Agent:** executor · **Harness:** pihouse · **Model:** anthropic/claude-opus-4-5 · **Blocked by:** T2 · **Parallel with:** T4
**Skills:** spec-driven-development, test-driven-development, git-workflow-and-versioning
**Files:** apps/server/src/, packages/contracts/src/, new knowledge fixtures folder
Objective: Three Markdown files (general.md, auth.md, no-mail.md); server-enforced area permissions; admin approves area requests.
Acceptance:

- [ ] Jero sees general + auth; Gerry sees general + no-mail
- [ ] Direct API/agent read of unauthorized doc returns error
- [ ] Area request pending until admin approval
- [ ] Revocation removes access immediately
      Validation: `pnpm test && pnpm typecheck && pnpm lint`
      Stop when: validation passes, or report BLOCKED after two failed attempts.

### T4: Two-instance isolation

**Agent:** executor · **Harness:** pihouse · **Model:** anthropic/claude-opus-4-5 · **Blocked by:** T2 · **Parallel with:** T3
**Skills:** test-driven-development, git-workflow-and-versioning
**Files:** apps/desktop/src/app/, scripts/dev-runner.ts, apps/desktop/scripts/
Objective: Run two Electron Dev IDEs simultaneously with isolated userData, T3 home, ports, singleton and protocol handlers; named Jero and Gerry.
Acceptance:

- [ ] Two concurrent `pnpm dev:desktop` with different instance IDs
- [ ] Each has independent environment ID and SQLite
- [ ] Neither steals focus or terminates the other
- [ ] Beta installation unaffected
      Validation: Manual: launch both, verify independent windows and data.
      Stop when: both run simultaneously without collision.

### T5: Team activity and People

**Agent:** executor · **Harness:** pihouse · **Model:** anthropic/claude-opus-4-5 · **Blocked by:** T3, T4 · **Parallel with:** none
**Skills:** spec-driven-development, test-driven-development, git-workflow-and-versioning
**Files:** apps/web/src/components/, apps/server/src/, packages/client-runtime/src/
Objective: Team page with org directory, People profiles with usage stats, admin actions; Team → Agents sidebar showing live activity grouped by person; publish-to-team for threads.
Acceptance:

- [ ] Team page lists all members with team assignments
- [ ] Admin can authorize emails, manage teams, move members
- [ ] Admin sees all usage; members see own + team usage (today/7d/all-time conversations and tokens)
- [ ] Team → Agents shows live agents/open conversations grouped by Jero/Gerry
- [ ] Unpublished thread: only metadata visible; published: team can read content
- [ ] Usage attributed to team of person who started
      Validation: `pnpm test && pnpm typecheck && pnpm lint`; browser tests pass.
      Stop when: validation passes, or report BLOCKED after two failed attempts.

### T6: Session context

**Agent:** executor · **Harness:** pihouse · **Model:** anthropic/claude-opus-4-5 · **Blocked by:** T5 · **Parallel with:** none
**Skills:** spec-driven-development, test-driven-development, git-workflow-and-versioning
**Files:** apps/web/src/components/, apps/server/src/mcp/, packages/contracts/src/
Objective: "Your context" panel near session activity; agent read tool for authorized Markdown only.
Acceptance:

- [ ] Panel shows authorized Markdown per identity
- [ ] Agent tool reads only authorized docs
- [ ] Logout clears stale content
- [ ] Server denies unauthorized agent reads
      Validation: `pnpm test && pnpm typecheck && pnpm lint`
      Stop when: validation passes, or report BLOCKED after two failed attempts.

### T7: Integration

**Agent:** executor · **Harness:** pihouse · **Model:** anthropic/claude-opus-4-5 · **Blocked by:** T6 · **Parallel with:** none
**Skills:** test-driven-development, git-workflow-and-versioning
**Files:** all modified files
Objective: Full smoke test with two running Dev IDEs; verify all flows end-to-end.
Acceptance:

- [ ] Jero and Gerry windows open simultaneously
- [ ] Both see Team page, correct Team → Agents activity
- [ ] Cross-environment action requires explicit grant; revocation blocks
- [ ] Each sees correct Markdown per area
- [ ] Usage stats reflect actual conversations/tokens by team
- [ ] No secrets in git diff
      Validation: Manual smoke + `pnpm test && pnpm typecheck && pnpm lint && git diff --check`
      Stop when: smoke passes and all checks green.

## Validation

```bash
cd enterprise-ide
pnpm test && pnpm typecheck && pnpm lint
git diff --check
# Manual: two Dev IDEs running, cross flows verified
```

## Out of scope

- Hosted organization service
- Production anonymous login
- Email invitation delivery
- Modifying installed Beta binary
- Full conversation sharing without publication
- Token usage billing/limits
- Cross-machine enrollment
