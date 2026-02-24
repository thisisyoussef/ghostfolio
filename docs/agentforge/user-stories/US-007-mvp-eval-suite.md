# US-007: MVP Eval Suite and Production Gate

## Status

- State: `todo`
- Owner: `youssef`
- Depends on: US-006
- Related PR/Commit:
- Target environment: `prod`

## Persona

**Alex, the Agent Developer** wants documented proof that all 9 MVP requirements are met so the gate is passed with evidence.

## User Story

> As Alex, I want a consolidated eval suite and MVP evidence document so that I can prove all requirements are met.

## Goal

Consolidate all test cases from US-003–US-006 into a single eval suite (≥12 cases), run it against production, record pass/fail results, and create an MVP evidence document mapping each requirement to its proof.

## Scope

In scope:

1. `apps/api/src/app/agent/tests/mvp-eval.spec.ts` — consolidated eval suite.
2. Configurable base URL (local or production).
3. Run against production, capture results.
4. MVP evidence document (`docs/agentforge/user-stories/MVP-EVIDENCE.md`).
5. Update all story statuses to `done`.
6. Verify LangSmith traces for eval run.

Out of scope:

1. 50-case dataset (Phase 3).
2. Adversarial testing.
3. LLM-as-judge evaluation.
4. Performance benchmarking.

## Pre-Implementation Audit

Local sources to read before writing any code:

1. `apps/api/src/app/agent/tools/market-data.tool.spec.ts` — test cases from US-003
2. `apps/api/src/app/agent/tools/portfolio-analysis.tool.spec.ts` — test cases from US-004
3. `apps/api/src/app/agent/tools/compliance-checker.tool.spec.ts` — test cases from US-005
4. `apps/api/src/app/agent/memory/session-memory.service.spec.ts` — test cases from US-006
5. `apps/api/src/app/agent/errors/agent-error.spec.ts` — test cases from US-006
6. `docs/g4_week_2_-_agentforge.md` — MVP requirements list

## Preparation Phase (Mandatory)

1. Read all existing test files to catalog test cases.
2. Read MVP requirements from project brief.
3. Write Preparation Notes mapping each requirement to evidence.

### Preparation Notes

_(Fill during execution.)_

Test case inventory:
| Source | Cases | Category |
|--------|-------|----------|
| US-003 | 5 | Market data (3 happy, 1 edge, 1 error) |
| US-004 | 4 | Portfolio analysis |
| US-005 | 6 | Compliance |
| US-006 | 6 | Memory (3) + Error handling (3) |
| **Total** | **21** | |

MVP requirement → evidence mapping:
| # | Requirement | Test Cases | Additional Evidence |
|---|------------|------------|---------------------|
| 1 | NL queries | All chat tests | Chat UI screenshot |
| 2 | 3+ tools | market_data + portfolio + compliance | Tool list in code |
| 3 | Structured results | All tool tests | Response JSON samples |
| 4 | Synthesized responses | All chat tests | Response text samples |
| 5 | Conversation history | session-memory tests | Multi-turn screenshot |
| 6 | Error handling | agent-error tests | Error response samples |
| 7 | Domain verification | compliance tests | Compliance report sample |
| 8 | 5+ test cases | mvp-eval.spec.ts | Test output (≥12 cases) |
| 9 | Deployed + accessible | Ghostfolio URL | URL + screenshot |

## UX Script

N/A — this is a validation and documentation story.

## Preconditions

- [ ] US-003 through US-006 all complete
- [ ] All 3 tools deployed and working
- [ ] Memory and error handling deployed
- [ ] LangSmith project active

## TDD Plan

This story creates the Layer 5 production eval suite using the Gauntlet 5-stage eval maturity framework (Stages 1+2).

**Framework:** Deterministic binary checks (no LLM judge). 20 golden test cases in YAML with 3 checks each (tool_selection, content_validation, negative_validation).

### Layer 5 — Production eval (≥20 cases): `evals/golden-data.yaml` + `evals/eval-runner.ts`

**Market data queries (5):**

1. `gs-001` Single symbol (AAPL) → `market_data_fetch`, must contain "AAPL"
2. `gs-002` Multi symbol (MSFT, GOOGL) → `market_data_fetch`, must contain both
3. `gs-003` Crypto (BTC-USD) → `market_data_fetch`, must contain "BTC"
4. `gs-004` Invalid symbol (XYZNOTREAL) → `market_data_fetch`, must contain "XYZNOTREAL"
5. `gs-005` Edge symbol (BRK.B) → `market_data_fetch`, must contain "BRK"

**Portfolio analysis queries (5):**

6. `gs-006` Concentration risk → `portfolio_risk_analysis`
7. `gs-007` Allocation breakdown → `portfolio_risk_analysis`
8. `gs-008` Empty portfolio → `portfolio_risk_analysis`
9. `gs-009` Single holding diversification → `portfolio_risk_analysis`
10. `gs-010` Performance/returns → `portfolio_risk_analysis`

**Compliance queries (5):**

11. `gs-011` Full ESG check → `compliance_check`
12. `gs-012` Fossil fuel flag → `compliance_check`
13. `gs-013` Category filter (tobacco) → `compliance_check`
14. `gs-014` Clean portfolio → `compliance_check`
15. `gs-015` Source attribution → `compliance_check`

**Multi-turn conversations (3):**

16. `gs-016` Tool switching (market → portfolio, 2 turns)
17. `gs-017` Follow-up question (MSFT → GOOGL, 2 turns)
18. `gs-018` Error recovery (empty → valid, 2 turns)

**Error recovery (2):**

19. `gs-019` Empty message → "provide a message"
20. `gs-020` 10K character input → no 500 error

### Eval runner logic tests: `evals/eval-runner.spec.ts`

