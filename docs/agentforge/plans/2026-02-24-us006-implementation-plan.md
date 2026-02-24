# US-006: Conversation Memory & Error Handling — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add session-based structured memory and classified error handling to the agent, so users can have multi-turn conversations and always see friendly error messages instead of stack traces.

**Architecture:** `SessionMemoryService` stores structured per-session state (last symbols, last tool, turn count) in an LRU-evicted in-memory Map. `AgentError` class with 4 typed variants wraps all tool failures at the service layer. API contract extended with optional `is_error`/`error_type` fields. Angular chat UI adds error-specific styling.

**Tech Stack:** TypeScript, NestJS (DI + guards), Angular 17, Jest (via Nx), existing keyword-based routing in AgentService.

**Base path:** `apps/api/src/app/agent/` (unless noted otherwise for client files)

---

## Task 1: AgentError class + ErrorType enum (RED)

**Files:**

- Create: `errors/agent-error.ts`
- Create: `errors/agent-error.spec.ts`

**Step 1: Write failing tests**

Create `errors/agent-error.spec.ts`:

```typescript
import { AgentError, ErrorType } from './agent-error';

describe('AgentError', () => {
  // Happy path (3)
  it('should create AgentError with ErrorType.TOOL', () => {
    const err = new AgentError(ErrorType.TOOL, 'Tool failed', true);
    expect(err.type).toBe(ErrorType.TOOL);
    expect(err.userMessage).toBe('Tool failed');
    expect(err.recoverable).toBe(true);
    expect(err).toBeInstanceOf(Error);
  });

  it('should create AgentError with ErrorType.DATA', () => {
    const err = new AgentError(ErrorType.DATA, 'Bad data from Yahoo', false);
    expect(err.type).toBe(ErrorType.DATA);
    expect(err.recoverable).toBe(false);
  });

  it('should create AgentError with ErrorType.MODEL', () => {
    const err = new AgentError(ErrorType.MODEL, 'LLM timeout', true);
    expect(err.type).toBe(ErrorType.MODEL);
  });

  // Edge cases (3)
  it('should classify unknown error as ErrorType.SERVICE via fromUnknown', () => {
    const err = AgentError.fromUnknown(new Error('random'));
    expect(err.type).toBe(ErrorType.SERVICE);
    expect(err.recoverable).toBe(false);
  });

  it('should preserve original error in cause property', () => {
    const original = new Error('root cause');
    const err = new AgentError(ErrorType.TOOL, 'Wrapper', true, original);
    expect(err.cause).toBe(original);
  });

  it('should serialize to JSON with type, userMessage, recoverable', () => {
    const err = new AgentError(ErrorType.DATA, 'Serialize me', false);
    const json = err.toJSON();
    expect(json).toEqual({
      type: 'data',
      message: 'Serialize me',
      recoverable: false
    });
  });

  // Error/failure modes (2)
  it('should handle null message gracefully via fromUnknown', () => {
    const err = AgentError.fromUnknown(null);
    expect(err.userMessage).toBe('An unexpected error occurred.');
    expect(err.type).toBe(ErrorType.SERVICE);
  });

  it('should handle nested AgentError (pass through, not double-wrap)', () => {
    const inner = new AgentError(ErrorType.DATA, 'Inner', true);
    const outer = AgentError.fromUnknown(inner);
    expect(outer).toBe(inner); // same reference, not wrapped
  });

  // Boundary conditions (2)
  it('should truncate userMessage over 500 chars in toJSON', () => {
    const longMsg = 'x'.repeat(1000);
    const err = new AgentError(ErrorType.TOOL, longMsg, true);
    const json = err.toJSON();
    expect(json.message.length).toBeLessThanOrEqual(503); // 500 + '...'
  });

  it('should handle special characters in message without injection', () => {
    const msg = '<script>alert("xss")</script> \'; DROP TABLE users;--';
    const err = new AgentError(ErrorType.TOOL, msg, true);
    expect(err.userMessage).toBe(msg); // stored as-is, no mutation
    expect(err.toJSON().message).toBe(msg); // under 500, not truncated
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx dotenv-cli -e .env.example -- npx nx test api --testPathPattern="agent-error" --no-coverage`
Expected: FAIL — `Cannot find module './agent-error'`

**Step 3: Write minimal implementation**

Create `errors/agent-error.ts`:

