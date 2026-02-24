# US-006: Conversation Memory & Error Handling — Design

**Date**: 2026-02-24
**Story**: US-006
**Status**: Approved

## Decisions

1. **Memory model**: Structured session state (not message history replay)
2. **Error types**: All 4 (data, tool, model, service) — model reserved for future LLM
3. **API contract**: Add optional `is_error` + `error_type` fields (non-breaking)

## 1. Session Memory

### SessionMemoryService

NestJS injectable. In-memory `Map<string, SessionState>` with LRU eviction at 1000 sessions.

```typescript
interface SessionState {
  lastSymbols: string[]; // last ticker symbols mentioned
  lastTool: string | null; // 'market_data' | 'portfolio' | 'compliance' | null
  lastTopic: string | null; // free-form context hint (e.g., 'esg_fossil_fuels')
  turnCount: number;
  createdAt: number;
  lastAccessedAt: number;
}
```

### Context Resolution (in AgentService.chat)

1. Look up session state by `session_id`
2. If message contains "what about X?" / "how about X?" / "and X?" patterns with a new symbol, use it but inherit `lastTool` to route to the same tool type
3. If message has no recognizable symbols/keywords but session has `lastSymbols`, use those as fallback context
4. After routing + response, update session state with symbols/tool/topic used

### LRU Eviction

When map size exceeds 1000, evict the entry with the oldest `lastAccessedAt`.

## 2. Error Classification

### Error Types

| Type      | Triggered by                                               |
| --------- | ---------------------------------------------------------- |
| `data`    | Yahoo Finance bad data, missing fields, HTTP 4xx/5xx       |
| `tool`    | Tool function throws during execution                      |
| `model`   | Reserved for future LLM API failures (timeout, rate limit) |
| `service` | PortfolioService / Ghostfolio dependency unavailable       |

### AgentError Class

```typescript
enum ErrorType {
  DATA = 'data',
  TOOL = 'tool',
  MODEL = 'model',
  SERVICE = 'service'
}

class AgentError extends Error {
  type: ErrorType;
  recoverable: boolean;
  userMessage: string; // safe for client (no stack traces)
}
```

### Error Wrapping

Errors are caught inside `AgentService.chat()` at the tool-call boundary. Each tool invocation gets a try/catch that wraps failures into the appropriate `AgentError` type. The service returns a `ChatResponse` with error fields populated — no NestJS exception filter needed since we always return HTTP 200.

Message truncation: error messages over 500 characters are truncated for the API response (full message logged server-side).

## 3. API Contract

### Response Shape (extended)

```typescript
{
  response: string;          // always present
  tool_calls: ToolCallDto[];
  session_id: string;
  is_error?: boolean;        // true when response is an error message
  error_type?: string;       // 'data' | 'tool' | 'model' | 'service'
}
```

- Success: `is_error` and `error_type` omitted (not false/null)
- Error: `response` = user-friendly message, `tool_calls` = [], `is_error: true`, `error_type` set
- Empty-input case ("Please provide a message") is NOT an error

## 4. Angular Chat UI

Minimal changes to existing component:

- Extend `ChatMessage` interface with `isError?: boolean` and `errorType?: string`
- Map from API response in `sendMessage()` next handler
- Add `.error` CSS class on assistant messages when `isError` is true
- Visual: left red border (`border-left: 3px solid #f44336`), small red "Error" badge
- No changes to the HTTP error handler (`subscribe.error`) — that path handles network failures

## 5. File Changes

### New Files

| File                                          | Purpose                           |
| --------------------------------------------- | --------------------------------- |
| `agent/memory/session-memory.service.ts`      | SessionMemoryService with LRU Map |
| `agent/memory/session-memory.service.spec.ts` | Layer 1 unit tests (>=10)         |
| `agent/errors/agent-error.ts`                 | AgentError class + ErrorType enum |
| `agent/errors/agent-error.spec.ts`            | Layer 1 unit tests (>=10)         |

### Modified Files

| File                             | Change                                                  |
| -------------------------------- | ------------------------------------------------------- |
| `agent/agent.module.ts`          | Register SessionMemoryService as provider               |
| `agent/agent.service.ts`         | Inject memory, context resolution, classified try/catch |
| `agent/agent.controller.ts`      | Add `is_error` / `error_type` to response DTO           |
| `agent/agent.controller.spec.ts` | Layer 2 + Layer 4 error/memory tests                    |
| `agent-page.component.ts`        | Map `is_error`/`error_type` from response               |
| `agent-page.html`                | `.error` class binding on messages                      |
| `agent-page.scss`                | Error styling (red border, badge)                       |

No changes to existing tool files — error classification wraps at the service layer.
