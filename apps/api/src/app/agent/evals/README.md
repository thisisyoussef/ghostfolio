# Agent Eval Framework

Two-tier eval harness for the Ghostfolio AI agent. Both tiers use **deterministic binary checks** (no LLM-as-judge).

## Quick Start

### Tier 1: Standalone Runner (fast, no external deps)

```bash
# Run eval runner tests (tests the runner's own logic, no server needed)
npx dotenv-cli -e .env.example -- npx jest --testPathPatterns="evals/" --no-coverage

# Run evals against production
EVAL_ACCESS_TOKEN=<your-token> \
EVAL_BASE_URL=https://ghostfolio-production-e8d1.up.railway.app \
npx tsx apps/api/src/app/agent/evals/eval-runner.ts
```

### Tier 2: LangSmith Runner (dashboard + tracing)

```bash
LANGSMITH_API_KEY=<your-key> \
EVAL_ACCESS_TOKEN=<your-token> \
EVAL_BASE_URL=https://ghostfolio-production-e8d1.up.railway.app \
npx tsx apps/api/src/app/agent/evals/eval-runner-langsmith.ts
```

Results appear in the [LangSmith dashboard](https://smith.langchain.com/) under experiment `ghostfolio-agent-eval-*`.

## Architecture

```
golden-data.yaml (single source of truth — 20 cases)
       │
       ├── eval-runner.ts ──────────► Console output (Tier 1: fast/local)
       │     Binary pass/fail checks
       │     No external dependencies
       │     Run: every commit, CI gate
       │
       └── dataset.ts (adapter) ───► eval-runner-langsmith.ts ──► LangSmith dashboard (Tier 2)
              Transforms YAML             Same deterministic checks
              → LangSmith format          + traceable() tracing
                                          + experiment history
                                          Run: pre-deploy, comparisons
```

**Key principle**: LangSmith is the platform (tracking, dashboard, tracing), NOT the judge. All evaluators are pure deterministic code.

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `EVAL_ACCESS_TOKEN` | Yes (both tiers) | — | Ghostfolio access token for anonymous auth |
| `EVAL_BASE_URL` | No | `http://localhost:3333` | Base URL of the Ghostfolio API |
| `LANGSMITH_API_KEY` | Yes (Tier 2 only) | — | LangSmith API key |

## Evaluators (Deterministic Binary)

Both tiers run the same 3 checks per case:

| Check | What it does | Pass (1) | Fail (0) |
|-------|-------------|----------|----------|
| `tool_selection` | Expected tool in `tool_calls`? | Right tool called | Wrong/no tool |
| `content_validation` | All `must_contain` in response? | All patterns found | Missing pattern |
| `negative_validation` | No `must_not_contain` in response? | Clean response | Forbidden pattern found |

Gate: ≥80% of cases must pass all 3 checks.

## Eval Cases (20 total)

| Category | Count | Description |
|----------|-------|-------------|
| Market Data | 5 | Price queries, multi-symbol, crypto, invalid symbol, edge symbol |
| Portfolio | 5 | Risk, allocation, concentration, performance, diversification |
| Compliance | 5 | ESG check, category filters, score queries, source attribution |
| Multi-turn | 3 | Context carryover, tool switching, error recovery |
| Error Recovery | 2 | Empty input, long input |

## Adding a New Golden Case

1. Edit `golden-data.yaml`:

```yaml
- id: 'gs-021'
  query: 'Your test query here'
  category: 'market_data'
  subcategory: 'new_scenario'
  difficulty: 'straightforward'
  expected_tools: ['market_data_fetch']
  must_contain: ['expected substring']
  must_not_contain: ['failure indicator']
```

2. Run tests: `npx jest --testPathPatterns="evals/" --no-coverage`
3. Run eval against prod to verify
4. **Never change expected output just to make tests pass** — fix the agent

## Coverage Matrix

After each Tier 1 run, the runner prints:

```
                 | market_data | portfolio | compliance | multi_turn | error_recovery |
straightforward  |    3/3      |   3/3     |    3/3     |    --      |      --        |
ambiguous        |    --       |   1/1     |    2/2     |    2/2     |      --        |
edge_case        |    2/2      |   1/1     |    --      |    1/1     |      2/2       |
```

Empty cells = coverage gaps. Write cases to fill them.

## Files

| File | Purpose |
|------|---------|
| `golden-data.yaml` | 20 golden test cases (single source of truth) |
| `types.ts` | Shared TypeScript interfaces |
| `eval-runner.ts` | Tier 1: standalone deterministic runner |
| `eval-runner.spec.ts` | Jest tests for Tier 1 runner (25 tests) |
| `dataset.ts` | Adapter: golden-data.yaml → LangSmith format |
| `dataset.spec.ts` | Jest tests for adapter (12 tests) |
| `langsmith-evaluators.ts` | Deterministic evaluators in LangSmith shape |
| `langsmith-evaluators.spec.ts` | Jest tests for evaluators (16 tests) |
| `target.ts` | `traceable()` HTTP wrapper for LangSmith tracing |
| `eval-runner-langsmith.ts` | Tier 2: LangSmith runner with dashboard output |
| `README.md` | This file |

## Running Tests

```bash
# All eval tests (53 total)
npx dotenv-cli -e .env.example -- npx jest --testPathPatterns="evals/" --no-coverage

# Just Tier 1 runner tests
npx dotenv-cli -e .env.example -- npx jest --testPathPatterns="eval-runner\\.spec" --no-coverage

# Just adapter + evaluator tests
npx dotenv-cli -e .env.example -- npx jest --testPathPatterns="dataset\\.spec|langsmith-evaluators\\.spec" --no-coverage
```