```typescript
export enum ErrorType {
  DATA = 'data',
  TOOL = 'tool',
  MODEL = 'model',
  SERVICE = 'service'
}

const MAX_USER_MESSAGE_LENGTH = 500;

export class AgentError extends Error {
  public readonly type: ErrorType;
  public readonly userMessage: string;
  public readonly recoverable: boolean;

  constructor(
    type: ErrorType,
    userMessage: string,
    recoverable: boolean,
    cause?: Error
  ) {
    super(userMessage);
    this.name = 'AgentError';
    this.type = type;
    this.userMessage = userMessage;
    this.recoverable = recoverable;
    if (cause) {
      this.cause = cause;
    }
  }

  /**
   * Wrap any unknown thrown value into a classified AgentError.
   * If it's already an AgentError, return it as-is (no double-wrapping).
   */
  static fromUnknown(err: unknown): AgentError {
    if (err instanceof AgentError) {
      return err;
    }
    const message =
      err instanceof Error ? err.message : 'An unexpected error occurred.';
    return new AgentError(
      ErrorType.SERVICE,
      message || 'An unexpected error occurred.',
      false,
      err instanceof Error ? err : undefined
    );
  }

  toJSON(): { type: string; message: string; recoverable: boolean } {
    let msg = this.userMessage;
    if (msg.length > MAX_USER_MESSAGE_LENGTH) {
      msg = msg.slice(0, MAX_USER_MESSAGE_LENGTH) + '...';
    }
    return {
      type: this.type,
      message: msg,
      recoverable: this.recoverable
    };
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx dotenv-cli -e .env.example -- npx nx test api --testPathPattern="agent-error" --no-coverage`
Expected: 10 tests PASS

**Step 5: Commit**

```bash
git add apps/api/src/app/agent/errors/
git commit -m "feat(agent): add AgentError class with 4 error types (RED→GREEN)

Layer 1 unit tests: 10 tests covering happy path, edge cases,
error modes, and boundary conditions.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 2: SessionMemoryService (RED)

**Files:**

- Create: `memory/session-memory.service.ts`
- Create: `memory/session-memory.service.spec.ts`

**Step 1: Write failing tests**

Create `memory/session-memory.service.spec.ts`:

```typescript
import { SessionMemoryService, SessionState } from './session-memory.service';

