# US-006: Conversation Memory and Error Handling

## Status

- State: `in-review`
- Owner: `youssef`
- Depends on: US-003, US-004, US-005
- Related PR/Commit:
- Target environment: `prod`

## Persona

**Sam, the End User** wants to have a natural multi-turn conversation without repeating context each time.

**Jordan, the Observer** wants obvious error states so AI usage feels trustworthy and predictable.

## User Story

> As Sam, I want multi-turn conversation so that I can ask follow-up questions without restating context.
> As Jordan, I want clear error messages when something fails so I always know what's happening.

## Goal

Add session-based conversation memory (messages persist across turns per session) and classified error handling (tool/data/model/service errors produce user-friendly messages, not stack traces). This completes MVP requirements #5 (conversation history) and #6 (error handling).

## Scope

In scope:

1. Session-based memory in LangGraph state (in-memory `Map<string, BaseMessage[]>` keyed by `session_id`).
2. Error handling with classified error types in NestJS.
3. Tool failure → fallback message.
4. LLM API failure → retry/timeout message.
5. Portfolio service unavailable → "portfolio service unavailable" message.
6. Error classification: `DataError`, `ToolError`, `ModelError`, `ServiceError`.
7. Angular chat component error display styling.
8. Four eval test cases (2 multi-turn + 2 error).

Out of scope:

1. Persistent session storage (in-memory only, lost on restart).
2. Authentication or user identity.
3. Session expiry or cleanup logic.
4. Chat UI creation (already exists from US-003).

## Pre-Implementation Audit

Local sources to read before writing any code:

1. `apps/api/src/app/agent/agent.service.ts` — current AgentState and graph to extend with memory
2. `apps/api/src/app/agent/agent.controller.ts` — current endpoint to add error handling
3. `apps/api/src/app/agent/tools/market-data.tool.ts` — understand current error patterns
4. `apps/api/src/app/agent/tools/portfolio-analysis.tool.ts` — Ghostfolio error patterns
5. `apps/client/src/app/components/chat/chat.component.ts` — chat UI to add error styling

## Preparation Phase (Mandatory)

1. Read local code listed above.
2. Web-check relevant docs:
   - LangGraph JS message history / checkpointer patterns
   - LangGraph state persistence approaches (JS/TS)
   - NestJS exception filters and error handling
3. Write Preparation Notes.

### Preparation Notes

_(Fill during execution.)_

Local docs/code reviewed:

1.
2.

Memory design:

```typescript
// In-memory session store (inside AgentService)
private sessions = new Map<string, BaseMessage[]>();

// On each /api/v1/agent/chat call:
// 1. Look up session_id in sessions map
// 2. Prepend history to current messages
// 3. Invoke graph
// 4. Append new messages to session history
```

Error classification:

```typescript
enum ErrorType {
  DATA = 'data', // yahoo-finance2/external data issues
  TOOL = 'tool', // tool execution failure
  MODEL = 'model', // LLM API failure
  SERVICE = 'service' // Ghostfolio/dependency down
}

interface AgentError {
  type: ErrorType;
  message: string; // user-friendly
  recoverable: boolean;
}
```

Planned failing tests:

1. `should carry context from first message to second message`
2. `should handle tool switching within same session (portfolio → compliance)`
3. `should return 200 with user-friendly error for empty input`
4. `should return graceful error when simulating service failure`

## UX Script

Happy path (multi-turn):

1. User asks "What's the price of AAPL?"
2. Agent responds with price.
3. User asks "How about Microsoft?" (no ticker specified).
4. Agent understands from context → responds with MSFT price.

Error path:

1. Portfolio service unavailable.
2. User asks "What's my portfolio risk?"
3. Agent responds: "I'm unable to access portfolio data right now. I can still help with market data — try asking about stock prices."
4. User asks "Price of AAPL?" → works fine (different tool).

## Preconditions

- [ ] US-003 complete (LangGraph agent + Angular chat page + market_data tool)
- [ ] US-004 complete (portfolio_risk_analysis tool)
- [ ] US-005 complete (compliance_check tool)

## TDD Plan

Write tests first. Red → Green → Refactor. Covers all 5 test layers (see CLAUDE.md).

### Layer 1 — Unit tests: `session-memory.service.spec.ts` (≥10)

