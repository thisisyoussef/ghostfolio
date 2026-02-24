# US-003: Agent NestJS Module + Market Data Tool + Angular Chat UI

## Status
- State: `done`
- Owner: `youssef`
- Depends on: US-001
- Related PR/Commit: ghostfolio `ea112a42f` (direct fetch) + `a22cfa042` (webpack external) + `deaaade82` (initial impl)
- Target environment: `prod`

## Persona
**Alex, the Agent Developer** wants to prove the full stack works end-to-end (user question → agent → tool → real data → response) with a testable UI.

**Sam, the End User** wants to ask natural language questions about stock prices and get real answers.

## User Story
> As Sam, I want to ask natural language questions about stock prices through a chat interface so that I get structured financial information without using APIs directly.
> As Alex, I want a working chat UI from day one so that I can manually test every tool as it's built.

## Goal
Deliver the foundational agent stack inside the Ghostfolio fork: new `agent` NestJS module with LangGraph state machine, first tool (`market_data_fetch`), LangSmith tracing, `POST /api/v1/agent/chat` endpoint, and a new Angular chat page. This establishes the pattern every subsequent tool follows and enables manual testing from the browser. Since the agent lives inside Ghostfolio, it deploys as part of the same service.

## Scope
In scope:
1. npm dependencies: `@langchain/langgraph`, `@langchain/anthropic`, `@langchain/core`, `langsmith`, `yahoo-finance2`.
2. New `agent` NestJS module in `apps/api/src/app/agent/`.
3. `market_data_fetch` tool with typed input/output (Zod schemas or TypeScript interfaces).
4. LangGraph `StateGraph` (reasoning → tool → respond).
5. `POST /api/v1/agent/chat` endpoint via `AgentController`.
6. LangSmith tracing via env vars (`LANGSMITH_API_KEY`, `LANGCHAIN_TRACING_V2`).
7. New Angular chat page at `/agent` route in `apps/client/`.
8. Five eval test cases (3 happy, 1 edge, 1 error).

Out of scope:
1. Multiple tools (only market_data_fetch).
2. Conversation memory (single-turn only).
3. Error handling middleware (basic try/catch only).
4. Authentication for agent endpoint (open for MVP).

## Pre-Implementation Audit
Local sources to read before writing any code:
1. `apps/api/src/app/app.module.ts` — root module to register new agent module
2. `apps/api/src/app/health/health.controller.ts` — pattern for simple controller
3. `apps/api/src/app/portfolio/portfolio.controller.ts` — pattern for API endpoints
4. `apps/client/src/app/app-routing.module.ts` — client routing config
5. `apps/client/src/app/pages/` — pattern for new Angular page
6. `ghostfolio/package.json` — existing dependencies, Nx scripts
7. `docs/IMPLEMENTATION_STRATEGY.md` — Phase 1 exit gate and module structure

## Preparation Phase (Mandatory)
1. Read local code listed in Pre-Implementation Audit.
2. Web-check relevant docs before coding:
   - `@langchain/langgraph` JS quickstart and StateGraph API
   - `@langchain/anthropic` ChatAnthropic tool binding (JS)
   - LangSmith tracing setup (env vars for JS/TS)
   - `yahoo-finance2` npm API (`.quote()`, `.quoteSummary()`)
   - NestJS module/controller/service pattern
   - Angular component + routing setup
3. Write Preparation Notes with:
   - Expected `yahoo-finance2` response shape for a ticker
   - LangGraph state schema design (TypeScript)
   - Agent chat endpoint request/response contract
   - Planned failing tests

### Preparation Notes

Local docs/code reviewed:
1. `apps/api/src/app/app.module.ts` — root NestJS module pattern, ~30 existing modules
2. `apps/api/src/app/health/health.controller.ts` — simple controller pattern
3. `apps/api/src/app/endpoints/ai/ai.controller.ts` — existing AI controller pattern
4. `apps/client/src/app/app.routes.ts` — Angular lazy-loaded routing
5. `apps/client/src/app/pages/api/api-page.component.ts` — standalone component pattern