describe('SessionMemoryService', () => {
  let service: SessionMemoryService;

  beforeEach(() => {
    service = new SessionMemoryService();
  });

  // Happy path (3)
  it('should store and retrieve session state', () => {
    service.updateSession('s1', {
      lastSymbols: ['AAPL'],
      lastTool: 'market_data',
      lastTopic: null
    });
    const state = service.getSession('s1');
    expect(state).toBeDefined();
    expect(state!.lastSymbols).toEqual(['AAPL']);
    expect(state!.lastTool).toBe('market_data');
    expect(state!.turnCount).toBe(1);
  });

  it('should carry context across multiple updates (turnCount grows)', () => {
    service.updateSession('s1', {
      lastSymbols: ['AAPL'],
      lastTool: 'market_data',
      lastTopic: null
    });
    service.updateSession('s1', {
      lastSymbols: ['MSFT'],
      lastTool: 'market_data',
      lastTopic: null
    });
    const state = service.getSession('s1');
    expect(state!.turnCount).toBe(2);
    expect(state!.lastSymbols).toEqual(['MSFT']);
  });

  it('should handle tool switching within same session', () => {
    service.updateSession('s1', {
      lastSymbols: ['AAPL'],
      lastTool: 'market_data',
      lastTopic: null
    });
    service.updateSession('s1', {
      lastSymbols: [],
      lastTool: 'compliance',
      lastTopic: 'esg'
    });
    const state = service.getSession('s1');
    expect(state!.lastTool).toBe('compliance');
    expect(state!.lastTopic).toBe('esg');
  });

  // Edge cases (3)
  it('should keep independent sessions completely separate', () => {
    service.updateSession('s1', {
      lastSymbols: ['AAPL'],
      lastTool: 'market_data',
      lastTopic: null
    });
    service.updateSession('s2', {
      lastSymbols: ['TSLA'],
      lastTool: 'portfolio',
      lastTopic: null
    });
    expect(service.getSession('s1')!.lastSymbols).toEqual(['AAPL']);
    expect(service.getSession('s2')!.lastSymbols).toEqual(['TSLA']);
  });

  it('should handle session_id with special characters (Unicode, slashes)', () => {
    const id = 'session/café-日本語/123';
    service.updateSession(id, {
      lastSymbols: ['AAPL'],
      lastTool: 'market_data',
      lastTopic: null
    });
    expect(service.getSession(id)).toBeDefined();
    expect(service.getSession(id)!.lastSymbols).toEqual(['AAPL']);
  });

  it('should handle rapid sequential updates to same session', () => {
    for (let i = 0; i < 20; i++) {
      service.updateSession('s1', {
        lastSymbols: [`SYM${i}`],
        lastTool: 'market_data',
        lastTopic: null
      });
    }
    const state = service.getSession('s1');
    expect(state!.turnCount).toBe(20);
    expect(state!.lastSymbols).toEqual(['SYM19']);
  });

  // Error/failure modes (2)
  it('should return undefined for non-existent session (not throw)', () => {
    expect(service.getSession('nonexistent')).toBeUndefined();
  });

  it('should handle updateSession with empty symbols array (no-op on symbols)', () => {
    service.updateSession('s1', {
      lastSymbols: ['AAPL'],
      lastTool: 'market_data',
      lastTopic: null
    });
    service.updateSession('s1', {
      lastSymbols: [],
      lastTool: 'market_data',
      lastTopic: null
    });
    const state = service.getSession('s1');
    expect(state!.lastSymbols).toEqual([]);
    expect(state!.turnCount).toBe(2);
  });

  // Boundary conditions (2)
  it('should evict oldest session when LRU limit (1000) is reached', () => {
    const small = new SessionMemoryService(5); // use configurable limit for testing
    for (let i = 0; i < 6; i++) {
      service = small;
      small.updateSession(`s${i}`, {
        lastSymbols: [],
        lastTool: null,
        lastTopic: null
      });
    }
    // s0 should be evicted (oldest by lastAccessedAt)
    expect(small.getSession('s0')).toBeUndefined();
    // s5 should still exist
    expect(small.getSession('s5')).toBeDefined();
  });

  it('should handle very long conversation (50+ turns) without crash', () => {
    for (let i = 0; i < 60; i++) {
      service.updateSession('long', {
        lastSymbols: ['AAPL'],
        lastTool: 'market_data',
        lastTopic: null
      });
    }
    expect(service.getSession('long')!.turnCount).toBe(60);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx dotenv-cli -e .env.example -- npx nx test api --testPathPattern="session-memory" --no-coverage`
Expected: FAIL — `Cannot find module './session-memory.service'`

**Step 3: Write minimal implementation**

Create `memory/session-memory.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';

export interface SessionState {
  lastSymbols: string[];
  lastTool: string | null;
  lastTopic: string | null;
  turnCount: number;
  createdAt: number;
  lastAccessedAt: number;
}

export interface SessionUpdate {
  lastSymbols: string[];
  lastTool: string | null;
  lastTopic: string | null;
}

const DEFAULT_MAX_SESSIONS = 1000;

@Injectable()
export class SessionMemoryService {
  private sessions = new Map<string, SessionState>();
  private readonly maxSessions: number;

  constructor(maxSessions: number = DEFAULT_MAX_SESSIONS) {
    this.maxSessions = maxSessions;
  }

  getSession(sessionId: string): SessionState | undefined {
    const state = this.sessions.get(sessionId);
    if (state) {
      state.lastAccessedAt = Date.now();
    }
    return state;
  }

  updateSession(sessionId: string, update: SessionUpdate): void {
    const existing = this.sessions.get(sessionId);
    const now = Date.now();

    if (existing) {
      existing.lastSymbols = update.lastSymbols;
      existing.lastTool = update.lastTool;
      existing.lastTopic = update.lastTopic;
      existing.turnCount += 1;
      existing.lastAccessedAt = now;
    } else {
      this.evictIfNeeded();
      this.sessions.set(sessionId, {
        lastSymbols: update.lastSymbols,
        lastTool: update.lastTool,
        lastTopic: update.lastTopic,
        turnCount: 1,
        createdAt: now,
        lastAccessedAt: now
      });
    }
  }

  private evictIfNeeded(): void {
    if (this.sessions.size < this.maxSessions) {
      return;
    }
    // Find the session with the oldest lastAccessedAt
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    for (const [key, state] of this.sessions) {
      if (state.lastAccessedAt < oldestTime) {
        oldestTime = state.lastAccessedAt;
        oldestKey = key;
      }
    }
    if (oldestKey) {
      this.sessions.delete(oldestKey);
    }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx dotenv-cli -e .env.example -- npx nx test api --testPathPattern="session-memory" --no-coverage`
Expected: 10 tests PASS

**Step 5: Commit**

```bash
git add apps/api/src/app/agent/memory/
git commit -m "feat(agent): add SessionMemoryService with LRU eviction (RED→GREEN)

Layer 1 unit tests: 10 tests covering session CRUD, isolation,
special chars, rapid updates, LRU eviction, and long conversations.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 3: Extend ChatResponse and controller DTO with error fields

**Files:**

- Modify: `agent.service.ts` (add `errorType?` and `isError?` to `ChatResponse`)
- Modify: `agent.controller.ts` (add `is_error?` and `error_type?` to `ChatResponseDto`)

**Step 1: Update the ChatResponse interface in `agent.service.ts`**

Add optional error fields to the existing `ChatResponse` interface:

```typescript
// In agent.service.ts, update the existing ChatResponse interface:
export interface ChatResponse {
  response: string;
  toolCalls: ToolCallInfo[];
  sessionId: string;
  isError?: boolean; // NEW
  errorType?: string; // NEW — 'data' | 'tool' | 'model' | 'service'
}
```

**Step 2: Update the controller DTO in `agent.controller.ts`**

Add optional error fields to `ChatResponseDto` and map them:

```typescript
// In agent.controller.ts, update ChatResponseDto:
interface ChatResponseDto {
  response: string;
  tool_calls: ToolCallDto[];
  session_id: string;
  is_error?: boolean;       // NEW
  error_type?: string;      // NEW
}

// In the chat() method, update the return:
async chat(@Body() body: ChatRequestDto): Promise<ChatResponseDto> {
  const result = await this.agentService.chat({
    message: body.message,
    sessionId: body.session_id,
    userId: this.request.user.id
  });

  const dto: ChatResponseDto = {
    response: result.response,
    tool_calls: result.toolCalls,
    session_id: result.sessionId
  };

  if (result.isError) {
    dto.is_error = true;
    dto.error_type = result.errorType;
  }

  return dto;
}
```

**Step 3: Run existing tests to verify nothing is broken**

Run: `npx dotenv-cli -e .env.example -- npx nx test api --testPathPattern="agent" --no-coverage`
Expected: All existing tests PASS (optional fields don't break anything)

**Step 4: Commit**

```bash
git add apps/api/src/app/agent/agent.service.ts apps/api/src/app/agent/agent.controller.ts
git commit -m "feat(agent): extend API contract with optional is_error/error_type fields

Non-breaking change — fields are omitted on success responses.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 4: Wire SessionMemoryService + error handling into AgentService

**Files:**

- Modify: `agent.service.ts` (inject memory, add context resolution, wrap tool calls with error classification)
- Modify: `agent.module.ts` (register SessionMemoryService)

**Step 1: Register SessionMemoryService in agent.module.ts**

```typescript
// agent.module.ts — add import and provider:
import { SessionMemoryService } from './memory/session-memory.service';

@Module({
  controllers: [AgentController],
  imports: [PortfolioModule],
  providers: [AgentService, SessionMemoryService]
})
export class AgentModule {}
```

**Step 2: Update AgentService to inject and use memory + error handling**

Key changes to `agent.service.ts`:

1. Inject `SessionMemoryService` in constructor
2. Add `resolveContext()` private method that checks session state for follow-up patterns
3. Wrap each tool call branch in a try/catch that creates `AgentError` instances
4. After successful routing, call `sessionMemory.updateSession()` with the symbols/tool/topic used
5. On error, return `ChatResponse` with `isError: true` and `errorType` set

Context resolution logic:

```typescript
private resolveContext(message: string, sessionId: string): { symbols: string[]; tool: string | null } {
  const session = this.sessionMemory.getSession(sessionId);
  if (!session) {
    return { symbols: this.extractSymbols(message), tool: null };
  }

  // Check for follow-up patterns: "what about X?", "how about X?", "and X?"
  const followUpMatch = message.match(/(?:what|how)\s+about\s+([A-Z]{1,5})\b/i)
    || message.match(/\band\s+([A-Z]{1,5})\b/i);

  if (followUpMatch) {
    const newSymbol = followUpMatch[1].toUpperCase();
    return { symbols: [newSymbol], tool: session.lastTool };
  }

  // If no symbols/keywords detected, fall back to session context
  const extracted = this.extractSymbols(message);
  if (extracted.length === 0 && !isEsgQuestion(message) && !isPortfolioQuestion(message)) {
    if (session.lastSymbols.length > 0) {
      return { symbols: session.lastSymbols, tool: session.lastTool };
    }
  }

  return { symbols: extracted, tool: null };
}
```

Error wrapping pattern (applied to each tool branch):

```typescript
// Example for market data:
try {
  const marketData = await marketDataFetch({ symbols });
  // ... build response ...
  this.sessionMemory.updateSession(sessionId, {
    lastSymbols: symbols,
    lastTool: 'market_data',
    lastTopic: null
  });
  return { response: parts.join('\n'), toolCalls, sessionId };
} catch (err) {
  const agentErr = AgentError.fromUnknown(err);
  // Override type if we know the source
  const classified = err instanceof AgentError ? err
    : new AgentError(ErrorType.DATA, `Failed to fetch market data: ${agentErr.userMessage}`, true, err instanceof Error ? err : undefined);
  console.error(`[agent] ${classified.type} error:`, classified.userMessage);
  return {
    response: classified.userMessage,
    toolCalls: [],
    sessionId,
    isError: true,
    errorType: classified.type
  };
}
```

Apply similar pattern for portfolio (ErrorType.SERVICE) and compliance (ErrorType.TOOL) branches.

**Step 3: Run all agent tests**

Run: `npx dotenv-cli -e .env.example -- npx nx test api --testPathPattern="agent" --no-coverage`
Expected: All existing tests still PASS

**Step 4: Commit**

```bash
git add apps/api/src/app/agent/agent.module.ts apps/api/src/app/agent/agent.service.ts
git commit -m "feat(agent): wire session memory and classified error handling into AgentService

- Inject SessionMemoryService, resolve follow-up context per session
- Wrap all tool calls with classified try/catch (DATA/TOOL/SERVICE)
- Update session state after each successful routing

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 5: Layer 2 integration + Layer 4 contract tests (RED → GREEN)

**Files:**

- Modify: `agent.controller.spec.ts` (add new test cases)

**Step 1: Write failing integration and contract tests**

Add these tests to the existing `describe('AgentController (integration)')` block in `agent.controller.spec.ts`:

```typescript
// --- Layer 2: Memory integration tests ---

it('should carry context: "how about MSFT?" after AAPL uses same session', async () => {
  const originalFetch = global.fetch;
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      chart: {
        result: [{ meta: { regularMarketPrice: 150, shortName: 'Test' } }]
      }
    })
  });

  try {
    // Turn 1: ask about AAPL
    await controller.chat({
      message: 'Price of AAPL',
      session_id: 'memory-test'
    });
    // Turn 2: follow-up
    const result = await controller.chat({
      message: 'How about MSFT?',
      session_id: 'memory-test'
    });

    expect(result.tool_calls).toHaveLength(1);
    expect(result.tool_calls[0].name).toBe('market_data_fetch');
    // MSFT should be the symbol fetched
    const toolResult = JSON.parse(result.tool_calls[0].result);
    expect(toolResult).toHaveProperty('MSFT');
  } finally {
    global.fetch = originalFetch;
  }
});

it('should not carry context across different session_ids', async () => {
  const originalFetch = global.fetch;
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      chart: {
        result: [{ meta: { regularMarketPrice: 150, shortName: 'Test' } }]
      }
    })
  });

  try {
    await controller.chat({
      message: 'Price of AAPL',
      session_id: 'session-A'
    });
    const result = await controller.chat({
      message: 'How about it?',
      session_id: 'session-B'
    });

    // session-B has no context, should get help message
    expect(result.tool_calls).toHaveLength(0);
    expect(result.response).toContain('I can help you with');
  } finally {
    global.fetch = originalFetch;
  }
});

it('should include is_error and error_type when portfolio service fails', async () => {
  const failController = await buildModule(new FailingPortfolioService());
  const result = await failController.chat({
    message: "What's my portfolio risk?",
    session_id: 'error-test'
  });

  expect(result.is_error).toBe(true);
  expect(result.error_type).toBeDefined();
  expect(result.tool_calls).toHaveLength(0);
  expect(result.response).toBeTruthy();
});

it('should include session_id in error responses', async () => {
  const failController = await buildModule(new FailingPortfolioService());
  const result = await failController.chat({
    message: "What's my portfolio concentration?",
    session_id: 'err-session-echo'
  });

  expect(result.session_id).toBe('err-session-echo');
});

it('should not leak stack traces in any error response', async () => {
  const failController = await buildModule(new FailingPortfolioService());
  const result = await failController.chat({
    message: 'Check my portfolio allocation',
    session_id: 'no-stack'
  });

  expect(result.response).not.toMatch(/at\s+\w+\s+\(/); // no stack frames
  expect(result.response).not.toContain('Error:');
  expect(result.response).not.toContain('.ts:');
});

// --- Layer 4: Contract tests ---

it('should return error response matching { is_error, error_type, session_id } shape', async () => {
  const failController = await buildModule(new FailingPortfolioService());
  const result = await failController.chat({
    message: "What's my portfolio risk?",
    session_id: 'contract-error'
  });

  // Verify exact shape
  expect(typeof result.response).toBe('string');
  expect(typeof result.is_error).toBe('boolean');
  expect(typeof result.error_type).toBe('string');
  expect(['data', 'tool', 'model', 'service']).toContain(result.error_type);
  expect(Array.isArray(result.tool_calls)).toBe(true);
  expect(typeof result.session_id).toBe('string');
});

it('should omit is_error and error_type on success responses', async () => {
  const result = await controller.chat({
    message: 'Is my portfolio ESG compliant?',
    session_id: 'contract-success'
  });

  expect(result.is_error).toBeUndefined();
  expect(result.error_type).toBeUndefined();
});

it('should never return raw stack trace or internal error details to client', async () => {
  const failController = await buildModule(new FailingPortfolioService());
  const result = await failController.chat({
    message: 'Check ESG compliance',
    session_id: 'contract-no-stack'
  });

  expect(result.response).not.toContain('node_modules');
  expect(result.response).not.toContain('at Object.');
  expect(result.response).not.toContain('TypeError');
});
```

**Step 2: Run tests — new ones should pass since implementation is done in Task 4**

Run: `npx dotenv-cli -e .env.example -- npx nx test api --testPathPattern="agent.controller" --no-coverage`
Expected: All tests PASS (if any fail, fix the implementation in agent.service.ts)

**Step 3: Commit**

```bash
git add apps/api/src/app/agent/agent.controller.spec.ts
git commit -m "test(agent): add Layer 2 integration + Layer 4 contract tests for memory/errors

5 integration tests (memory carry-over, session isolation, error fields).
3 contract tests (error shape, success shape, no stack traces).

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 6: Layer 3 behavioral tests

**Files:**

- Create: `memory-error.behavioral.spec.ts`

**Step 1: Write behavioral tests**

Create `memory-error.behavioral.spec.ts` in the agent directory:

```typescript
import { PortfolioService } from '@ghostfolio/api/app/portfolio/portfolio.service';

import { REQUEST } from '@nestjs/core';
import { Test } from '@nestjs/testing';

import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';
import { SessionMemoryService } from './memory/session-memory.service';
import {
  TestPortfolioService,
  FailingPortfolioService,
  makeTestHoldings
} from './testing/test-portfolio.service';

jest.mock('@ghostfolio/api/app/portfolio/portfolio.service', () => ({
  PortfolioService: class MockPortfolioServiceToken {}
}));

const TEST_USER_ID = 'test-user-id';

describe('Agent Memory & Error Behavior (Layer 3)', () => {
  let controller: AgentController;

  async function buildController(portfolioService: any) {
    const module = await Test.createTestingModule({
      controllers: [AgentController],
      providers: [
        AgentService,
        SessionMemoryService,
        { provide: PortfolioService, useValue: portfolioService },
        { provide: REQUEST, useValue: { user: { id: TEST_USER_ID } } }
      ]
    }).compile();
    return module.get<AgentController>(AgentController);
  }

  beforeEach(async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        chart: {
          result: [
            { meta: { regularMarketPrice: 195.23, shortName: 'Test Stock' } }
          ]
        }
      })
    });
    controller = await buildController(
      new TestPortfolioService(makeTestHoldings())
    );
    // Restore after module creation (tests will mock per-test as needed)
    global.fetch = originalFetch;
  });

  // 1
  it('should remember context from turn 1 when answering turn 2', async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        chart: {
          result: [{ meta: { regularMarketPrice: 150, shortName: 'Test' } }]
        }
      })
    });

    try {
      await controller.chat({ message: 'Price of AAPL', session_id: 'beh-1' });
      const r2 = await controller.chat({
        message: 'How about MSFT?',
        session_id: 'beh-1'
      });
      expect(r2.tool_calls.length).toBeGreaterThan(0);
      expect(r2.tool_calls[0].name).toBe('market_data_fetch');
    } finally {
      global.fetch = originalFetch;
    }
  });

  // 2
  it('should handle "what about MSFT?" after asking about AAPL (follow-up pattern)', async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        chart: {
          result: [
            { meta: { regularMarketPrice: 400, shortName: 'Microsoft' } }
          ]
        }
      })
    });

    try {
      await controller.chat({
        message: 'What is the price of AAPL?',
        session_id: 'beh-2'
      });
      const r2 = await controller.chat({
        message: 'What about MSFT?',
        session_id: 'beh-2'
      });
      const toolResult = JSON.parse(r2.tool_calls[0].result);
      expect(toolResult).toHaveProperty('MSFT');
    } finally {
      global.fetch = originalFetch;
    }
  });

  // 3
  it('should not hallucinate previous conversation — new session has no history', async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        chart: {
          result: [{ meta: { regularMarketPrice: 150, shortName: 'Test' } }]
        }
      })
    });

    try {
      await controller.chat({ message: 'Price of AAPL', session_id: 'beh-3a' });
      const r = await controller.chat({
        message: 'How about it?',
        session_id: 'beh-3b'
      });
      // New session — should not know about AAPL
      expect(r.tool_calls).toHaveLength(0);
    } finally {
      global.fetch = originalFetch;
    }
  });

  // 4
  it('should handle tool failure mid-conversation → explain error, maintain history', async () => {
    const originalFetch = global.fetch;
    // First call succeeds
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          chart: {
            result: [{ meta: { regularMarketPrice: 150, shortName: 'Test' } }]
          }
        })
      })
      // Second call fails
      .mockRejectedValueOnce(new Error('Network timeout'));

    try {
      const r1 = await controller.chat({
        message: 'Price of AAPL',
        session_id: 'beh-4'
      });
      expect(r1.tool_calls).toHaveLength(1);

      const r2 = await controller.chat({
        message: 'How about MSFT?',
        session_id: 'beh-4'
      });
      // Should still respond (with error in data), not crash
      expect(r2.response).toBeTruthy();
      expect(r2.session_id).toBe('beh-4');
    } finally {
      global.fetch = originalFetch;
    }
  });

  // 5
  it('should not leak session A data into session B responses', async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        chart: {
          result: [{ meta: { regularMarketPrice: 150, shortName: 'Test' } }]
        }
      })
    });

    try {
      await controller.chat({
        message: 'Price of AAPL',
        session_id: 'isolated-A'
      });
      await controller.chat({
        message: 'Price of TSLA',
        session_id: 'isolated-B'
      });
      // Follow-up on session A should use AAPL context, not TSLA
      const r = await controller.chat({
        message: 'How about MSFT?',
        session_id: 'isolated-A'
      });
      expect(r.tool_calls[0].name).toBe('market_data_fetch');
      // Should NOT contain TSLA
      const toolResult = JSON.parse(r.tool_calls[0].result);
      expect(toolResult).not.toHaveProperty('TSLA');
    } finally {
      global.fetch = originalFetch;
    }
  });

  // 6
  it('should recover gracefully from service unavailable → user-friendly message', async () => {
    const failController = await buildController(new FailingPortfolioService());
    const result = await failController.chat({
      message: "What's my portfolio risk?",
      session_id: 'beh-6'
    });

    expect(result.response).toBeTruthy();
    expect(result.response).not.toMatch(/at\s+\w+\s+\(/); // no stack traces
    expect(result.session_id).toBe('beh-6');
  });

  // 7
  it('should handle concurrent messages to same session without data corruption', async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        chart: {
          result: [{ meta: { regularMarketPrice: 150, shortName: 'Test' } }]
        }
      })
    });

    try {
      const results = await Promise.all([
        controller.chat({ message: 'Price of AAPL', session_id: 'concurrent' }),
        controller.chat({ message: 'Price of MSFT', session_id: 'concurrent' })
      ]);
      // Both should complete without error
      expect(results[0].response).toBeTruthy();
      expect(results[1].response).toBeTruthy();
    } finally {
      global.fetch = originalFetch;
    }
  });

  // 8
  it('should classify errors correctly: service error for portfolio failure', async () => {
    const failController = await buildController(new FailingPortfolioService());
    const result = await failController.chat({
      message: 'Show my portfolio allocation',
      session_id: 'beh-8'
    });

    expect(result.is_error).toBe(true);
    expect(result.error_type).toBe('service');
  });
});
```

**Step 2: Run tests**

Run: `npx dotenv-cli -e .env.example -- npx nx test api --testPathPattern="behavioral" --no-coverage`
Expected: All 8 behavioral tests PASS

**Step 3: Commit**

```bash
git add apps/api/src/app/agent/memory-error.behavioral.spec.ts
git commit -m "test(agent): add Layer 3 behavioral tests for memory and error handling

