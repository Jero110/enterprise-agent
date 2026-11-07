# Capability Map: Enterprise team context pilot

Approved 2026-11-04. Scope: local development pilot; no hosted enterprise service.

| Module id         | Responsibility                                                                                                                                                  | Depends on                         |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `team-identity`   | Verified Google identity; admin email allowlist; development-only anonymous test identity                                                                       | —                                  |
| `team-enrollment` | Admin-issued invitation entered in T3 to bind a client installation to a team; persistent enrollment                                                            | `team-identity`                    |
| `area-knowledge`  | General and area Markdown, backend authorization, area access requests and admin approval                                                                       | `team-identity`, `team-enrollment` |
| `team-activity`   | Two independently running Dev IDEs discover each other's projects and live agents; expandable Team sidebar; explicit, revocable cross-environment action grants | `team-identity`, `team-enrollment` |
| `session-context` | Visible per-session context next to session activity and read-only agent access to authorized knowledge                                                         | `area-knowledge`, `team-activity`  |

Build order: `team-identity` → `team-enrollment` → (`area-knowledge` and `team-activity`) → `session-context`.

Boundaries: every T3 environment retains its own agent execution, data, and credentials. The pilot runs as two isolated Dev IDEs on one Mac and does not imply cross-device hosted discovery. The anonymous test identity must be unavailable outside explicitly recognized development mode. The invitation identifies a team but never substitutes for identity or grants knowledge access by itself. Authorization is enforced server-side for both humans and agents. Cross-environment writing in the pilot requires an explicit, revocable grant from each owning environment; mere team membership is insufficient.

Specs: [identity](SPEC-team-identity.md), [enrollment](SPEC-team-enrollment.md), [knowledge](SPEC-area-knowledge.md), [activity](SPEC-team-activity.md), [session context](SPEC-session-context.md).
