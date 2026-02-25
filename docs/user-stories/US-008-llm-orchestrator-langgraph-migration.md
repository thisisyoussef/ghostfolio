# US-008: LLM Orchestration Migration (LangGraph + Claude Tool Calling)

## Status

- State: `done`
- Owner: `youssef`
- Depends on: US-006
- Related PR/Commit: `Uncommitted (local workspace changes)`
- Target environment: `prod`

## Persona

**Sam, the End User** wants the agent to reason over ambiguous finance requests instead of relying only on keyword routing.

**Alex, the Agent Developer** wants architecture parity with the intended stack (`LangGraph` + `@langchain/anthropic`) while preserving reliability.

## User Story

> As Sam, I want the agent to choose tools through model reasoning so that complex or ambiguous prompts are handled correctly.

## Goal

Replace the current keyword/pattern router with a LangGraph state machine using Claude tool calling, and upgrade memory from lightweight context (`lastSymbols/lastTool/lastTopic`) to full conversation state while retaining deterministic fallbacks and classified error handling.

## Scope

In scope:

1. Add and wire `@langchain/langgraph`, `@langchain/anthropic`, `@langchain/core`.
2. Build graph nodes: `reason` -> `tool` -> `respond` with conditional loops.
3. Convert existing tools (`market_data_fetch`, `portfolio_risk_analysis`, `compliance_check`) into model-callable tool contracts.
4. Replace contextual memory with full per-session message history (`role`, `content`, tool context) and bounded context-window/summarization policy.
5. Add fallback path when model call fails/timeouts (no crash, no stack leak).
6. Update tracing so model spans and tool spans appear in LangSmith.

Out of scope:

1. Multi-agent architecture.
2. New business tools (rebalancing/tax/etc.).
3. Fine-tuning or prompt optimization experiments.

## Pre-Implementation Audit

1. `apps/api/src/app/agent/agent.service.ts` — current deterministic orchestrator.
2. `apps/api/src/app/agent/tools/*.tool.ts` — tool contracts to expose to model.
3. `apps/api/src/app/agent/memory/session-memory.service.ts` — current lightweight contextual memory implementation.
4. `apps/api/src/app/agent/tracing/langsmith.config.ts` — tracing defaults and project/workspace settings.
5. `docs/user-stories/US-003-thin-vertical-slice-market-data.md` — original intended LangGraph architecture intent.

## TDD Plan (Minimum)

1. Unit: tool schema validation + model-response parser behavior.
2. Integration: `POST /api/v1/agent/chat` tool routing through graph.
3. Behavioral: ambiguous prompt routing, multi-step chain, fallback on model timeout, and deep multi-turn recall (>3 turns).
4. Contract: response shape unchanged (`response`, `tool_calls`, `session_id`, optional error flags).

## Acceptance Criteria

- [x] AC1: Graph orchestration is active in production path (flag-gated in `AgentService`).
- [x] AC2: At least one multi-step flow invokes 2 tools in one turn (behavioral + graph tests).
- [x] AC3: Model failure returns graceful `model` error path without 500 (timeout/fallback tests).
- [x] AC4: Existing deterministic tests still pass or are replaced with graph-equivalent tests.
- [x] AC5: Session memory supports full conversation recall across at least 5 turns in same `session_id`.
- [x] AC6: LangSmith trace shows model span + child tool spans for a successful run (code path + span metadata wiring complete; production trace spot-check still recommended after deploy).

## Local Validation

```bash
# Agent test suites
npx dotenv-cli -e .env.example -- npx jest --config apps/api/jest.config.ts --runInBand "apps/api/src/app/agent/"

# Story-focused tests (new)
npx dotenv-cli -e .env.example -- npx nx test api --testPathPatterns="apps/api/src/app/agent/.*(behavioral|controller|service|graph)"

# Build
npx nx build api

# Full API regression check (passes with .env.example TZ=UTC)
npx dotenv-cli -e .env.example -- npx nx test api
```

## How To Verify In Prod

- Production URL: `https://ghostfolio-production-e8d1.up.railway.app/en/agent`
- Verify:
1. Ask ambiguous query ("How risky am I and is it ESG compliant?") -> coherent answer with relevant tool calls.
2. Ask follow-up without symbols/context after 3+ turns -> response correctly uses earlier context.
3. Simulate model failure (invalid key in staging) -> graceful error message + no crash.
4. Confirm trace entries in LangSmith project `ghostfolio-agent`.

## Checkpoint Result

- Commit SHA: `Uncommitted (local workspace changes)`
- Production URL(s): `https://ghostfolio-production-e8d1.up.railway.app/en/agent`
- User Validation: `pending`
- Definition of Done: `all local acceptance checks passed`
- Notes:
  - Runtime fallback retained and feature-flagged (`ENABLE_FEATURE_AGENT_LANGGRAPH`).
  - Story-local tests are green with `--testPathPatterns` (plural); previous singular flag runs broad suites.
  - Added `TZ=UTC` to `.env.example` to prevent timezone-driven API test flakiness.
  - Added explicit `cache-manager` dependency to satisfy `@nestjs/cache-manager` peer resolution.
  - Node 22.18+ is still required for release parity and production deployment.
  - 2026-02-25 regression patch:
    - Deterministic fallback now handles combined risk + ESG prompts in one response with 2 tool calls.
    - ESG follow-up prompts now support impact ranking and remove-worst/remove-all hypothetical score simulation.
    - Portfolio response now includes explicit `High|Medium|Low` risk label.
    - Graph fallback usage is now explicit in user response text and warning logs to avoid silent mode ambiguity.