8 tests: context carry-over, follow-up patterns, session isolation,
tool failure recovery, concurrent access, error classification.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 7: Angular chat UI error styling

**Files:**

- Modify: `apps/client/src/app/pages/agent/agent-page.component.ts`
- Modify: `apps/client/src/app/pages/agent/agent-page.html`
- Modify: `apps/client/src/app/pages/agent/agent-page.scss`

**Step 1: Update component TypeScript**

In `agent-page.component.ts`, add error fields to `ChatMessage` and `ChatResponse`:

```typescript
// Update ChatMessage interface:
interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: ToolCall[];
  isError?: boolean;      // NEW
  errorType?: string;     // NEW
}

// Update ChatResponse interface:
interface ChatResponse {
  response: string;
  tool_calls: ToolCall[];
  session_id: string;
  is_error?: boolean;     // NEW
  error_type?: string;    // NEW
}

// In sendMessage() next handler, map the error fields:
next: (response) => {
  this.messages.push({
    role: 'assistant',
    content: response.response,
    toolCalls: response.tool_calls,
    isError: response.is_error,
    errorType: response.error_type
  });
  this.isLoading = false;
},
```

**Step 2: Update template**

In `agent-page.html`, add `.error` class binding:

```html
<!-- Change the message div to include error class: -->
<div
  class="message"
  [class.assistant]="message.role === 'assistant'"
  [class.error]="message.isError"
  [class.user]="message.role === 'user'"
>
  <div class="message-role">
    {{ message.role === 'user' ? 'You' : message.isError ? 'Error' : 'Agent' }}
  </div>
</div>
```