Expected yahoo-finance2 data shape:
```typescript
// yahoo-finance2 v3 API (requires new YahooFinance())
// quote() returns: regularMarketPrice, trailingPE, dividendYield,
// marketCap, fiftyTwoWeekHigh, fiftyTwoWeekLow, shortName, longName
// Returns undefined for invalid symbols (does not throw)
// Note: Requires Node >= 22.0.0 officially; works on 18 with warnings
// Cookie issue in Jest environment - must mock in unit tests
```

Agent chat endpoint contract:
```
POST /api/v1/agent/chat
Request:  {"message": "...", "session_id": "..."}
Response: {"response": "...", "tool_calls": [...], "session_id": "..."}
```

Architecture decision — MVP uses pattern matching (no LLM):
- AgentService extracts ticker symbols via regex pattern matching
- No LangGraph/Anthropic deps needed for MVP (deferred to later story)
- Avoids peer dependency conflicts between @langchain/* packages
- Proves the full stack works: Angular UI → NestJS API → yahoo-finance2 → response

Error-handling decisions:
1. Invalid symbol: yahoo-finance2 returns undefined → caught and returns error message
2. Network failure: try/catch in fetchSingle returns error object per symbol

Planned failing tests (all 5):
1. `market-data.tool.spec.ts: should return price > 0 for valid symbol (AAPL)`
2. `market-data.tool.spec.ts: should return error info for invalid symbol (XYZNOTREAL)`
3. `market-data.tool.spec.ts: should return data for multiple symbols (MSFT, GOOGL)`
4. `agent.controller.spec.ts: should return response with tool call for market question`
5. `agent.controller.spec.ts: should return 200 with error message for empty input`

## UX Script
Happy path:
1. User navigates to `/agent` page in Ghostfolio and sees chat interface.
2. User types "What is the current price of AAPL?" and clicks send.
3. Loading indicator appears.
4. Response shows AAPL price and tool call details (collapsible).
5. User can ask another question.

Error path:
1. User asks about invalid ticker "XYZNOTREAL".
2. Chat shows graceful error: "Could not find data for XYZNOTREAL."
3. User can ask another question without page refresh.

## Preconditions
- [ ] US-001 complete (Ghostfolio fork + Railway deployment exists)
- [ ] `ANTHROPIC_API_KEY` available (for Claude Sonnet)
- [ ] `LANGSMITH_API_KEY` available (for tracing)

## TDD Plan
Write tests first. Red → Green → Refactor.

### Test files to create/modify
1. `apps/api/src/app/agent/tools/market-data.tool.spec.ts`
   - `should return price > 0 for valid symbol (AAPL)`
   - `should return error info for invalid symbol (XYZNOTREAL)`
   - `should return data for multiple symbols (MSFT, GOOGL)`
2. `apps/api/src/app/agent/agent.controller.spec.ts`
   - `should return response with tool call for market question`
   - `should return 200 with error message for empty input`

### Red → Green → Refactor sequence
1. Create test files with all 5 tests. Run `npx nx test api --testPathPattern=agent` — all fail (red).
2. Implement `market-data.tool.ts` → tool tests go green.
3. Implement `agent.service.ts` (LangGraph state machine) and `agent.controller.ts` → controller tests go green.
4. Refactor: extract shared schemas, clean up imports.

## Step-by-step Implementation Plan

### Agent NestJS Module
1. Install npm deps in `ghostfolio/`: `@langchain/langgraph`, `@langchain/anthropic`, `@langchain/core`, `langsmith`, `yahoo-finance2`.
2. Create `apps/api/src/app/agent/agent.module.ts` — NestJS module.
3. Create `apps/api/src/app/agent/tools/market-data.tool.ts`:
   - `MarketDataInput` interface: `symbols: string[]`, `metrics?: string[]`.
   - `MarketDataOutput` interface: per-symbol dict with `price`, `peRatio`, `dividendYield`, `marketCap`, `fiftyTwoWeekRange`.
   - `marketDataFetch` function using `yahoo-finance2`.
   - Handle invalid symbols gracefully.
4. Create `apps/api/src/app/agent/agent.service.ts`:
   - `AgentState` interface with `messages: BaseMessage[]`.
   - Reasoning node (ChatAnthropic with tool binding).
   - Tool execution node.
   - LangGraph `StateGraph` with conditional routing.
5. Create `apps/api/src/app/agent/agent.controller.ts`:
   - `POST /api/v1/agent/chat` accepting `{ message: string, session_id: string }`.
   - Returns `{ response: string, tool_calls: any[], session_id: string }`.
6. Register `AgentModule` in `app.module.ts`.
7. Configure LangSmith env vars on Railway.

### Angular Chat Page
8. Create `apps/client/src/app/pages/agent/` directory:
   - `agent-page.component.ts` — page component.
   - `agent-page.component.html` — chat template (dark theme, input + send, message list).
   - `agent-page.component.scss` — styling.
9. Create `apps/client/src/app/components/chat/` directory:
   - `chat.component.ts` — reusable chat widget.
   - `chat.component.html` — message bubbles, tool call details, loading.
   - `chat.component.scss` — chat styling.
10. Add `/agent` route to client routing module.

### Deploy
11. Commit, push, Railway auto-deploys Ghostfolio (single service).
12. Verify chat UI at `https://<ghostfolio-domain>/agent` and LangSmith traces.

## Implementation Details

Implemented files:
1. `apps/api/src/app/agent/tools/market-data.tool.ts` — MarketDataOutput interface + marketDataFetch function using yahoo-finance2
2. `apps/api/src/app/agent/tools/market-data.tool.spec.ts` — 3 unit tests with yahoo-finance2 mocked
3. `apps/api/src/app/agent/agent.service.ts` — AgentService with pattern-matching symbol extraction + market data lookup
4. `apps/api/src/app/agent/agent.controller.ts` — POST /agent/chat endpoint, maps camelCase ↔ snake_case
5. `apps/api/src/app/agent/agent.controller.spec.ts` — 2 unit tests with AgentService mocked
6. `apps/api/src/app/agent/agent.module.ts` — NestJS module registration
7. `apps/api/src/app/app.module.ts` — Added AgentModule import
8. `apps/client/src/app/pages/agent/agent-page.component.ts` — Angular standalone component
9. `apps/client/src/app/pages/agent/agent-page.html` — Chat UI template
10. `apps/client/src/app/pages/agent/agent-page.scss` — Chat styling
11. `apps/client/src/app/app.routes.ts` — Added /agent route
12. `apps/api/jest.config.ts` — Fixed for Jest 30 + Nx preset compatibility

Key interfaces:
```typescript
export interface MarketDataOutput {
  symbol: string;
  name?: string;
  price?: number;
  peRatio?: number;
  dividendYield?: number;
  marketCap?: number;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
  error?: string;
}

export interface ChatResponse {
  response: string;
  toolCalls: ToolCallInfo[];
  sessionId: string;
}
```

Infrastructure fixes:
- Fixed corrupted `unrs-resolver` native binding (881KB → 1.8MB) caused by disk space issue during npm install
- Fixed missing `iterare` module (partial install, lib/ missing)
- Removed @langchain/* deps to resolve peer dependency conflict in Docker build

## Acceptance Criteria
- [ ] AC1: Chat UI accessible at Ghostfolio `/agent` page — can send messages and see responses.
- [ ] AC2: `POST /api/v1/agent/chat` with market data question returns structured response with real price data.
- [ ] AC3: Tool calls visible in response payload and in chat UI.
- [ ] AC4: LangSmith project shows at least one traced run with tool call nodes.
- [ ] AC5: All 5 eval test cases pass.
- [ ] AC6: Invalid symbol query returns graceful error in chat, not 500.

## Local Validation
```bash
# Install new dependencies
npm install

# Lint
npx nx lint api

# Tests (story-specific)
npx nx test api --testPathPattern=agent

# Full API test suite
npx nx test api

# Build check
npx nx build api
npx nx build client
```

## Deployment Handoff (Mandatory)
1. Commit all changes in `ghostfolio/`.
2. Push to `main`.
3. Railway auto-deploys Ghostfolio service (single deployment covers API + client).
4. Verify health endpoint still works.
5. Record URL and commit SHA in Checkpoint Result.

## How To Verify In Prod (Required)
- Production URL(s):
  - Ghostfolio (includes agent): `https://ghostfolio-production-e8d1.up.railway.app`
  - Agent chat page: `https://ghostfolio-production-e8d1.up.railway.app/agent`
- Endpoint(s) to call:
  - `POST /api/v1/agent/chat` with `{"message": "What is the price of AAPL?", "session_id": "test-1"}`
- Expected results:
  - Chat page renders at `/agent` with input field and send button
  - Agent returns response with AAPL price (a real number)
  - Response includes `tool_calls` with `market_data_fetch`
  - LangSmith shows traced run
- Failure signals:
  - `/agent` page blank or 404
  - 500 from API
  - No traces in LangSmith
- Rollback action:
  - Revert to previous Ghostfolio deployment on Railway

## User Checkpoint Test
1. Open Ghostfolio → navigate to `/agent` → chat UI renders.
2. Type "What is the current price of AAPL?" → response shows real price.
3. Click tool call details → see structured market data.
4. Type "XYZNOTREAL price" → graceful error, no crash.
5. Check LangSmith → trace visible.

## Checkpoint Result
- Commit SHA: `ea112a42f` (direct fetch API replacement)
- Railway project: `faithful-youthfulness` (`ad54fa78-44fe-4b35-bd5b-f3fc8e81e276`)
- Ghostfolio URL: `https://ghostfolio-production-e8d1.up.railway.app`
- Agent chat page: `https://ghostfolio-production-e8d1.up.railway.app/en/agent`
- Railway deployment: `6b052d83` (SUCCESS)
- User Validation: `passed` — AAPL returns $272.14, chat UI renders and responds
- Notes:
  - MVP uses pattern matching instead of LLM (LangGraph deferred to future story)
  - 5/5 tests passing locally
  - Agent route registered: `POST /api/v1/agent/chat`
  - Replaced yahoo-finance2 library with direct Yahoo Finance v8 chart API fetch
  - yahoo-finance2's cookie/crumb handling fails in Railway Docker; direct fetch works
  - Migrated from old Railway project to faithful-youthfulness

## Observability & Monitoring
- Logs to check:
  - Railway Ghostfolio logs (agent execution, tool calls)
- Traces/metrics to check:
  - LangSmith: trace count, latency, tool success rate, token usage
- Alert thresholds:
  - Agent endpoint response >10s
  - Tool failure rate >20%

## Risks & Edge Cases
- Risk 1: `yahoo-finance2` rate limiting or blocking from Railway IPs
- Risk 2: Claude Sonnet API latency causing timeout
- Risk 3: NestJS module registration conflicts with existing Ghostfolio modules
- Risk 4: Angular routing conflicts with existing Ghostfolio pages
- Edge case 1: Yahoo Finance stale/missing data for some symbols
- Edge case 2: User asks non-finance question (agent should still respond)
- Edge case 3: Very long message exceeding context limits

## Notes
- Does NOT depend on US-002 — `market_data_fetch` uses Yahoo Finance, not Ghostfolio.
- Chat UI enables manual testing of all subsequent tools (US-004, US-005).
- LangGraph state machine establishes the pattern all subsequent tools follow.
- Agent module is registered but isolated — does NOT modify existing Ghostfolio modules.
- Uses `@langchain/anthropic` for Claude integration (provides automatic LangSmith tracing).
- Single Railway deployment: agent deploys with Ghostfolio, no separate service needed.
