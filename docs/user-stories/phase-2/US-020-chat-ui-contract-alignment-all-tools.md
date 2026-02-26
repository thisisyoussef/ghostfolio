# US-020: Chat UI Contract Alignment (All Tools)

## Status

- State: `todo`
- Owner: `youssef`
- Depends on: US-019
- Related PR/Commit:
- Target environment: `prod`

## Persona

**Sam, the End User** wants tool cards that always match real backend payloads and error states.

## User Story

> As Sam, I want all tool outputs rendered consistently so that I can trust the response structure and verification context.

## Goal

Complete frontend contract alignment for every tool payload, including the new rebalance tool, verification metadata, and parse-failure fallbacks.

## Scope

In scope:

1. Add renderer/parser coverage for `portfolio_rebalance_preview`.
2. Validate renderers for market, portfolio, compliance, scenario, and rebalance payload variants.
3. Ensure classified errors and parse failures are consistently surfaced.
4. Ensure verification/source blocks are correctly handled in message rendering.
5. Add component/integration tests for all tool variants.

Out of scope:

1. Large visual redesign.
2. New backend response contracts outside current tool scope.

## Pre-Implementation Audit

1. `apps/client/src/app/pages/agent/tool-result-card/*`
2. `apps/client/src/app/pages/agent/chat-message/*`
3. `apps/api/src/app/agent/tools/*.tool.ts`

## Acceptance Criteria

- [ ] AC1: All tool payloads have deterministic rendering paths.
- [ ] AC2: Rebalance tool has dedicated renderer and tests.
- [ ] AC3: Error and parse-failure states are explicit and user-readable.
- [ ] AC4: Verification/source handling remains accurate after payload updates.
- [ ] AC5: UI tests cover happy, edge, and malformed payload cases.

## Local Validation

```bash
npx nx test client --testPathPattern="agent"
npx nx build client
```

## How To Verify In Prod

- Ask one query per tool type.
- Confirm card rendering matches tool result payload.
- Trigger one parse/error fallback and verify UX state.

## Checkpoint Result

- Commit SHA:
- Production URL(s):
- User Validation: `passed | failed | blocked`
- Definition of Done: `all passed | exceptions noted below`
- Notes:
