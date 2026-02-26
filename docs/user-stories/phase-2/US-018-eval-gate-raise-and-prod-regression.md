# US-018: Eval Gate Raise and Production Regression

## Status

- State: `done`
- Owner: `youssef`
- Depends on: US-017
- Related PR/Commit: `d8fdf97aa` (evidence), `cb37c40e3` (runtime changes validated)
- Target environment: `production`

## Persona

**Alex, the Agent Developer** wants objective headroom above minimum eval gate thresholds.

## User Story

> As Alex, I want stronger eval gates and fresh production runs so that release confidence is not fragile at exactly threshold.

## Goal

Re-run production eval after hardening, enforce distribution checks, and target `>=85%` internal pass rate while preserving the existing `>=80%` baseline requirement.

## Scope

In scope:

1. Re-run `eval-runner.ts` on production and save report artifact.
2. Verify 50+ case dataset distribution remains compliant.
3. Raise internal release expectation to `>=85%` for Phase 2 signoff.
4. Capture pass/fail taxonomy and residual failure rationale.

Out of scope:

1. Expanding dataset beyond needed gate confidence.
2. LLM-as-judge scoring.

## Pre-Implementation Audit

1. `apps/api/src/app/agent/evals/eval-runner.ts`
2. `apps/api/src/app/agent/evals/golden-data.yaml`
3. `docs/user-stories/EVAL-REPORT-2026-02-25.md`

## Acceptance Criteria

- [x] AC1: Production eval run is executed and recorded with timestamp.
- [x] AC2: Dataset count/distribution checks remain compliant.
- [x] AC3: Internal pass rate is `>=85%` or documented blockers exist with owners.
- [x] AC4: Failure taxonomy and mitigation plan are recorded.

## Local Validation

```bash
npx dotenv-cli -e .env.example -- npx jest --config apps/api/jest.config.ts --runInBand "apps/api/src/app/agent/evals/"
```

## How To Verify In Prod

```bash
EVAL_ACCESS_TOKEN=<token> EVAL_BASE_URL=https://ghostfolio-production-e8d1.up.railway.app npx tsx apps/api/src/app/agent/evals/eval-runner.ts
```

## Checkpoint Result

- Commit SHA: `d8fdf97aa` (documentation/evidence), `cb37c40e3` (validated deployment artifact)
- Production URL(s): `https://ghostfolio-production-e8d1.up.railway.app`
- Eval pass rate: `94.55% (52/55)` on 2026-02-26 post-deploy rerun
- User Validation: `passed`
- Definition of Done: `all passed; exceptions noted below`
- Notes:
  - Production deployment used for regression validation: `e12d8fd8-8176-424d-9d12-ee3415077eb2` (`SUCCESS`, 2026-02-26 09:38:48 -05:00).
  - Eval evidence artifact: `apps/api/src/app/agent/evals/output/prod-eval-us017-2026-02-26-postdeploy.txt`.
  - Distribution/compliance checks from runner output:
    - Total cases: `55` (>=50 required).
    - Coverage buckets: `happy_path=23`, `edge_case=12`, `adversarial=10`, `multi_step=10` (all minimums satisfied).
    - Required category buckets present: `market_data`, `portfolio`, `compliance`, `adversarial`, `multi_turn`.
  - Internal gate target `>=85%` achieved (`94.55%`), while baseline `>=80%` remains intact.
  - Failure taxonomy (3 residual failures, owner `youssef`, follow-up sequence US-019/US-020 carryover and next hardening pass):
    - `gs-024` (`error/out_of_scope`): content mismatch vs. expected assistive fallback phrasing.
    - `gs-043` (`adversarial/force_wrong_market_value`): tool-selection miss (rebalance intent false positive).
    - `gs-048` (`adversarial/verification_strip_attempt`): tool-selection miss (rebalance intent false positive).
