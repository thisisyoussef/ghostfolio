# US-018: Eval Gate Raise and Production Regression

## Status

- State: `todo`
- Owner: `youssef`
- Depends on: US-017
- Related PR/Commit:
- Target environment: `prod`

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

- [ ] AC1: Production eval run is executed and recorded with timestamp.
- [ ] AC2: Dataset count/distribution checks remain compliant.
- [ ] AC3: Internal pass rate is `>=85%` or documented blockers exist with owners.
- [ ] AC4: Failure taxonomy and mitigation plan are recorded.

## Local Validation

```bash
npx dotenv-cli -e .env.example -- npx jest --config apps/api/jest.config.ts --runInBand "apps/api/src/app/agent/evals/"
```

## How To Verify In Prod

```bash
EVAL_ACCESS_TOKEN=<token> EVAL_BASE_URL=https://ghostfolio-production-e8d1.up.railway.app npx tsx apps/api/src/app/agent/evals/eval-runner.ts
```

## Checkpoint Result

- Commit SHA:
- Production URL(s):
- Eval pass rate:
- User Validation: `passed | failed | blocked`
- Definition of Done: `all passed | exceptions noted below`
- Notes:
