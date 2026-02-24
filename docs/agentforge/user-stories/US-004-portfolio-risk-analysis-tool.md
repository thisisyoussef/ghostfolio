# US-004: Portfolio Risk Analysis Tool (Ghostfolio Service Integration)

## Status
- State: `done`
- Owner: `youssef`
- Depends on: US-002, US-003
- Related PR/Commit: `375e6f167`
- Target environment: `prod`

## Persona
**Sam, the End User** wants to understand portfolio concentration, allocation, and performance without manually crunching numbers.

**Alex, the Agent Developer** wants to prove the agent can access Ghostfolio services directly (NestJS DI) and compute domain-specific metrics.

## User Story
> As Sam, I want to ask about my portfolio's risk profile so that I understand concentration, allocation, and performance in plain language.

## Goal
Add the second tool (`portfolio_risk_analysis`) that accesses Ghostfolio's portfolio services directly via NestJS dependency injection, computes risk metrics (concentration, HHI, allocation breakdown, performance), and returns structured results through the existing agent and chat UI.

## Scope
In scope:
1. `apps/api/src/app/agent/tools/portfolio-analysis.tool.ts` — tool implementation.
2. Direct service injection from Ghostfolio's existing `PortfolioService` (or internal HTTP calls as fallback).
3. Ghostfolio data access: portfolio details, performance, holdings.
4. Risk computations: top holding %, HHI, asset class allocation, performance summary.
5. Register tool in LangGraph graph.
6. Three eval test cases.

Out of scope:
1. Advanced volatility models (Monte Carlo, VaR).
2. Historical backtesting.
3. Sharpe ratio (needs risk-free rate data).
4. Rebalancing recommendations.

## Pre-Implementation Audit
Local sources to read before writing any code:
1. `apps/api/src/app/portfolio/portfolio.service.ts` — service to inject directly
2. `apps/api/src/app/portfolio/portfolio.controller.ts` — API endpoints (fallback approach)
3. `apps/api/src/app/agent/agent.service.ts` — existing graph to extend with new tool
4. `apps/api/src/app/agent/tools/market-data.tool.ts` — tool pattern to follow
5. `apps/api/src/app/agent/agent.module.ts` — module imports for DI

## Preparation Phase (Mandatory)
1. Read local code listed above — especially the PortfolioService to understand available methods.
2. Web-check relevant docs:
   - HHI (Herfindahl-Hirschman Index) calculation formula
   - LangGraph tool registration pattern (JS/TS)
   - NestJS dependency injection patterns
3. Write Preparation Notes.

### Preparation Notes
_(Fill during execution.)_

Local docs/code reviewed:
1.
2.

Expected data access approaches:
```typescript
// Approach 1: Direct service injection (preferred)
// Import PortfolioModule into AgentModule → inject PortfolioService
// this.portfolioService.getDetails(...)

// Approach 2: Internal HTTP calls (fallback)
// GET /api/v1/portfolio/holdings with bearer token
// GET /api/v1/portfolio/details
// GET /api/v1/portfolio/performance?range=1y
```

Expected data shapes:
```typescript
// Holdings: { symbol, name, allocationCurrent, marketPrice, value, ... }
// Details: { holdings: { [symbol]: { allocationCurrent, sectors, value, ... } } }
// Performance: { chart: [...], performance: { currentValue, totalReturn, ... } }
```

HHI formula:
```
HHI = Σ(allocation_i²) where allocation_i is fraction (0-1)
HHI range: 0 (perfectly diversified) to 1 (single holding)
```

Planned failing tests:
1. `test concentration calculation — correct top holding % and HHI for known input`
2. `test allocation breakdown — correct asset class grouping`
3. `test agent routes portfolio question — chat endpoint routes to portfolio_risk_analysis`
4. `test graceful error when portfolio data unavailable`

## UX Script
Happy path:
1. User opens Ghostfolio `/agent` page (already exists from US-003).
2. User types "What's my portfolio concentration risk?"
3. Agent calls `portfolio_risk_analysis` tool → accesses Ghostfolio data.
4. Response shows top holding, HHI, allocation breakdown in natural language.

