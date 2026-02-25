# US-011: Release-Green Build and CI Gate

## Status

- State: `done`
- Owner: `youssef`
- Depends on: US-008, US-009, US-010
- Related PR/Commit: `Uncommitted`
- Target environment: `prod`

## Persona

**Alex, the Agent Developer** wants a dependable ship gate so feature completeness is not blocked by baseline build instability.

## User Story

> As Alex, I want API/client build and core test gates to pass reliably so MVP+core can be considered production-ready.

## Goal

Resolve current build blockers and codify a reproducible CI gate for release readiness.

## Scope

In scope:

1. Fix API build blockers in redis/cache compatibility and module resolution.
2. Fix client build blocker around localization parser/config.
3. Ensure required commands pass locally and in CI:
   - `nx build api`
   - `nx build client`
   - agent-focused tests
   - eval runner tests
4. Define required CI checks for merge/release.
5. Remove concrete secret-like values from tracked templates (e.g., `.env.example`) and enforce placeholder-only policy.
6. Document known non-blocking tests (if any) with explicit rationale and owner.

Out of scope:

1. Full monorepo refactor unrelated to release path.
2. Performance optimization beyond build correctness.

## Pre-Implementation Audit

1. `apps/api/src/app/redis-cache/redis-cache.service.ts` — current compile errors.
2. `apps/client` build config and localize setup — parser failure root cause.
3. `.github/workflows/*` — enforce required gate checks.
4. `docs/DEFINITION_OF_DONE.md` — release and test standards.
5. `.env.example` — secret/template hygiene and safe defaults.

## TDD Plan (Minimum)

1. Repro tests for each failing build path.
2. Regression tests for touched API/client modules.
3. CI dry-run script for release gate commands.

## Acceptance Criteria

- [x] AC1: `nx build api` passes.
- [x] AC2: `nx build client` passes.
- [x] AC3: Agent test suite passes with no new flaky failures.
- [x] AC4: CI workflow includes and enforces release gate steps.
- [x] AC5: `.env.example` contains placeholders only (no concrete token values).
- [x] AC6: Build verification evidence is recorded in story checkpoint.

## Local Validation

```bash
npm run ci:check-node-version
npm run ci:check-env-example-placeholders
npm run ci:release-gate

# Expected failure path validation (Node policy)
# Node 18.x => fails with:
#   Node >=22.18.0 is required. Current: <version>

# Release-gate internals:
npx nx build api
npx nx build client
npx dotenv-cli -e .env.example -- npx jest --config apps/api/jest.config.ts --runInBand "apps/api/src/app/agent/"
npx dotenv-cli -e .env.example -- npx jest --config apps/api/jest.config.ts --runInBand "apps/api/src/app/agent/evals/"
```

## Required CI Checks for Merge/Release

- `Release Gate / release-gate` (from `.github/workflows/release-gate.yml`) is the required merge/release gate.

## Known Non-Blocking Checks

- `Build code` workflow (`.github/workflows/build-code.yml`) remains informational for broader monorepo hygiene (lint/format/full test/build) and is not part of the US-011 release gate.
- Owner: `youssef`

## How To Verify In Prod

- Verify:
1. Deploy from passing CI commit.
2. Run health check and agent chat smoke test.
3. Confirm no runtime module-resolution failures in production logs.

## Checkpoint Result

- Commit SHA: `Uncommitted`
- CI Run URL(s): `Pending PR run`
- Production URL(s): `https://ghostfolio-production-e8d1.up.railway.app/en/agent`
- User Validation: `pending`
- Definition of Done: `all local acceptance checks passed; CI required-check workflow added`
- Notes:
  - Added release workflow: `.github/workflows/release-gate.yml` with required check context `Release Gate / release-gate`.
  - Added deterministic scripts: `ci:check-node-version`, `ci:check-env-example-placeholders`, and `ci:release-gate`.
  - Added placeholder policy checker: `tools/ci/check-env-example-placeholders.mjs`.
  - Verified policy guard behavior:
    - Fails on Node 18.20.4 with explicit minimum-version message.
    - Passes on Node 22.22.0.
  - Verified full gate command passes on Node 22.22.0:
    - `nx build api` pass
    - `nx build client` pass (warnings non-blocking)
    - Agent tests pass (20 suites / 214 tests)
    - Eval tests pass (3 suites / 54 tests)
    - `.env.example` secret-like placeholder check pass (8 keys)