**Step 3: Update SCSS**

In `agent-page.scss`, add error styling after the `.assistant` block:

```scss
// Inside .message { ... }
&.error {
  border-left: 3px solid #f44336;
  background: rgba(244, 67, 54, 0.05);
}
```

**Step 4: Build client to verify**

Run: `npx nx build client --configuration=production`
Expected: Build succeeds

**Step 5: Commit**

```bash
git add apps/client/src/app/pages/agent/
git commit -m "feat(agent): add error styling to Angular chat component

Error responses display with red left border and 'Error' role label.
Non-breaking — success messages unchanged.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 8: Add golden eval cases for multi-turn + error

**Files:**

- Modify: `evals/golden-data.yaml` (add 4 new cases)
- Modify: `evals/eval-runner.spec.ts` (update count from 20 to 24)

**Step 1: Add 4 new golden cases to `golden-data.yaml`**

Append to the `cases` list:

```yaml
# ── Multi-turn Memory ───────────────────────────────────────────────────────

- id: 'gs-021'
  category: 'memory'
  subcategory: 'follow_up'
  difficulty: 'straightforward'
  turns:
    - query: 'What is the price of AAPL?'
      expected_tools:
        - 'market_data_fetch'
      must_contain:
        - 'AAPL'
      must_not_contain:
        - 'I can help you with'
    - query: 'How about MSFT?'
      expected_tools:
        - 'market_data_fetch'
      must_contain:
        - 'MSFT'
      must_not_contain:
        - 'I can help you with'
  expected_tools:
    - 'market_data_fetch'
  must_contain:
    - 'MSFT'
  must_not_contain:
    - 'I can help you with'