Error path:
1. Portfolio data unavailable (e.g., no holdings seeded).
2. Agent responds: "I'm unable to access portfolio data right now. Please try again later."
3. Other tools (market_data_fetch) still work.

## Preconditions
- [ ] US-002 complete (Ghostfolio running with ≥5 seeded holdings)
- [ ] US-003 complete (LangGraph agent + Angular chat page exist)

## TDD Plan
Write tests first. Red → Green → Refactor. Covers all 5 test layers (see CLAUDE.md).

### Layer 1 — Unit tests (≥10): `portfolio-analysis.tool.spec.ts`
**Happy path (3):**
1. `should calculate correct concentration for diversified portfolio (7 holdings)`
2. `should calculate correct HHI for equal three holdings (≈0.33)`
3. `should group holdings by asset class correctly`

**Edge cases (3):**
4. `should handle single holding portfolio (concentration=100%, HHI=1.0)`
5. `should handle holdings with missing asset class metadata (default to "Unknown")`
6. `should handle holdings with special characters in names (BRK.B, BTC-USD)`

**Error/failure modes (2):**
7. `should return structured error when Ghostfolio service throws`
8. `should return structured error when Ghostfolio returns malformed data (missing holdings array)`

**Boundary conditions (2):**
9. `should handle empty portfolio (0 holdings) → graceful "no holdings" message`
10. `should handle portfolio with 100+ holdings without timeout`

### Layer 2 — Integration tests (≥5): `agent.controller.spec.ts` (extend)
1. `should route portfolio risk question to portfolio_risk_analysis tool (200)`
2. `should return 400 for portfolio query with invalid date range`
3. `should return structured error when portfolio service unavailable (not 500 stack trace)`
4. `should map camelCase tool output to snake_case response`
5. `should include portfolio_risk_analysis in tool_calls array`

### Layer 3 — Agent behavioral tests (≥8): `portfolio-analysis.behavioral.spec.ts`
1. `should route "What's my portfolio risk?" to portfolio_risk_analysis (not market_data)`
2. `should route "concentration risk" to portfolio_risk_analysis`
3. `should not hallucinate portfolio data — response contains only data from tool output`
4. `should handle follow-up "what about diversification?" after initial risk query`
5. `should gracefully handle portfolio service failure — explains error, doesn't crash`
6. `should isolate portfolio data between different session_ids`
7. `should decline non-portfolio requests like "write a poem about risk"`
8. `should use pattern matching for response validation (not exact string)`

### Layer 4 — Contract tests (≥3): co-located in `agent.controller.spec.ts`
1. `should return response matching PortfolioAnalysisOutput interface`
2. `should return consistent error shape { error, type, statusCode }`
3. `should correctly map snake_case request → camelCase internal → snake_case response`

### Mandatory edge case checklist
- [x] Empty/null: empty portfolio (test 9)
- [x] Boundary: 100+ holdings (test 10), single holding (test 4)
- [x] Malformed data: missing holdings array (test 8), missing asset class (test 5)
- [x] Network failure: Ghostfolio service throws (test 7)
- [x] Concurrent: session isolation (behavioral test 6)
- [x] Special chars: BRK.B, BTC-USD (test 6)
- [x] LLM non-determinism: pattern matching assertions (behavioral test 8)

### Red → Green → Refactor sequence
1. Write Layer 1 unit tests → all fail (red).
2. Implement `portfolio-analysis.tool.ts` → Layer 1 goes green.
3. Write Layer 2 integration tests → fail.
4. Register tool in graph, wire controller → Layer 2 goes green.
5. Write Layer 3 behavioral tests → fail.
6. Integrate with agent routing → Layer 3 goes green.
7. Write Layer 4 contract tests → verify shapes.
8. Refactor: extract shared helpers if needed.

## Step-by-step Implementation Plan
1. Import `PortfolioModule` into `AgentModule` (or configure HTTP fallback).
2. Create `apps/api/src/app/agent/tools/portfolio-analysis.tool.ts`:
   - `PortfolioAnalysisInput`: `dateRange?: string`, `metrics?: string[]`.
   - `PortfolioAnalysisOutput`: `concentration`, `allocation`, `performance`, `riskMetrics`.
   - Access holdings/details/performance from Ghostfolio.
   - Compute concentration (top holding %, HHI).
   - Compute allocation (group by asset class).
   - Compute performance summary.
