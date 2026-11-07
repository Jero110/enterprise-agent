# Spec: Session context panel and agent reads

**Module:** `session-context` · **Map:** [TEAM-PILOT-MAP.md](TEAM-PILOT-MAP.md) · **Depends on:** [area knowledge](SPEC-area-knowledge.md), [Team activity](SPEC-team-activity.md)

## Objective

Expose a small, clear "Your context" surface near session details/terminal activity showing available general and area Markdown. The same authorized set is readable by an agent via a read-only server tool, so the user can ask "what company context do I have?" without exposing other areas. This is company knowledge, distinct from the Team sidebar's live colleague activity; the latter is covered by the `team-activity` module.

## Tech Stack

Existing React desktop/web shell, shared client runtime, existing server MCP tool access and provider adapter boundaries. Prefer a tool read checked on each invocation over copying all knowledge into every prompt; do not assume all providers implement the same native file tool.

## Commands

From `enterprise-ide/`: `pnpm dev:desktop`; focused: `pnpm exec vp test run <changed-test-file>`; complete: `pnpm test && pnpm typecheck && pnpm lint`. Manual smoke: Dev desktop as verified member and anonymous Dev identity with a working provider or replay provider where available.

## Project Structure

`apps/web/src/components/` for context panel and adjacent browser tests; `packages/client-runtime/src/` for shared authorized knowledge loading if multiple clients require it; `apps/server/src/mcp/` and orchestration tool registry for agent read and tests; `packages/contracts/src/` for wire schemas if needed.

## Code Style

Use an explicit read access check at the server boundary:

```ts
async function readTeamContext(principal: TeamPrincipal, documentId: string) {
  return authorizedKnowledge.read(principal, documentId);
}
```

## Testing Strategy

Write failing browser tests for available list/content, inaccessible and disconnected states, login/logout refresh; write failing server tests for an agent asking to read auth/no-mail under the wrong principal and for no mutation tool granted through this feature. One real client smoke test checks panel and an agent response grounded in its authorized Markdown. Check console and RPC denial, not just hidden buttons.

## Boundaries

- Always: mark source and area, apply server checks to humans and agents, handle offline gracefully.
- Ask first: auto-injecting large documents into every agent prompt or expanding Team activity into full-text conversation sharing without a separate permission.
- Never: grant terminal/filesystem read as a side effect, show stale prior-user context after logout, use client-only filtering for agent tools.

## Success Criteria

- Jeronimo sees general/auth in a session panel, anonymous Dev sees general/no-mail, and switching identity removes stale content immediately.
- An agent can read and cite the authorized fixture text, and cannot obtain another area's text through the knowledge tool.
- Existing terminal logs and normal thread usage remain intact; Team activity and cross-environment actions use their own explicit grants and do not change knowledge-area permissions.

## Open Questions

- Technical planning locates the correct existing session sidebar and provider-agnostic tool-registration route; capability checks must fail closed for unsupported provider integration.
