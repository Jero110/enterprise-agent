# Spec: Team enrollment

**Module:** `team-enrollment` · **Map:** [TEAM-PILOT-MAP.md](TEAM-PILOT-MAP.md) · **Depends on:** [team identity](SPEC-team-identity.md)

## Objective

An admin creates a company invitation; a person pastes it into a visible T3 onboarding/settings field to enroll either of two independent Dev IDE installations in the same pilot team. Enrollment survives restart, but the invitation alone grants no access: effective membership is recomputed from the current verified identity (or explicit Dev-only test identity). It does not merge two environments, their provider credentials, or their databases.

## Tech Stack

Existing TypeScript Electron/web onboarding (`WelcomeWizard`, settings pages), server-side identity and durable local persistence. Invitation secrets are one-time or bounded-lifetime, revocable, and validated by a local pilot issuer reachable from both running Dev IDEs; no public cloud service is promised.

## Commands

From `enterprise-ide/`: `pnpm dev:desktop`; focused: `pnpm exec vp test run <changed-test-file>`; complete: `pnpm test && pnpm typecheck && pnpm lint`.

## Project Structure

`apps/web/src/components/onboarding/WelcomeWizard.tsx` and related settings components for enrollment; `apps/server/src/` for invitation issuance/redeem and durable enrollment; `packages/contracts/src/` for wire schemas if needed; co-located tests. Keep enrollment distinct from current remote-environment pairing tokens.

## Code Style

Use explicit result types instead of conflating pairing and team enrollment:

```ts
type EnrollmentResult = { readonly teamId: string; readonly status: "enrolled" };
```

## Testing Strategy

Failing test first for valid/expired/revoked/replayed invitations, restart persistence, unauthorized admin issuance, enrollment without identity giving no protected knowledge, account switching recalculating access, and rejection of cross-team tokens. Browser flow tests cover paste, errors and reconnect.

## Boundaries

- Always: secret delivered only to intended user; retain existing T3 personal onboarding; enforce expiry and revocation on the server.
- Ask first: adding public email delivery or hosted rendezvous (explicitly outside this pilot).
- Never: treat invitation as a full-access environment pairing grant or embed secrets in committed files/logs.

## Success Criteria

- Administrator can generate and revoke a bounded invitation; user pastes it in T3 and sees team name/status after restart.
- Invalid/revoked invitation cannot enroll; enrolling does not expand the user's area permissions.
- Two simultaneously running Dev IDEs join the same team through the shared local issuer, without sharing Electron profiles or SQLite; the existing Beta installation remains unmodified.

## Open Questions

- Technical investigation during planning: select an issuer that both independent local T3 instances can reach; do not fake a shared company state by copying files or relying on same-process memory.
