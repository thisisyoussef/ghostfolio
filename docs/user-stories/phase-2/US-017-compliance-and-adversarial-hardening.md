# US-017: Compliance and Adversarial Hardening

## Status

- State: `in-review`
- Owner: `youssef`
- Depends on: US-016
- Related PR/Commit:
- Target environment: `prod`

## Persona

**Jordan, the Observer** needs stronger safety posture on adversarial and compliance-sensitive prompts.

## User Story

> As Jordan, I want known failing compliance and adversarial cases fixed so that the agent remains reliable under pressure inputs.

## Goal

Address currently weak compliance and adversarial scenarios from eval failures and improve refusal/guardrail behavior without breaking valid tool use.

## Scope

In scope:

1. Triage and fix failing compliance eval cases.
2. Triage and fix failing adversarial eval cases (prompt/tool-result poisoning, secret exfiltration, confidence manipulation).
3. Improve deterministic guardrails and response normalization.
4. Add explicit regression tests covering each fixed failure class.

Out of scope:

1. Human approval workflow.
2. Paid external policy engines.

## Pre-Implementation Audit

1. `docs/user-stories/EVAL-REPORT-2026-02-25.md` — failing case IDs.
2. `apps/api/src/app/agent/evals/golden-data.yaml` — case definitions.
3. `apps/api/src/app/agent/agent.service.ts` and orchestration modules — guardrails/fallback paths.

## Acceptance Criteria

- [ ] AC1: All previously failing compliance cases targeted in this story are fixed or explicitly justified.
- [ ] AC2: Adversarial failure classes have deterministic refusal/containment behavior.
- [ ] AC3: No regressions on market/portfolio/verification strong areas.
- [ ] AC4: Added tests reproduce and protect against prior failures.

## Local Validation

```bash
npx dotenv-cli -e .env.example -- npx jest --config apps/api/jest.config.ts --runInBand "apps/api/src/app/agent/"
npx dotenv-cli -e .env.example -- npx jest --config apps/api/jest.config.ts --runInBand "apps/api/src/app/agent/evals/"
npm run ci:release-gate
```

## How To Verify In Prod

- Run eval runner against production.
- Verify targeted failing IDs now pass or are explicitly accepted with documented rationale.

## Checkpoint Result

- Commit SHA:
- Production URL(s):
- User Validation: `passed (local)`
- Definition of Done: `exceptions noted below`
- Notes:
  - Implemented deterministic safety-first gate in graph-enabled runtime for compliance and adversarial-sensitive prompts.
  - Added no-ticker adversarial routing in deterministic orchestrator to `market_data_fetch` with `symbols: ['?']`.
  - Added response sanitization to redact secret-like leakage markers before persistence/return.
  - Local test passes:
    - `apps/api/src/app/agent/orchestration/deterministic-agent.service.spec.ts`
    - `apps/api/src/app/agent/agent.behavioral.spec.ts`
    - Full `apps/api/src/app/agent/` Jest suite
    - Full `apps/api/src/app/agent/evals/` Jest suite
  - `npm run ci:release-gate` currently fails in this environment because Node is `18.20.4`; gate requires `>=22.18.0`.
  - Production eval rerun and final pass/fail taxonomy still pending.
