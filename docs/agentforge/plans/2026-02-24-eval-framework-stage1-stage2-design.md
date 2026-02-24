# Design: Gauntlet 5-Stage Eval Framework (Stages 1 + 2)

**Date:** 2026-02-24
**Status:** Approved
**Author:** Youssef + Claude
**Depends on:** US-003, US-004, US-005 (tools implemented)
**Affects:** US-007 (rewrite), CLAUDE.md Layer 5

## Problem

Layer 5 (Production Eval) is entirely documentation — zero actual eval code exists. No golden data files, no eval runners, no fixtures. The existing US-007 spec describes 20 test cases as Jest tests, but references non-existent files (evals/ directory, eval-runner.ts, LangSmith SDK).

The Gauntlet "Evals That Actually Work" lecture defines a 5-stage eval maturity framework. We adopt Stages 1 and 2 now, and restructure US-007 accordingly.

## Architecture Decisions

### AD-1: Standalone script + Jest wrapper (Option A)

The eval runner is a **standalone TypeScript script** (`eval-runner.ts`) runnable via `npx tsx`. A separate **Jest spec** (`eval-runner.spec.ts`) tests the runner's internal logic (parsing, check functions) using mocked HTTP responses.

**Why not Jest-only?** Eval runs are slow (20+ HTTP calls, auth flow). They shouldn't pollute the fast Jest suite that runs on every commit. The standalone script can target any URL (local, staging, prod) trivially.

**Why not script-only?** We need confidence that the runner's own parsing and checking logic is correct. Jest tests for the runner give us that.

### AD-2: Deterministic binary checks only (no LLM judge)

All checks are code evals — pass/fail, no scoring:

- **Tool selection**: Did the expected tools appear in `tool_calls[].name`?
- **Content validation**: Does response contain all `must_contain` strings? (case-insensitive)
- **Negative validation**: Does response NOT contain any `must_not_contain` strings?

LLM-as-judge is reserved for Stage 4 (future).

### AD-3: Auth via anonymous login flow

The eval runner authenticates by calling `POST /api/auth/anonymous` with a user's access token to obtain a JWT. Env vars:

- `EVAL_BASE_URL` — server URL (default: `http://localhost:3333`)
- `EVAL_ACCESS_TOKEN` — plain access token for anonymous auth

### AD-4: Multi-turn cases are routing-only (no session memory yet)

Session memory (US-006) is not yet implemented. Multi-turn cases test that sequential queries to the same `session_id` route correctly to different tools. They do NOT test context retention. This is documented as a known limitation.

### AD-5: YAML over JSON for golden data

YAML is more readable for human-authored test cases with multi-line strings. The eval runner parses it at runtime via `js-yaml`.

## Golden Data Format

```yaml
version: '1.0'
stage: 2

cases:
  # Single-turn case
  - id: 'gs-001'
    query: 'What is the current price of AAPL?'
    category: 'market_data'
    subcategory: 'single_symbol'
    difficulty: 'straightforward'
    expected_tools: ['market_data_fetch']
    must_contain: ['AAPL']
    must_not_contain: ['unable to', "I don't know"]

  # Multi-turn case
  - id: 'gs-016'
    turns:
      - query: 'What is the price of AAPL?'
        expected_tools: ['market_data_fetch']
        must_contain: ['AAPL']
        must_not_contain: []
      - query: 'Now check my portfolio risk'
        expected_tools: ['portfolio_risk_analysis']
        must_contain: ['Portfolio']
        must_not_contain: []
    category: 'multi_turn'
    subcategory: 'tool_switching'
    difficulty: 'ambiguous'
```

## 20 Golden Cases

