# US-016: Fifth Tool - Portfolio Rebalance Preview

## Status

- State: `in-review`
- Owner: `youssef`
- Depends on: US-015
- Related PR/Commit: `local workspace (uncommitted)`
- Target environment: `prod`

## Persona

**Sam, the End User** wants actionable concentration-risk mitigation guidance with transparent assumptions.

## User Story

> As Sam, I want the agent to preview rebalancing trades so that I can see how to reduce concentration risk without executing any trade.

## Goal

Add a fifth production tool `portfolio_rebalance_preview` so the agent meets the 5-tool minimum while delivering a deterministic, read-only rebalance recommendation preview.

## Scope

In scope:

1. Add new tool contract in registry/orchestration: `portfolio_rebalance_preview`.
2. Tool args schema:
   - `targetMaxHoldingPct?: number` (default `20`, bounds `5..35`)
   - `excludeSymbols?: string[]`
3. Tool output schema:
   - `currentTopHoldings`
   - `suggestedTrades`
   - `projectedConcentration`
   - `assumptions`
4. Add tests across unit/integration/behavioral/contract.
5. Keep endpoint compatibility (`/api/v1/agent/chat` additive response behavior only).

Out of scope:

1. Auto-trading or order placement.
2. Broker execution integration.

## Pre-Implementation Audit

1. `apps/api/src/app/agent/orchestration/tool-registry.ts` — current tool list and schema handling.
2. `apps/api/src/app/agent/orchestration/deterministic-agent.service.ts` — routing and response synthesis.
3. `apps/api/src/app/agent/tools/portfolio-analysis.tool.ts` — concentration metrics reused by preview logic.

## Acceptance Criteria

- [x] AC1: Tool registry exposes 5th tool `portfolio_rebalance_preview`.
- [x] AC2: Tool args validation enforces defaults and bounds.
- [x] AC3: Output includes all required fields with deterministic formatting.
- [x] AC4: Agent can invoke and synthesize this tool in natural language responses.
- [x] AC5: Existing tools and response contracts remain backward compatible.

## Local Validation

```bash
npx nx test api --testPathPattern="portfolio-rebalance-preview.tool.spec.ts|tool-registry.spec.ts|deterministic-agent.service.spec.ts|agent.controller.spec.ts|agent.behavioral.spec.ts"
npx nx build api
```

## How To Verify In Prod

- Ask for concentration reduction plan with and without target percent.
- Confirm returned `tool_calls` includes `portfolio_rebalance_preview`.
- Confirm read-only response (no side effects).

## Checkpoint Result

- Commit SHA: `local workspace (uncommitted)`
- Production URL(s): `pending`
- User Validation: `passed (local)`
- Definition of Done: `exceptions noted below`
- Notes:
  - Added new tool module: `apps/api/src/app/agent/tools/portfolio-rebalance-preview.tool.ts`.
  - Added tool unit tests and orchestration/controller/behavioral coverage.
  - Deterministic and graph orchestration now include `portfolio_rebalance_preview`.
  - `/api/v1/agent/chat` remains backward compatible (additive tool support).
  - Production verification is pending deployment/environment check.
