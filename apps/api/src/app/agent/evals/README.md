# Agent Eval Framework

Deterministic eval framework for the Ghostfolio AI agent. Implements Stages 1+2 of the Gauntlet 5-stage eval maturity framework.

## Quick Start

```bash
# Run eval runner tests (tests the runner's own logic, no server needed)
npx dotenv-cli -e .env.example -- npx nx test api --testPathPattern="agent/evals/eval-runner"

# Run evals against local dev server
EVAL_ACCESS_TOKEN=<your-token> npx tsx apps/api/src/app/agent/evals/eval-runner.ts

# Run evals against production
EVAL_ACCESS_TOKEN=<your-token> \
EVAL_BASE_URL=https://ghostfolio-production-e8d1.up.railway.app \
npx tsx apps/api/src/app/agent/evals/eval-runner.ts
```

## Environment Variables

| Variable            | Required | Default                 | Description                                                        |
| ------------------- | -------- | ----------------------- | ------------------------------------------------------------------ |
| `EVAL_ACCESS_TOKEN` | Yes      | —                       | Plain access token for a Ghostfolio user (used for anonymous auth) |
| `EVAL_BASE_URL`     | No       | `http://localhost:3333` | Base URL of the Ghostfolio API server                              |

## Architecture

### Stage 1: Golden Sets (current)

- 20 deterministic test cases in `golden-data.yaml`
- 3 binary checks per case: tool selection, content validation, negative validation
- No LLM judge — all checks are code-based
- Run on every commit (via Jest spec) and pre-deploy (via standalone runner)

### Stage 2: Labeled Scenarios (current)

- Same cases as Stage 1, with labels: `category`, `subcategory`, `difficulty`
- Labels power the coverage matrix — shows where to write tests next
- Run on every release

### Stages 3-5 (planned, not yet implemented)

- **Stage 3**: Replay harnesses — record real sessions as JSON, replay with ML metrics
- **Stage 4**: Rubrics — multi-dimensional scored eval with LLM judge
- **Stage 5**: Experiments — A/B test prompt/model changes

## Adding a New Golden Case

1. Open `golden-data.yaml`
2. Add a new case following the schema:

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

3. Run the eval runner to verify
4. **Never change expected output just to make tests pass** — fix the agent instead

## Coverage Matrix

After each run, the runner prints a coverage matrix:

```
                 | market_data | portfolio | compliance | multi_turn | error_recovery |
straightforward  |    3/3      |   3/3     |    3/3     |    --      |      --        |
ambiguous        |    --       |   1/1     |    2/2     |    2/2     |      --        |
edge_case        |    2/2      |   1/1     |    --      |    1/1     |      2/2       |
```

Empty cells indicate coverage gaps — write cases to fill them.

## Files

| File                  | Purpose                                             |
| --------------------- | --------------------------------------------------- |
| `golden-data.yaml`    | 20 golden test cases (Stage 1+2)                    |
| `types.ts`            | TypeScript interfaces                               |
| `eval-runner.ts`      | Standalone eval runner + exportable check functions |
| `eval-runner.spec.ts` | Jest tests for runner logic                         |
| `README.md`           | This file                                           |

## Design Docs

- `docs/agentforge/plans/2026-02-24-eval-framework-stage1-stage2-design.md` — Gauntlet 5-stage approach
- `docs/agentforge/plans/2026-02-24-eval-framework-implementation.md` — Implementation plan
