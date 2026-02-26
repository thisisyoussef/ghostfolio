# Phase 2 Completion Backlog

This folder is the execution source of truth for final project completion.

## Objective

Close all remaining product, engineering, verification, and submission gaps required for final delivery, including integrated expanding chat FAB support in the authenticated UI.

## Story Sequence (Strict)

| ID | Title | State | Priority | Depends On |
| --- | --- | --- | --- | --- |
| US-015 | Phase 2 bootstrap and gap map | `done` | P0 | US-014 (context only) |
| US-016 | Fifth tool: portfolio rebalance preview | `in-review` | P0 | US-015 |
| US-017 | Compliance and adversarial hardening | `done` | P0 | US-016 |
| US-018 | Eval gate raise and production regression | `todo` | P0 | US-017 |
| US-019 | Integrated expanding chat FAB | `todo` | P0 | US-018 |
| US-020 | Chat UI contract alignment (all tools) | `todo` | P0 | US-019 |
| US-021 | Carryover closure for US-006/007/009/012/014 | `todo` | P0 | US-020 |
| US-022 | Performance SLO and reliability validation | `todo` | P0 | US-018, US-020 |
| US-023 | Agent architecture document (final) | `todo` | P1 | US-022 |
| US-024 | AI cost analysis (final) | `todo` | P1 | US-022 |
| US-025 | Open-source release (public dataset) | `todo` | P1 | US-018, US-021 |
| US-026 | Demo video and social package | `todo` | P1 | US-023, US-024, US-025 |
| US-027 | Final submission bundle and signoff | `todo` | P0 | US-021, US-022, US-023, US-024, US-025, US-026 |

## Execution Rules

1. Do not skip sequence.
2. A story is `done` only when acceptance criteria and production verification are recorded.
3. Keep existing `docs/user-stories/US-001..US-014` in place; Phase 2 references them but does not relocate them.
4. Keep `/agent` route supported while FAB entry is introduced.
5. Keep existing header `gf-assistant` intact during this phase.

## Evidence Requirements

Every story must record:

1. Commit SHA.
2. Commands run.
3. Local validation result.
4. Production validation result.
5. Residual risks.

Track evidence in `CHECKPOINT-LOG.md` inside this folder.