| ID     | Category       | Subcategory            | Difficulty      | Query Summary                |
| ------ | -------------- | ---------------------- | --------------- | ---------------------------- |
| gs-001 | market_data    | single_symbol          | straightforward | Price of AAPL                |
| gs-002 | market_data    | multi_symbol           | straightforward | Price of MSFT and GOOGL      |
| gs-003 | market_data    | crypto                 | straightforward | Price of BTC-USD             |
| gs-004 | market_data    | invalid_symbol         | edge_case       | Price of XYZNOTREAL          |
| gs-005 | market_data    | edge_symbol            | edge_case       | Price of BRK.B               |
| gs-006 | portfolio      | risk_summary           | straightforward | Portfolio concentration risk |
| gs-007 | portfolio      | allocation             | straightforward | Asset allocation breakdown   |
| gs-008 | portfolio      | empty_portfolio        | edge_case       | Portfolio risk (empty)       |
| gs-009 | portfolio      | single_holding         | ambiguous       | Portfolio with one holding   |
| gs-010 | portfolio      | diversification        | straightforward | Diversification assessment   |
| gs-011 | compliance     | full_check             | straightforward | Full ESG compliance check    |
| gs-012 | compliance     | specific_flag          | straightforward | Flag XOM fossil fuels        |
| gs-013 | compliance     | category_filter        | ambiguous       | Filter by fossil fuels only  |
| gs-014 | compliance     | clean_portfolio        | straightforward | Clean portfolio check        |
| gs-015 | compliance     | source_attribution     | ambiguous       | ESG source/dataset version   |
| gs-016 | multi_turn     | tool_switching         | ambiguous       | Market data then portfolio   |
| gs-017 | multi_turn     | context_retention      | ambiguous       | Follow-up question           |
| gs-018 | multi_turn     | error_recovery_context | edge_case       | Error then retry             |
| gs-019 | error_recovery | empty_message          | edge_case       | Empty string input           |
| gs-020 | error_recovery | long_input             | edge_case       | 10K character input          |

## Coverage Matrix (Target)

```
                 | market_data | portfolio | compliance | multi_turn | error_recovery |
straightforward  |    3/3      |   3/3     |    3/3     |    --      |      --        |
ambiguous        |    --       |   1/1     |    2/2     |    2/2     |      --        |
edge_case        |    2/2      |   1/1     |    --      |    1/1     |      2/2       |
```

## File Structure

```
apps/api/src/app/agent/evals/
├── golden-data.yaml          # 20 golden cases (Stage 1+2 format)
├── types.ts                  # TypeScript interfaces for eval cases and results
├── eval-runner.ts            # Standalone eval script (npx tsx)
├── eval-runner.spec.ts       # Jest tests for eval logic (mocked HTTP)
└── README.md                 # How to run, add cases, interpret results
```

## Eval Runner Flow

```
1. Read golden-data.yaml → parse cases
2. Authenticate: POST /api/auth/anonymous → get JWT
3. For each case:
   a. POST /api/v1/agent/chat with { message, session_id }
   b. Check tool_selection: expected_tools vs actual tool_calls
   c. Check content_validation: must_contain substrings present
   d. Check negative_validation: must_not_contain substrings absent
   e. Record EvalResult { passed, checks, duration_ms }
4. Print summary table (per-case pass/fail)
5. Print coverage matrix (category x difficulty)
6. Exit with code 0 if >=80% pass, 1 otherwise
```

## Modified Files

- **CREATE:** `apps/api/src/app/agent/evals/golden-data.yaml`
- **CREATE:** `apps/api/src/app/agent/evals/types.ts`
- **CREATE:** `apps/api/src/app/agent/evals/eval-runner.ts`
- **CREATE:** `apps/api/src/app/agent/evals/eval-runner.spec.ts`
- **CREATE:** `apps/api/src/app/agent/evals/README.md`
- **MODIFY:** `CLAUDE.md` (Layer 5 section)
- **MODIFY:** `docs/agentforge/user-stories/US-007-mvp-eval-suite.md`

## Not Building (Stages 3-5)

- **Stage 3 (Replay Harnesses):** Record real sessions as JSON, replay with ML metrics
- **Stage 4 (Rubrics):** Multi-dimensional scored eval with LLM judge + calibration
- **Stage 5 (Experiments):** A/B test prompt/model changes with same test set

## Dependencies

- `js-yaml` — YAML parser (dev dependency, needed for eval runner)
- No LangSmith SDK
- No new production dependencies