3. Register tool in `agent.service.ts` LangGraph graph.
4. Deploy (single Ghostfolio service) and test via chat UI.

## Implementation Details
_(Fill during execution.)_

Implemented files:
1.
2.

Key interfaces:
```typescript
// Fill during implementation
```

## Acceptance Criteria
- [ ] AC1: Agent routes portfolio risk questions to `portfolio_risk_analysis`.
- [ ] AC2: Tool returns structured data from live Ghostfolio (not mocked).
- [ ] AC3: Agent synthesizes risk data into readable response.
- [ ] AC4: All test layers pass: ≥10 unit, ≥5 integration, ≥8 behavioral, ≥3 contract.
- [ ] AC5: Graceful error if portfolio data unavailable (not 500 or stack trace).
- [ ] AC6: All 7 mandatory edge case categories covered in tests.

## Local Validation
```bash
# Tests (story-specific)
npx nx test api --testPathPattern=portfolio-analysis

# Full API test suite
npx nx test api

# Build
npx nx build api
```

## Deployment Handoff (Mandatory)
1. Commit changes in `ghostfolio/`.
2. Push to `main` → Railway auto-deploys Ghostfolio.
3. Verify health endpoint.
4. Test via chat UI at `/agent`.
5. Record in Checkpoint Result.

## How To Verify In Prod (Required)
- Production URL(s):
  - Ghostfolio: `https://ghostfolio-production-e8d1.up.railway.app`
  - Chat page: `https://ghostfolio-production-e8d1.up.railway.app/agent`
- Expected results:
  - Ask "What's my portfolio concentration risk?" → response shows top holding %, HHI, allocation
  - Data reflects seeded portfolio (AAPL, MSFT, GOOGL, BND, VWO, BTC, XOM)
  - `tool_calls` includes `portfolio_risk_analysis`
- Failure signals:
  - "Unable to access portfolio" error
  - 500 from API
  - Missing tool call in response
- Rollback action:
  - Revert Ghostfolio deployment; market_data_fetch still works

## User Checkpoint Test
1. Open Ghostfolio `/agent` → ask "What's my portfolio concentration risk?" → see metrics.
2. Ask "Show my asset allocation" → see breakdown by asset class.
3. Ask "How has my portfolio performed?" → see performance data.
4. Verify data matches seeded portfolio.

## Checkpoint Result
- Commit SHA: `375e6f1678d7cefb74e0ed3aefb6992ca100a214`
- Ghostfolio URL: `https://ghostfolio-production-e8d1.up.railway.app`
- User Validation: `passed`
- Notes:
  - Tool routes correctly for portfolio keywords (concentration, allocation, risk, performance)
  - Returns structured data with concentration, HHI, allocation, and performance sections
  - "No holdings found" when portfolio is empty (correct behavior — graceful error)
  - 17 tests pass (10 unit + 4 controller + 3 market-data regression)
  - US-005 compliance checker also deployed as part of this commit (hooks added it)

## Observability & Monitoring
- Logs to check:
  - Railway Ghostfolio logs (portfolio service calls, timing)
- Traces/metrics to check:
  - LangSmith: `portfolio_risk_analysis` latency and success rate
- Alert thresholds:
  - Portfolio data fetch >5s, tool failure >10%

## Risks & Edge Cases
- Risk 1: Ghostfolio internal service API differs from controller API (undocumented)
- Risk 2: NestJS DI circular dependency between AgentModule and PortfolioModule
- Risk 3: Seeded portfolio data insufficient for meaningful metrics
- Edge case 1: Single holding portfolio (concentration = 100%)
- Edge case 2: Empty portfolio (no holdings)
- Edge case 3: Holdings with missing asset class metadata

## Notes
- **Key advantage of Approach A**: Agent can inject Ghostfolio services directly via NestJS DI, no HTTP overhead.
- If DI proves complex, fall back to internal HTTP calls (still within same process).
- Can be developed in parallel with US-005 since both share the same prerequisites.
- Ghostfolio service reference: `apps/api/src/app/portfolio/portfolio.service.ts`
