# Phase 2 Checkpoint Log

| Story | Commit | URL(s) | Local Validation | Production Validation | User Checkpoint | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| US-015 | local workspace (uncommitted) | n/a | `ls -la docs/user-stories/phase-2` pass | doc-only story | Passed | `done` | Gap matrix and strict dependency sequence locked. |
| US-016 | local workspace (uncommitted) | pending | `nx test api` (targeted tool/orchestration/controller/behavioral) pass; `nx build api` pass | pending deployment verification | Passed (local) | `in-review` | 5th tool added with deterministic + graph wiring; prod check pending. |
| US-017 | `cb37c40e3` | `https://ghostfolio-production-e8d1.up.railway.app` | `jest apps/api/src/app/agent/orchestration/deterministic-agent.service.spec.ts` pass; `jest apps/api/src/app/agent/agent.behavioral.spec.ts` pass; full `jest apps/api/src/app/agent/` pass; full `jest apps/api/src/app/agent/evals/` pass; `npm run ci:release-gate` pass on Node `22.22.0` | Deployment `e12d8fd8-8176-424d-9d12-ee3415077eb2` success; post-deploy prod eval `52/55` (`94.55%`) with US-017 target IDs all passing | Passed (prod) | `done` | Pre-deploy baseline `45/55` (`81.82%`) and failing IDs archived at `apps/api/src/app/agent/evals/output/prod-eval-us017-2026-02-26.txt`; post-deploy evidence at `apps/api/src/app/agent/evals/output/prod-eval-us017-2026-02-26-postdeploy.txt`. Residual non-target failures moved to US-018: `gs-024`, `gs-043`, `gs-048`. |
| US-018 | `d8fdf97aa` (evidence), `cb37c40e3` (runtime validated) | `https://ghostfolio-production-e8d1.up.railway.app` | `jest apps/api/src/app/agent/evals/` pass (covered by `ci:release-gate` on Node `22.22.0`) | Production deployment `e12d8fd8-8176-424d-9d12-ee3415077eb2` success + full 55-case eval rerun: `52/55` (`94.55%`) | Passed | `done` | Coverage buckets valid (`23/12/10/10`) and required category mix present. Internal target `>=85%` met. Residual taxonomy documented: `gs-024`, `gs-043`, `gs-048` (owner: `youssef`). |
| US-019 | | | | | Pending | `todo` | |
| US-020 | | | | | Pending | `todo` | |
| US-021 | | | | | Pending | `todo` | |
| US-022 | | | | | Pending | `todo` | |
| US-023 | | | | | Pending | `todo` | |
| US-024 | | | | | Pending | `todo` | |
| US-025 | | | | | Pending | `todo` | |
| US-026 | | | | | Pending | `todo` | |
| US-027 | | | | | Pending | `todo` | |
