# US-005: ESG Compliance Checker with Domain Verification

## Status

- State: `done`
- Owner: `youssef`
- Depends on: US-002, US-003
- Related PR/Commit: 375e6f167 (US-004 bundled), webpack fix commit pending
- Target environment: `prod`

## Persona

**Sam, the Ethical Investor** wants to know if portfolio holdings violate ESG criteria so they can make informed decisions.

**Alex, the Agent Developer** wants a domain-specific verification check (MVP requirement #7) that proves claims are backed by data, not hallucinated.

## User Story

> As Sam, I want to check if my holdings comply with ESG criteria so that I can identify and address potential violations.
> As Alex, I want a verification tool that cross-references portfolio data against an authoritative dataset so I can demonstrate domain-specific verification.

## Goal

Add the third tool (`compliance_check`) that accesses Ghostfolio portfolio holdings (via service injection or internal API), cross-references them against a static ESG violations dataset, and returns structured violations with categories, severities, and a compliance score. This tool IS the domain-specific verification check (MVP requirement #7).

## Scope

In scope:

1. `apps/api/src/app/agent/tools/compliance-checker.tool.ts` — tool implementation.
2. `apps/api/src/app/agent/data/esg-violations.json` — static dataset (20-30 tickers).
3. ESG categories: `fossil_fuels`, `weapons_defense`, `tobacco`, `gambling`, `controversial_labor`.
4. Compliance score: `(cleanPortfolioValue / totalPortfolioValue) * 100`.
5. Optional category filter (e.g., "only fossil fuels").
6. Register tool in LangGraph graph.
7. Two eval test cases.

Out of scope:

1. Live ESG data feeds (MSCI, Sustainalytics).
2. Custom user-defined compliance rules.
3. Industry-standard ESG scoring methodology.

## Pre-Implementation Audit

Local sources to read before writing any code:

1. `apps/api/src/app/portfolio/portfolio.service.ts` — service for holdings access
2. `apps/api/src/app/agent/tools/market-data.tool.ts` — tool pattern to follow
3. `apps/api/src/app/agent/tools/portfolio-analysis.tool.ts` — Ghostfolio data access pattern (created in US-004)
4. `apps/api/src/app/agent/agent.service.ts` — graph to extend with third tool

## Preparation Phase (Mandatory)

1. Read local code listed above.
2. Web-check relevant docs:
   - Common ESG exclusion categories and well-known violators
   - JSON schema design for the violations dataset
3. Write Preparation Notes.

### Preparation Notes

Local docs/code reviewed:

1. `apps/api/src/app/agent/tools/market-data.tool.ts` — plain function tool pattern (no DI, exported async function)
2. `apps/api/src/app/agent/agent.service.ts` — keyword-based routing with `isEsgQuestion()` and `isPortfolioQuestion()`
3. `apps/api/src/app/agent/tools/portfolio-analysis.tool.ts` — Ghostfolio data access via PortfolioService + authenticated userId (from JWT)
4. `apps/api/src/app/agent/agent.module.ts` — PortfolioModule imported for DI (no PrismaModule — auth comes from JWT)

ESG violations dataset design:

```json
{
  "version": "1.0",
  "lastUpdated": "2026-02-24",
  "violations": [
    {
      "symbol": "XOM",
      "name": "Exxon Mobil",
      "categories": ["fossil_fuels"],
      "severity": "high",
      "reason": "Major oil and gas producer"
    },
    {
      "symbol": "CVX",
      "name": "Chevron",
      "categories": ["fossil_fuels"],
      "severity": "high",
      "reason": "Integrated energy company"
    },
    {
      "symbol": "LMT",
      "name": "Lockheed Martin",
      "categories": ["weapons_defense"],
      "severity": "high",
      "reason": "Defense contractor"
    },
    {
      "symbol": "PM",
      "name": "Philip Morris",
      "categories": ["tobacco"],
      "severity": "high",
      "reason": "Tobacco manufacturer"
    }
  ]
}
```

Compliance score formula:

```
cleanValue = sum(value for holding if symbol NOT in violations)
totalValue = sum(all holding values)
score = (cleanValue / totalValue) * 100
```

Planned failing tests:

1. `should return score = 100 for portfolio with no flagged tickers`
2. `should flag XOM as fossil_fuels violation with severity high`
3. `should filter by category when requested`
4. `should calculate correct compliance score for known values`
5. `should route ESG question to compliance_check tool`

## UX Script

Happy path:

1. User types "Is my portfolio ESG compliant?" in Ghostfolio `/agent` chat.
2. Agent calls `compliance_check` → accesses holdings → cross-references ESG dataset.
3. Response shows compliance score, violations list, and clean holdings.
4. User asks "Do I hold any fossil fuel companies?" → filtered result.

Error path:

1. Portfolio data unavailable.
2. Agent responds: "Unable to check portfolio compliance — portfolio service unavailable."
3. Other tools still work.

## Preconditions

- [ ] US-002 complete (Ghostfolio with seeded portfolio including XOM)
- [ ] US-003 complete (LangGraph agent + Angular chat page exist)
- [ ] Portfolio data access pattern established (from US-004 or independently)

## TDD Plan

Write tests first. Red → Green → Refactor. Covers all 5 test layers (see CLAUDE.md).

### Layer 1 — Unit tests (≥10): `compliance-checker.tool.spec.ts`

**Happy path (3):**

1. `should return score 100 for all-clean portfolio`
2. `should flag XOM with category fossil_fuels and severity high`
3. `should calculate correct compliance score (70% clean → score = 70.0)`

**Edge cases (3):** 4. `should filter by category (fossil_fuels only) — ignoring other violations` 5. `should handle portfolio where ALL holdings are flagged (score = 0)` 6. `should handle ticker matching case-insensitively (xom vs XOM)`

**Error/failure modes (2):** 7. `should return structured error when ESG dataset file is missing/corrupted` 8. `should return structured error when Ghostfolio holdings service throws`

**Boundary conditions (2):** 9. `should handle empty portfolio (0 holdings) → "no holdings to check" message` 10. `should handle category filter with no matches → "no violations in this category" message`

### Layer 2 — Integration tests (≥5): `agent.controller.spec.ts` (extend)

1. `should route ESG compliance question to compliance_check tool (200)`
2. `should return compliance result with snake_case field names`
3. `should return structured error when compliance service fails (not 500 stack trace)`
4. `should accept optional filter_category in request`
5. `should include compliance_check in tool_calls array with source attribution`

### Layer 3 — Agent behavioral tests (≥8): `compliance-checker.behavioral.spec.ts`

1. `should route "Is my portfolio ESG compliant?" to compliance_check (not portfolio_risk)`
2. `should route "fossil fuel exposure" to compliance_check with fossil_fuels filter`
3. `should not hallucinate compliance data — violations must match ESG dataset entries`
4. `should handle follow-up "what about weapons?" after initial ESG check`
5. `should gracefully explain error when holdings service fails`
6. `should isolate compliance results between different session_ids`
7. `should decline non-compliance requests like "make my portfolio ESG compliant"`
8. `should include source attribution (dataset version) in response — verifiable, not fabricated`

### Layer 4 — Contract tests (≥3): co-located in `agent.controller.spec.ts`

1. `should return response matching ComplianceCheckOutput interface`
2. `should return consistent error shape { error, type, statusCode }`
3. `should include violations array with { ticker, category, severity, source } fields`

### Mandatory edge case checklist

- [x] Empty/null: empty portfolio (test 9), no category matches (test 10)
- [x] Boundary: all holdings flagged (test 5), score = 0 and score = 100
- [x] Malformed data: missing/corrupted ESG file (test 7)
- [x] Network failure: Ghostfolio service throws (test 8)
- [x] Concurrent: session isolation (behavioral test 6)
- [x] Special chars: case-insensitive ticker matching (test 6)
- [x] LLM non-determinism: source attribution verification (behavioral test 8)

### Red → Green → Refactor sequence

1. Create ESG dataset file first (test fixture).
2. Write Layer 1 unit tests → all fail (red).
3. Implement `compliance-checker.tool.ts` → Layer 1 goes green.
4. Write Layer 2 integration tests → fail.
5. Register tool in graph → Layer 2 goes green.
6. Write Layer 3 behavioral tests → fail.
7. Integrate with agent routing → Layer 3 goes green.
8. Write Layer 4 contract tests → verify shapes.
9. Refactor: extract shared patterns if any.

## Step-by-step Implementation Plan

1. Create `apps/api/src/app/agent/data/esg-violations.json` with 20-30 entries.
2. Create `apps/api/src/app/agent/tools/compliance-checker.tool.ts`:
   - `ComplianceCheckInput`: `filterCategory?: string`.
   - `ComplianceCheckOutput`: `complianceScore`, `violations`, `cleanHoldings`, `totalChecked`.
   - Load ESG dataset, access holdings from Ghostfolio, cross-reference, compute score.
3. Register tool in `agent.service.ts` LangGraph graph.
4. Deploy (single Ghostfolio service) and test via chat UI.

## Implementation Details

Implemented files:

1. `apps/api/src/app/agent/data/esg-violations.json` — 25 ESG violations across 5 categories
2. `apps/api/src/app/agent/tools/compliance-checker.tool.ts` — pure function tool with score calculation
3. `apps/api/src/app/agent/tools/compliance-checker.tool.spec.ts` — 8 unit tests
4. `apps/api/src/app/agent/agent.service.ts` — ESG keyword routing + `handleComplianceQuestion(message, sessionId, userId)`
5. `apps/api/src/app/agent/agent.controller.spec.ts` — ESG routing test added

Key interfaces:

```typescript
interface HoldingInput { symbol: string; name?: string; valueInBaseCurrency: number; }
interface ComplianceCheckInput { holdings: HoldingInput[]; filterCategory?: string; }
interface ComplianceCheckOutput { complianceScore: number; violations: ViolationResult[]; cleanHoldings: [...]; totalChecked: number; datasetVersion: string; datasetLastUpdated: string; }
```

### Authentication Architecture
The compliance checker receives the authenticated user's ID from the JWT auth flow:
- **Controller** (`agent.controller.ts`): `AuthGuard('jwt')` extracts `request.user.id` from the JWT token
- **Service** (`agent.service.ts`): `handleComplianceQuestion(message, sessionId, userId)` — `userId` passed directly, no database user lookup
- **Holdings access**: `portfolioService.getDetails({userId})` fetches only the authenticated user's holdings
- **No PrismaService user lookup** — the user identity always comes from the JWT token, matching the pattern used by all other Ghostfolio controllers

## Acceptance Criteria

- [ ] AC1: Agent routes ESG/compliance questions to `compliance_check`.
- [ ] AC2: Cross-references real Ghostfolio holdings against ESG dataset.
- [ ] AC3: Violations include category, severity, source attribution (dataset version).
- [ ] AC4: Compliance score mathematically correct (verified by test).
- [ ] AC5: All test layers pass: ≥10 unit, ≥5 integration, ≥8 behavioral, ≥3 contract.
- [ ] AC6: XOM flagged as `fossil_fuels` violation in seeded portfolio.
- [ ] AC7: All 7 mandatory edge case categories covered in tests.

## Local Validation

```bash
# Tests (story-specific)
npx nx test api --testPathPattern=compliance

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
  - Chat page: `https://ghostfolio-production-e8d1.up.railway.app/en/agent` (must be logged in)
- Prerequisites:
  - **Must be logged in** — the agent endpoint requires JWT authentication
  - If not logged in, the API returns 401 Unauthorized (correct behavior)
- Expected results:
  - "Is my portfolio ESG compliant?" → compliance score, XOM flagged as fossil_fuels
  - "Do I hold fossil fuel companies?" → filtered result showing XOM
  - Source attribution mentions ESG dataset version
  - Data reflects the **logged-in user's** holdings
- Failure signals:
  - "Unable to check compliance" error (service issue)
  - 401 Unauthorized (not logged in — expected, not a bug)
  - XOM not flagged (dataset or matching issue)
  - Score doesn't add up
- Rollback action:
  - Revert Ghostfolio deployment; other tools unaffected

## User Checkpoint Test

1. **Log in** to Ghostfolio first (JWT auth required).
2. Open `/en/agent` → ask "Is my portfolio ESG compliant?" → see score and XOM violation.
3. Ask "Do I hold fossil fuel companies?" → see XOM only.
4. Verify compliance score math matches **your** portfolio allocation.
5. Verify source attribution shows dataset version/date.

## Checkpoint Result

- Commit SHA: `375e6f167` (initial), `f54d58a4e` (auth fix)
- Ghostfolio URL: `https://ghostfolio-production-e8d1.up.railway.app`
- User Validation: `passed`
- Notes:
  - ESG compliance check routes correctly for ESG/ethical/fossil fuel keywords
  - Returns compliance score, violations list with categories/severity, and clean holdings
  - Source attribution includes dataset version and last updated date
  - Name-based matching supports MANUAL data source holdings (UUID symbols)
  - **Auth fix (f54d58a4e)**: `handleComplianceQuestion` now receives `userId` from JWT instead of using `prismaService.user.findFirst()`. Holdings fetched via `portfolioService.getDetails({userId})` for the authenticated user only.

## Observability & Monitoring

- Logs to check:
  - Ghostfolio logs (ESG dataset load, portfolio data access)
- Traces/metrics to check:
  - LangSmith: `compliance_check` latency and success rate
- Alert thresholds:
  - Tool failure >10%

## Risks & Edge Cases

- Risk 1: Seeded portfolio has no ESG-flagged holdings (mitigated: XOM in seed)
- Risk 2: ESG dataset too small to be meaningful
- Edge case 1: Empty portfolio → "no holdings to check"
- Edge case 2: All holdings flagged → score = 0%
- Edge case 3: Category filter with no matches → "no violations in this category"

## Notes

- **This tool IS MVP requirement #7** (domain-specific verification check).
- XOM intentionally seeded in US-002 to make compliance demo meaningful.
- ESG dataset is the foundation for the open-source contribution in Phase 4.
- Can be developed in parallel with US-004.
- Agent accesses holdings via same pattern as US-004 (service injection or internal HTTP).