25 Jest tests covering: YAML parsing, tool selection check, content validation, negative validation, summary computation, coverage matrix.

### Validation sequence

1. Run eval-runner.spec.ts locally → all pass.
2. Run standalone eval runner against local dev → print results + coverage matrix.
3. Run standalone eval runner against production → ≥80% pass rate.

## Step-by-step Implementation Plan

1. Install `js-yaml` dev dependency.
2. Create `apps/api/src/app/agent/evals/types.ts` — interfaces for eval cases and results.
3. Create `apps/api/src/app/agent/evals/golden-data.yaml` — 20 golden test cases.
4. Write failing `apps/api/src/app/agent/evals/eval-runner.spec.ts` — tests for eval logic (RED).
5. Implement `apps/api/src/app/agent/evals/eval-runner.ts` — deterministic eval runner (GREEN).
6. Create `apps/api/src/app/agent/evals/README.md` — usage docs.
7. Update `CLAUDE.md` Layer 5 section.
8. Run eval-runner.spec.ts locally → all pass.
9. Run standalone eval runner against local dev → print results + coverage matrix.
10. Run standalone eval runner against production → ≥80% pass rate.
11. Create MVP-EVIDENCE.md with results.

## Implementation Details

Implemented files:

1. `apps/api/src/app/agent/evals/types.ts` — 6 interfaces (AgentChatResponse, EvalTurn, GoldenCase, GoldenDataFile, EvalResult, EvalSummary)
2. `apps/api/src/app/agent/evals/golden-data.yaml` — 20 golden cases across 5 categories
3. `apps/api/src/app/agent/evals/eval-runner.ts` — standalone eval runner with binary checks
4. `apps/api/src/app/agent/evals/eval-runner.spec.ts` — 25 Jest tests for eval logic
5. `apps/api/src/app/agent/evals/README.md` — usage documentation

## Acceptance Criteria

- [ ] AC1: `golden-data.yaml` contains ≥20 cases (5 market, 5 portfolio, 5 compliance, 3 multi-turn, 2 error).
- [ ] AC2: `eval-runner.spec.ts` passes (tests parsing, tool check, content check, negative check, summary, matrix).
- [ ] AC3: Standalone eval runner runs against production and prints results + coverage matrix.
- [ ] AC4: Overall pass rate ≥80% on production.
- [ ] AC5: Coverage matrix has no completely empty rows.
- [ ] AC6: CLAUDE.md Layer 5 section updated to reflect 5-stage framework.

## Local Validation

```bash
# Eval runner logic tests (fast, no server)
npx dotenv-cli -e .env.example -- npx nx test api --testPathPattern="agent/evals/eval-runner"

# Run evals against local
EVAL_ACCESS_TOKEN=<token> npx tsx apps/api/src/app/agent/evals/eval-runner.ts

# Run evals against production
EVAL_ACCESS_TOKEN=<token> \
EVAL_BASE_URL=https://ghostfolio-production-e8d1.up.railway.app \
npx tsx apps/api/src/app/agent/evals/eval-runner.ts

# Full test suite (should still pass)
npx nx test api
```

## Deployment Handoff (Mandatory)

1. Commit eval suite and MVP-EVIDENCE.md.
2. Push to `main`.
3. Record final results in Checkpoint Result.

## How To Verify In Prod (Required)

- Production URL(s):
  - Ghostfolio: `https://ghostfolio-production-e8d1.up.railway.app`
  - Chat page: `https://ghostfolio-production-e8d1.up.railway.app/agent`
- Expected results:
  - Eval suite ≥80% pass rate on production
  - Each MVP requirement has evidence
  - LangSmith traces visible for eval run
  - Chat UI works for all manual scenarios
- Failure signals:
  - Pass rate <80%
  - Any MVP requirement has zero evidence
  - Missing LangSmith traces
- Rollback action:
  - N/A (eval is read-only; fix failing tests by fixing underlying issues)

## User Checkpoint Test

1. Run `npx nx test api --testPathPattern=mvp-eval` against prod → see pass/fail.
2. Open Ghostfolio `/agent` → manually run through all 5 verification scenarios.
3. Open LangSmith → verify traces for eval run.
4. Read MVP-EVIDENCE.md → all 9 requirements have evidence.

## Checkpoint Result

_(Fill after deployment.)_

- Commit SHA:
- Ghostfolio URL:
- Eval pass rate:
- User Validation: `passed | failed | blocked`
- Notes:

## Observability & Monitoring

- Logs to check:
  - Eval test output
  - Railway Ghostfolio logs during eval
- Traces/metrics to check:
  - LangSmith: all traces from eval run
  - LangSmith: latency and token usage
- Alert thresholds:
  - N/A (one-time validation)

## Risks & Edge Cases

- Risk 1: Flaky tests from LLM non-determinism (mitigate: pattern matching)
- Risk 2: Yahoo Finance or Ghostfolio intermittently down during eval
- Edge case 1: Production env differs from local
- Edge case 2: Rate limiting from repeated eval runs

## Notes

- This is the final MVP gate story. Once it passes, MVP is complete.
- Test cases use pattern matching for LLM non-determinism.
- Eval suite becomes the foundation for 50-case dataset in Phase 3.
- All tests run within Ghostfolio's Jest infrastructure via Nx.

## MVP Requirements Checklist

_(Fill during execution.)_
| # | Requirement | Evidence | Status |
|---|------------|----------|--------|
| 1 | Agent responds to NL queries | | |
| 2 | ≥3 functional tools | | |
| 3 | Tools return structured results | | |
| 4 | Agent synthesizes results | | |
| 5 | Conversation history | | |
| 6 | Basic error handling | | |
| 7 | Domain verification check | | |
| 8 | 5+ test cases | | |
| 9 | Deployed + accessible | | |
