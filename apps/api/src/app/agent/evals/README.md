# Agent Eval Suite

Production eval harness using LangSmith. Runs 20 test cases against the live agent API and scores each on a 0-1 rubric.

## Quick Start

```bash
cd ghostfolio

# Required env vars
export LANGSMITH_API_KEY=<your-key>
export TEST_SECURITY_TOKEN=<your-token>
export EVAL_BASE_URL=https://ghostfolio-production-e8d1.up.railway.app

# Run evals
npx tsx apps/api/src/app/agent/evals/eval-runner.ts
```

Results appear in the [LangSmith dashboard](https://smith.langchain.com/) under experiment `ghostfolio-agent-eval`.

## Authentication

The agent API requires JWT authentication. The eval runner automatically exchanges `TEST_SECURITY_TOKEN` for a JWT bearer token via `GET /api/v1/auth/anonymous/{token}`. The JWT is cached for the duration of the eval run.

## Eval Cases (20 total)

| Category | Count | Description |
|----------|-------|-------------|
| Market Data | 5 | Price queries, multi-symbol, crypto, invalid symbol |
| Portfolio | 5 | Risk, allocation, concentration, performance, diversification |
| Compliance | 5 | ESG check, category filters, score queries |
| Multi-turn | 3 | Context carryover, tool switching, follow-up |
| Error | 2 | Empty input, out-of-scope request |

## Evaluators (Rubric Scoring)

| Evaluator | Scores | Description |
|-----------|--------|-------------|
| `tool_selection` | 0 or 1 | Correct tool invoked? |
| `data_accuracy` | 0-1 | Expected patterns found in response? |
| `response_quality` | 0-1 | Well-formed, no errors, reasonable length? |
| `no_hallucination` | 0-1 | Dollar amounts traceable to tool output? |
| `overall_pass_rate` | 0-1 | Summary: % of cases with avg score > 0.7 |

## CI Gate

The eval runner exits with code 1 if the overall pass rate is below 80%. This can be used as a deployment gate.

## Adding Eval Cases

Edit `dataset.ts` and add cases to the appropriate category array. Each case needs:
- `inputs`: `{ message, session_id }`
- `outputs`: `{ expectedTool, expectedPatterns, category }`

The runner re-seeds the dataset on every run, so changes take effect immediately.

## Design Doc

See `docs/plans/2026-02-24-agent-eval-harness-design.md` for architecture and rationale.
