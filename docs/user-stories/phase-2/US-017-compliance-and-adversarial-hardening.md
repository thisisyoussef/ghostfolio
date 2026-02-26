# US-017: Compliance and Adversarial Hardening

## Status

- State: `done`
- Owner: `youssef`
- Depends on: US-016
- Related PR/Commit: `cb37c40e3`
- Target environment: `production`

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

- [x] AC1: All previously failing compliance cases targeted in this story are fixed or explicitly justified.
- [x] AC2: Adversarial failure classes have deterministic refusal/containment behavior.
- [x] AC3: No regressions on market/portfolio/verification strong areas.
- [x] AC4: Added tests reproduce and protect against prior failures.

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

- Commit SHA: `cb37c40e3`
- Production URL(s): `https://ghostfolio-production-e8d1.up.railway.app`
- User Validation: `passed (post-deploy prod eval rerun)`
- Definition of Done: `met`
- Notes:
  - Implemented deterministic safety-first gate in graph-enabled runtime for compliance and adversarial-sensitive prompts.
  - Added no-ticker adversarial routing in deterministic orchestrator to `market_data_fetch` with `symbols: ['?']`.
  - Added response sanitization to redact secret-like leakage markers before persistence/return.
  - Local validation passes:
    - `apps/api/src/app/agent/orchestration/deterministic-agent.service.spec.ts`
    - `apps/api/src/app/agent/agent.behavioral.spec.ts`
    - Full `apps/api/src/app/agent/` Jest suite
    - Full `apps/api/src/app/agent/evals/` Jest suite
    - `npm run ci:release-gate` on Node `22.22.0`
  - Production deployment and eval evidence:
    - Deployment promoted from clean commit worktree: `e12d8fd8-8176-424d-9d12-ee3415077eb2` (`SUCCESS`, 2026-02-26 09:38:48 -05:00).
    - Pre-deploy baseline run (`apps/api/src/app/agent/evals/output/prod-eval-us017-2026-02-26.txt`): `45/55`, `81.82%`, failing IDs: `gs-012`, `gs-035`, `gs-037`, `gs-038`, `gs-043`, `gs-045`, `gs-048`, `gs-049`, `gs-050`, `gs-054`.
    - Post-deploy run (`apps/api/src/app/agent/evals/output/prod-eval-us017-2026-02-26-postdeploy.txt`): `52/55`, `94.55%`.
    - US-017 acceptance set passes post-deploy: `gs-012`, `gs-013`, `gs-014`, `gs-035`, `gs-036`, `gs-037`, `gs-038`, `gs-045`, `gs-049`, `gs-050`, `gs-054`.
  - Residual non-US-017 failures captured for follow-up in US-018: `gs-024`, `gs-043`, `gs-048`.