- id: 'gs-022'
  category: 'memory'
  subcategory: 'cross_tool'
  difficulty: 'moderate'
  turns:
    - query: 'What is the price of AAPL?'
      expected_tools:
        - 'market_data_fetch'
      must_contain:
        - 'AAPL'
      must_not_contain:
        - 'I can help you with'
    - query: 'Check my portfolio risk'
      expected_tools:
        - 'portfolio_risk_analysis'
      must_contain:
        - 'Portfolio'
      must_not_contain:
        - 'AAPL'
  expected_tools:
    - 'portfolio_risk_analysis'
  must_contain:
    - 'Portfolio'
  must_not_contain:
    - 'unable to'

# ── Error Handling ──────────────────────────────────────────────────────────

- id: 'gs-023'
  query: ''
  category: 'error'
  subcategory: 'empty_input'
  difficulty: 'edge_case'
  expected_tools: []
  must_contain:
    - 'provide a message'
  must_not_contain:
    - 'Error'
    - '500'
    - 'stack'

- id: 'gs-024'
  query: 'Tell me a joke about finance'
  category: 'error'
  subcategory: 'out_of_scope'
  difficulty: 'edge_case'
  expected_tools: []
  must_contain:
    - 'I can help you with'
  must_not_contain:
    - 'Error'
    - '500'
    - 'undefined'