**Happy path (3):**

1. `should store and retrieve messages for a session`
2. `should carry context from first message to second (message count grows)`
3. `should handle tool switching within same session (market→portfolio)`

**Edge cases (3):** 4. `should keep independent sessions completely separate` 5. `should handle session_id with special characters (Unicode, slashes)` 6. `should handle rapid sequential messages to same session`

**Error/failure modes (2):** 7. `should handle getHistory for non-existent session → empty array (not throw)` 8. `should handle addMessages with empty message array → no-op`

**Boundary conditions (2):** 9. `should evict oldest session when LRU limit (1000) is reached` 10. `should handle very long conversation (50+ turns) without crash`

### Layer 1 — Unit tests: `agent-error.spec.ts` (≥10)

**Happy path (3):**

1. `should create AgentError with correct ErrorType.TOOL`
2. `should create AgentError with correct ErrorType.DATA`
3. `should create AgentError with correct ErrorType.MODEL`

**Edge cases (3):** 4. `should classify unknown error as ErrorType.SERVICE` 5. `should preserve original error message in AgentError` 6. `should serialize to JSON correctly for API response`

**Error/failure modes (2):** 7. `should handle error with null/undefined message gracefully` 8. `should handle nested error (error wrapping error)`

**Boundary conditions (2):** 9. `should handle error message with 10K+ characters (truncate for response)` 10. `should handle error with special characters in message (no injection)`

### Layer 2 — Integration tests (≥5): `agent.controller.spec.ts` (extend)

1. `should return 200 with user-friendly error for empty input (not 500)`
2. `should return 200 with graceful error for extremely long input (10K+ chars)`
3. `should include session_id in error responses`
4. `should propagate classified error type in response body`
5. `should not leak stack traces in any error response`

### Layer 3 — Agent behavioral tests (≥8): `memory-error.behavioral.spec.ts`

1. `should remember context from turn 1 when answering turn 2`
2. `should handle "what about MSFT?" after asking about AAPL (context switch)`
3. `should not hallucinate previous conversation — new session has no history`
4. `should handle tool failure mid-conversation → explain error, maintain history`
5. `should not leak session A's data into session B's responses`
6. `should recover gracefully from LLM API timeout → retry or user-friendly message`
7. `should handle concurrent messages to same session without data corruption`
8. `should classify errors correctly: tool error vs data error vs model error`

### Layer 4 — Contract tests (≥3): co-located in `agent.controller.spec.ts`

1. `should return error response matching { error: string, type: string, session_id: string }`
2. `should return memory-aware response with same session_id echo`
3. `should never return raw stack trace or internal error details to client`

### Mandatory edge case checklist

- [x] Empty/null: empty message (integration test 1), empty history (unit test 7)
- [x] Boundary: 50+ turns (unit test 10), 10K+ char input (integration test 2), LRU eviction (unit test 9)
- [x] Malformed data: null error message (unit test 7), nested error (unit test 8)
- [x] Network failure: LLM API timeout (behavioral test 6)
- [x] Concurrent: parallel requests same session (behavioral test 7), session isolation (behavioral test 5)
- [x] Special chars: Unicode session_id (unit test 5), injection in error message (unit test 10)
- [x] LLM non-determinism: no hallucinated history (behavioral test 3)

### Red → Green → Refactor sequence

1. Write Layer 1 memory unit tests → all fail (red).
2. Implement `SessionMemoryService` → memory tests go green.
3. Write Layer 1 error unit tests → fail.
4. Implement `AgentError` + error classes → error tests go green.
5. Write Layer 2 integration tests → fail.
6. Wire exception filter + memory into controller → Layer 2 goes green.
7. Write Layer 3 behavioral tests → fail.
8. Integrate memory + error handling into agent graph → Layer 3 goes green.
9. Write Layer 4 contract tests → verify shapes.
10. Refactor: clean up error classification, add to all tools.

## Step-by-step Implementation Plan

### Memory

1. Create `apps/api/src/app/agent/memory/session-memory.service.ts`:
   - `SessionMemoryService` — NestJS injectable.
   - In-memory `Map<string, BaseMessage[]>`.
   - `getHistory(sessionId)` and `addMessages(sessionId, messages)` methods.
   - LRU eviction (max 1000 sessions) to prevent unbounded growth.
