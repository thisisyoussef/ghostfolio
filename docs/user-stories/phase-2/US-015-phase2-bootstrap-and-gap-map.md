# US-015: Phase 2 Bootstrap and Gap Map

## Status

- State: `done`
- Owner: `youssef`
- Depends on: US-006, US-007, US-009, US-012, US-013, US-014
- Related PR/Commit: `local workspace (uncommitted)`
- Target environment: `prod`

## Persona

**Alex, the Agent Developer** needs an unambiguous completion roadmap with no hidden gaps.

## User Story

> As Alex, I want a Phase 2 source of truth that maps all remaining gaps to executable stories so that implementation and submission can be completed deterministically.

## Goal

Bootstrap a dedicated Phase 2 backlog, map unresolved requirements from existing stories and PRD deliverables, and lock a strict execution sequence.

## Scope

In scope:

1. Create `docs/user-stories/phase-2` folder and core index artifacts.
2. Map open requirements from US-006/007/009/012/013/014 into explicit closure stories.
3. Define strict dependency order and readiness criteria.
4. Create a Phase 2 checkpoint log format for evidence.

Out of scope:

1. Feature implementation.
2. Changing existing Phase 1 story files.

## Pre-Implementation Audit

1. `docs/user-stories/README.md` — current story states.
2. `docs/user-stories/CHECKPOINT-LOG.md` — current evidence style.
3. `docs/g4_week_2_-_agentforge.md` — final deliverables and hard requirements.

## Gap Mapping Matrix

| Open Gap Source | Gap Summary | Phase 2 Closure Story |
| --- | --- | --- |
| US-006 | Story is `in-review` with unchecked ACs around memory/error completion evidence. | US-021 |
| US-007 | MVP gate story remains `todo`; MVP evidence closure not finalized. | US-021 |
| US-009 | Verification expansion story remains `todo`; runtime hardening and formal closure incomplete. | US-017 + US-021 |
| US-012 | UI contract alignment story remains `todo`; full tool payload coverage incomplete. | US-020 + US-021 |
| US-013 | Final evidence/signoff story remains `todo`; final package not assembled. | US-027 |
| US-014 | Dataset exists, but story remains `todo` and production gate evidence needs reconciliation. | US-018 + US-021 |
| PRD Tools Requirement | Minimum 5 tools required; current runtime exposes 4. | US-016 |
| PRD UX Requirement (Phase plan) | Integrated expanding chat FAB across authenticated app UI not yet implemented. | US-019 |
| PRD Performance Targets | Formal SLO validation artifact missing from final evidence set. | US-022 |
| PRD Final Deliverables | Architecture doc, AI cost analysis, open-source link, demo package, social package, final bundle. | US-023, US-024, US-025, US-026, US-027 |

## Phase 2 Readiness Locks

1. Sequence is strict (`US-015` through `US-027`), no out-of-order completion.
2. Story closure requires both acceptance criteria and checkpoint evidence.
3. Existing Phase 1 story files are left in place; Phase 2 performs carryover closure without relocation.
4. `/agent` route remains supported while FAB entry is added.
5. Existing header `gf-assistant` stays active during FAB rollout.

## Acceptance Criteria

- [x] AC1: Phase 2 folder and index files exist.
- [x] AC2: Every open gap maps to one specific Phase 2 story.
- [x] AC3: Execution sequence is strict and dependency-complete.
- [x] AC4: Evidence logging format is defined for all Phase 2 stories.

## Local Validation

```bash
ls -la docs/user-stories/phase-2
```

## How To Verify In Prod

- Verify: Documentation-only story; no runtime prod change.

## Checkpoint Result

- Commit SHA: `local workspace (uncommitted)`
- User Validation: `passed`
- Definition of Done: `all passed`
- Notes:
  - Baseline gap audit completed for US-006/007/009/012/013/014.
  - PRD-level remaining requirements mapped to explicit Phase 2 closure stories.
  - Phase 2 sequence and evidence format locked for implementation handoff.