```

**Step 2: Update eval-runner.spec.ts**

Change the count assertion from 20 to 24:

```typescript
it('should parse golden-data.yaml and return all 24 cases', () => {
  const data = loadGoldenData(yamlPath);
  expect(data.cases).toHaveLength(24);
});
```

**Step 3: Run eval runner tests**

Run: `npx dotenv-cli -e .env.example -- npx nx test api --testPathPattern="eval-runner" --no-coverage`
Expected: PASS

**Step 4: Commit**

```bash
git add apps/api/src/app/agent/evals/
git commit -m "test(evals): add 4 golden cases for multi-turn memory and error handling

gs-021: follow-up symbol (AAPL → MSFT)
gs-022: cross-tool memory (market → portfolio)
gs-023: empty input graceful handling
gs-024: out-of-scope query help message

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 9: Build verification + full test suite

**Files:** None (verification only)

**Step 1: Run full agent test suite**

Run: `npx dotenv-cli -e .env.example -- npx nx test api --testPathPattern="agent" --no-coverage`
Expected: All tests PASS (unit + integration + behavioral + contract + eval-runner)

**Step 2: Production build**

Run: `npx nx build api --configuration=production`
Expected: Build succeeds

**Step 3: Bundle smoke test**

Run: `node -e "require('./dist/apps/api/main.js')"` (will fail on missing DB, but must NOT fail on missing modules)
Expected: Error about database connection, NOT about missing imports

**Step 4: Lint**

Run: `npx nx lint api`
Expected: No errors in agent code

**Step 5: Commit any refactor fixes**

If any issues found, fix and commit:

```bash
git commit -m "refactor(agent): fix lint/build issues from US-006 verification

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 10: Update story status + deploy

**Files:**

- Modify: `docs/agentforge/user-stories/US-006-memory-and-error-handling.md`

**Step 1: Update story status from `todo` to `in-review`**

Change `State: todo` to `State: in-review` and fill in the Implementation Details section with actual files created/modified.

**Step 2: Push to main**

```bash
git push origin main
```

**Step 3: Verify Railway deployment**

Wait for Railway auto-deploy, then verify at:

- `https://ghostfolio-production-e8d1.up.railway.app/api/v1/agent/chat` — health
- `https://ghostfolio-production-e8d1.up.railway.app/agent` — chat UI

**Step 4: Run production checkpoint tests**

1. Ask "What is AAPL's price?" → get response
2. Ask "How about Microsoft?" → get MSFT price (context maintained)
3. Ask "Check my portfolio risk" → get risk data
4. Send empty message → see graceful "provide a message" response
5. Refresh page → new session, no carryover

**Step 5: Update story to `done` and fill Checkpoint Result**