2. Update `agent.service.ts` to inject `SessionMemoryService`.
3. Prepend session history before graph invocation, append after.

### Error Handling

4. Create `apps/api/src/app/agent/errors/agent-error.ts`:
   - `ErrorType` enum and `AgentError` class.
5. Wrap tool execution in `agent.service.ts` with classified try/catch.
6. Add NestJS exception filter in agent module — catch unhandled → return 200 with error.
7. Log errors with classification for debugging and LangSmith traces.

### Chat UI

8. Update Angular chat component — error responses styled with amber/red border.

### Deploy

9. Deploy (single Ghostfolio service) and test multi-turn + error scenarios.

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

- [ ] AC1: Second message references context from first (verified by test).
- [ ] AC2: Service outage → user-friendly error, not 500/stack trace.
- [ ] AC3: Invalid input (empty, very long) → graceful response.
- [ ] AC4: Error classification visible in logs/LangSmith traces.
- [ ] AC5: All test layers pass: ≥20 unit (memory + error), ≥5 integration, ≥8 behavioral, ≥3 contract.
- [ ] AC6: All 7 mandatory edge case categories covered in tests.

## Local Validation

```bash
# Tests (story-specific)
npx nx test api --testPathPattern="memory|error"

# Full API test suite
npx nx test api

# Build
npx nx build api
npx nx build client
```

## Deployment Handoff (Mandatory)

1. Commit changes in `ghostfolio/`.
2. Push to `main` → Railway auto-deploys Ghostfolio.
3. Verify health endpoint.
4. Test multi-turn and error scenarios via chat UI at `/agent`.
5. Record in Checkpoint Result.

## How To Verify In Prod (Required)

- Production URL(s):
  - Ghostfolio: `https://ghostfolio-production-e8d1.up.railway.app`
  - Chat page: `https://ghostfolio-production-e8d1.up.railway.app/agent`
- Expected results:
  - "Price of AAPL?" then "How about Microsoft?" → MSFT data (context maintained)
  - Empty message → user-friendly error, no crash
  - Logs show error classification for failures
- Failure signals:
  - Agent treats each message as independent (no memory)
  - 500 on invalid input
  - Stack traces visible in chat
- Rollback action:
  - Revert Ghostfolio deployment; all tools still work (just without memory/error handling)

## User Checkpoint Test

1. Ask "What is AAPL's price?" → get response.
2. Ask "How about Microsoft?" → get MSFT price (not "which stock?").
3. Ask "Check my portfolio risk" → get risk data.
4. Ask "What about ESG?" → get compliance report (context: "my portfolio").
5. Send empty message → see graceful error.
6. Refresh page → new session, no carryover (expected).

## Checkpoint Result

- Commit SHA: `961d8f606` through `8bdbab5b2` (12 commits)
- Ghostfolio URL: https://ghostfolio-production-e8d1.up.railway.app/agent
- User Validation: `in-review`
- Notes:
  - All 13 agent test suites pass (168 tests)
  - Pre-existing `keyv`/`redis-cache` build errors are unrelated to agent code
  - UI redesign (976f8cf) was unplanned but kept; error fields re-applied (1be2755a3)
  - Railway deployment triggered via push to main

## Observability & Monitoring

- Logs to check:
  - Ghostfolio logs (error classifications, session counts)
- Traces/metrics to check:
  - LangSmith: multi-turn traces (message history growing)
  - LangSmith: error traces with classification metadata
- Alert thresholds:
  - Unclassified errors >5% of requests

## Risks & Edge Cases

- Risk 1: In-memory sessions lost on Railway restart (acceptable for MVP)
- Risk 2: Session store grows unbounded (mitigated: LRU eviction)
- Edge case 1: Concurrent requests to same session_id → race condition
- Edge case 2: Very long conversation (50+ turns) → LLM context overflow
- Edge case 3: Non-English input → agent should still respond

## Notes

- Memory is in-memory only for MVP. Persistent storage is Phase 3.
- Error classification follows implementation strategy: data, tool, model, service.
- Chat UI already exists from US-003; this story only adds error display styling.
- All changes are within `apps/api/src/app/agent/` — no existing Ghostfolio code modified.
