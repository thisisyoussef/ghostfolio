# Eval Framework (Stages 1+2) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a deterministic eval framework with 20 golden test cases that runs binary checks (tool selection, content validation, negative validation) against any Ghostfolio agent deployment.

**Architecture:** A standalone TypeScript eval runner reads golden test cases from YAML, authenticates via the anonymous auth endpoint, sends queries to the agent chat endpoint, and runs 3 binary checks per case. A separate Jest spec tests the runner's own logic. Results print as a summary table + coverage matrix.

**Tech Stack:** TypeScript, js-yaml, node fetch, Jest (for runner tests only), npx tsx (for standalone execution)

---

## Prerequisites

- Working directory: `/Users/youss/Development/gauntlet/agentforge/ghostfolio`
- Agent code at: `apps/api/src/app/agent/`
- Auth endpoint: `POST /api/auth/anonymous` accepts `{ accessToken: string }`, returns `{ authToken: string }`
- Chat endpoint: `POST /api/v1/agent/chat` accepts `{ message: string, session_id: string }`, returns `{ response: string, tool_calls: ToolCallDto[], session_id: string }`
- Chat endpoint is behind `AuthGuard('jwt')` — needs `Authorization: Bearer <jwt>` header
- Agent uses keyword-based routing (deterministic, no LLM):
  - ESG keywords → `compliance_check` tool
  - Portfolio keywords → `portfolio_risk_analysis` tool
  - Detected ticker symbols → `market_data_fetch` tool
  - No match → help message

---

### Task 1: Install js-yaml as dev dependency

**Files:**

- Modify: `package.json`

**Step 1: Install js-yaml and its types**

Run:

```bash
npm install --save-dev js-yaml @types/js-yaml
```

**Step 2: Verify installation**

Run:

```bash
node -e "require('js-yaml'); console.log('ok')"
```

Expected: `ok`

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add js-yaml dev dependency for eval framework"
```

---

### Task 2: Create types.ts

**Files:**

- Create: `apps/api/src/app/agent/evals/types.ts`

**Step 1: Create the types file**

```typescript
/**
 * TypeScript interfaces for the eval framework.
 * Stage 1 (Golden Sets) + Stage 2 (Labeled Scenarios).
 */

/** A single turn in a multi-turn eval case */
export interface EvalTurn {
  query: string;
  expected_tools: string[];
  must_contain: string[];
  must_not_contain: string[];
}

/** A golden eval case — either single-turn (query) or multi-turn (turns) */
export interface GoldenCase {
  id: string;
  /** Single-turn query. Mutually exclusive with `turns`. */
  query?: string;
  /** Multi-turn sequence. Mutually exclusive with `query`. */
  turns?: EvalTurn[];
  /** Stage 2 label: top-level category (market_data, portfolio, compliance, etc.) */
  category: string;
  /** Stage 2 label: subcategory within the category */
  subcategory: string;
  /** Stage 2 label: difficulty level */
  difficulty: 'straightforward' | 'ambiguous' | 'edge_case';
  /** Expected tool names in tool_calls (single-turn only; multi-turn uses per-turn) */
  expected_tools: string[];
  /** Substrings that MUST appear in the response (case-insensitive) */
  must_contain: string[];
  /** Substrings that MUST NOT appear in the response (case-insensitive) */
  must_not_contain: string[];
}

/** The top-level structure of golden-data.yaml */
export interface GoldenDataFile {
  version: string;
  stage: number;
  cases: GoldenCase[];
}

/** Result of checking a single eval case */
export interface EvalResult {
  case_id: string;
  passed: boolean;
  checks: {
    tool_selection: boolean;
    content_validation: boolean;
    negative_validation: boolean;
  };
  response_text: string;
  actual_tools: string[];
  duration_ms: number;
  error?: string;
}

/** Summary of an eval run */
export interface EvalSummary {
  total: number;
  passed: number;
  failed: number;
  pass_rate: number;
  by_category: Record<string, { total: number; passed: number }>;
  by_difficulty: Record<string, { total: number; passed: number }>;
  results: EvalResult[];
}

/** Shape of the agent chat API response */
export interface ChatApiResponse {
  response: string;
  tool_calls: { name: string; args: Record<string, unknown>; result: string }[];
  session_id: string;
}
```

**Step 2: Verify it compiles**

Run:

```bash
npx tsc --noEmit apps/api/src/app/agent/evals/types.ts --esModuleInterop --moduleResolution node --target ES2020 --module commonjs
```

Expected: No errors.

**Step 3: Commit**

```bash
git add apps/api/src/app/agent/evals/types.ts
git commit -m "feat(evals): add TypeScript interfaces for eval framework"
```

---

### Task 3: Create golden-data.yaml with 20 cases

**Files:**

- Create: `apps/api/src/app/agent/evals/golden-data.yaml`

**Step 1: Create the golden data file**

This file contains all 20 eval cases. Key considerations:

- Queries must contain the right keywords to trigger routing (see `agent.service.ts` keyword arrays)
- `must_contain` should be substrings that will definitely appear in formatted responses
- `must_not_contain` catches failure/hallucination indicators
- Multi-turn cases use `turns` array; single-turn cases use `query`
- For market data: the agent's `extractSymbols()` requires 2+ uppercase letters not in the common words set
- For portfolio: needs a PORTFOLIO_KEYWORDS match like "portfolio", "risk", "allocation", "diversif", "performance"
- For compliance: needs an ESG_KEYWORDS match like "esg", "compliance", "ethical", etc.

```yaml
version: '1.0'
stage: 2

cases:
  # ──────────────────────────────────────────────
  # MARKET DATA (5 cases)
  # ──────────────────────────────────────────────

  - id: 'gs-001'
    query: 'What is the current price of AAPL?'
    category: 'market_data'
    subcategory: 'single_symbol'
    difficulty: 'straightforward'
    expected_tools:
      - 'market_data_fetch'
    must_contain:
      - 'AAPL'
    must_not_contain:
      - 'unable to'
      - "I don't know"
      - 'I can help you with'

  - id: 'gs-002'
    query: 'Show me the prices of MSFT and GOOGL'
    category: 'market_data'
    subcategory: 'multi_symbol'
    difficulty: 'straightforward'
    expected_tools:
      - 'market_data_fetch'
    must_contain:
      - 'MSFT'
      - 'GOOGL'
    must_not_contain:
      - 'unable to'
      - 'I can help you with'

  - id: 'gs-003'
    query: 'What is the price of BTC-USD?'
    category: 'market_data'
    subcategory: 'crypto'
    difficulty: 'straightforward'
    expected_tools:
      - 'market_data_fetch'
    must_contain:
      - 'BTC'
    must_not_contain:
      - 'I can help you with'

  - id: 'gs-004'
    query: 'Get me the price of XYZNOTREAL'
    category: 'market_data'
    subcategory: 'invalid_symbol'
    difficulty: 'edge_case'
    expected_tools:
      - 'market_data_fetch'
    must_contain:
      - 'XYZNOTREAL'
    must_not_contain:
      - 'I can help you with'

  - id: 'gs-005'
    query: 'What is the price of BRK.B?'
    category: 'market_data'
    subcategory: 'edge_symbol'
    difficulty: 'edge_case'
    expected_tools:
      - 'market_data_fetch'
    must_contain:
      - 'BRK'
    must_not_contain:
      - 'I can help you with'

  # ──────────────────────────────────────────────
  # PORTFOLIO ANALYSIS (5 cases)
  # ──────────────────────────────────────────────

  - id: 'gs-006'
    query: 'What is my portfolio concentration risk?'
    category: 'portfolio'
    subcategory: 'risk_summary'
    difficulty: 'straightforward'
    expected_tools:
      - 'portfolio_risk_analysis'
    must_contain:
      - 'Portfolio'
    must_not_contain:
      - 'I can help you with'
      - 'unable to'

  - id: 'gs-007'
    query: 'Show me my asset allocation breakdown'
    category: 'portfolio'
    subcategory: 'allocation'
    difficulty: 'straightforward'
    expected_tools:
      - 'portfolio_risk_analysis'
    must_contain:
      - 'Allocation'
    must_not_contain:
      - 'I can help you with'

  - id: 'gs-008'
    query: 'Analyze my portfolio risk and holdings'
    category: 'portfolio'
    subcategory: 'empty_portfolio'
    difficulty: 'edge_case'
    expected_tools:
      - 'portfolio_risk_analysis'
    must_contain: []
    must_not_contain: []

  - id: 'gs-009'
    query: 'How diversified is my portfolio?'
    category: 'portfolio'
    subcategory: 'single_holding'
    difficulty: 'ambiguous'
    expected_tools:
      - 'portfolio_risk_analysis'
    must_contain:
      - 'Portfolio'
    must_not_contain:
      - 'I can help you with'

  - id: 'gs-010'
    query: 'What is my portfolio performance and returns?'
    category: 'portfolio'
    subcategory: 'diversification'
    difficulty: 'straightforward'
    expected_tools:
      - 'portfolio_risk_analysis'
    must_contain:
      - 'Portfolio'
    must_not_contain:
      - 'I can help you with'

  # ──────────────────────────────────────────────
  # COMPLIANCE (5 cases)
  # ──────────────────────────────────────────────

  - id: 'gs-011'
    query: 'Run a full ESG compliance check on my portfolio'
    category: 'compliance'
    subcategory: 'full_check'
    difficulty: 'straightforward'
    expected_tools:
      - 'compliance_check'
    must_contain:
      - 'ESG Compliance Report'
      - 'Compliance Score'
    must_not_contain:
      - 'I can help you with'

  - id: 'gs-012'
    query: 'Is my portfolio compliant with ESG standards regarding fossil fuels?'
    category: 'compliance'
    subcategory: 'specific_flag'
    difficulty: 'straightforward'
    expected_tools:
      - 'compliance_check'
    must_contain:
      - 'ESG Compliance Report'
      - 'fossil'
    must_not_contain:
      - 'I can help you with'

  - id: 'gs-013'
    query: 'Check ESG compliance for tobacco exposure only'
    category: 'compliance'
    subcategory: 'category_filter'
    difficulty: 'ambiguous'
    expected_tools:
      - 'compliance_check'
    must_contain:
      - 'ESG Compliance Report'
    must_not_contain:
      - 'I can help you with'

  - id: 'gs-014'
    query: 'Is my portfolio ESG compliant?'
    category: 'compliance'
    subcategory: 'clean_portfolio'
    difficulty: 'straightforward'
    expected_tools:
      - 'compliance_check'
    must_contain:
      - 'ESG Compliance Report'
      - 'Compliance Score'
    must_not_contain:
      - 'I can help you with'

  - id: 'gs-015'
    query: 'What ESG compliance data source and version are you using?'
    category: 'compliance'
    subcategory: 'source_attribution'
    difficulty: 'ambiguous'
    expected_tools:
      - 'compliance_check'
    must_contain:
      - 'ESG'
    must_not_contain:
      - 'I can help you with'

  # ──────────────────────────────────────────────
  # MULTI-TURN (3 cases)
  # ──────────────────────────────────────────────

  - id: 'gs-016'
    turns:
      - query: 'What is the price of AAPL?'
        expected_tools:
          - 'market_data_fetch'
        must_contain:
          - 'AAPL'
        must_not_contain:
          - 'I can help you with'
      - query: 'Now check my portfolio risk'
        expected_tools:
          - 'portfolio_risk_analysis'
        must_contain:
          - 'Portfolio'
        must_not_contain:
          - 'I can help you with'
    category: 'multi_turn'
    subcategory: 'tool_switching'
    difficulty: 'ambiguous'
    expected_tools: []
    must_contain: []
    must_not_contain: []

  - id: 'gs-017'
    turns:
      - query: 'What is the price of MSFT?'
        expected_tools:
          - 'market_data_fetch'
        must_contain:
          - 'MSFT'
        must_not_contain:
          - 'I can help you with'
      - query: 'And GOOGL?'
        expected_tools:
          - 'market_data_fetch'
        must_contain:
          - 'GOOGL'
        must_not_contain:
          - 'I can help you with'
    category: 'multi_turn'
    subcategory: 'context_retention'
    difficulty: 'ambiguous'
    expected_tools: []
    must_contain: []
    must_not_contain: []

  - id: 'gs-018'
    turns:
      - query: ''
        expected_tools: []
        must_contain:
          - 'provide a message'
        must_not_contain: []
      - query: 'What is the price of TSLA?'
        expected_tools:
          - 'market_data_fetch'
        must_contain:
          - 'TSLA'
        must_not_contain:
          - 'I can help you with'
    category: 'multi_turn'
    subcategory: 'error_recovery_context'
    difficulty: 'edge_case'
    expected_tools: []
    must_contain: []
    must_not_contain: []

  # ──────────────────────────────────────────────
  # ERROR RECOVERY (2 cases)
  # ──────────────────────────────────────────────

  - id: 'gs-019'
    query: ''
    category: 'error_recovery'
    subcategory: 'empty_message'
    difficulty: 'edge_case'
    expected_tools: []
    must_contain:
      - 'provide a message'
    must_not_contain:
      - 'error'
      - '500'
      - 'Internal Server Error'

  - id: 'gs-020'
    query: 'PLACEHOLDER_LONG_INPUT'
    category: 'error_recovery'
    subcategory: 'long_input'
    difficulty: 'edge_case'
    expected_tools: []
    must_contain: []
    must_not_contain:
      - '500'
      - 'Internal Server Error'
```

Note on gs-020: The eval runner will replace `PLACEHOLDER_LONG_INPUT` with a 10K character string at runtime. This avoids bloating the YAML file.

**Step 2: Validate YAML parses**

Run:

```bash
node -e "const yaml = require('js-yaml'); const fs = require('fs'); const data = yaml.load(fs.readFileSync('apps/api/src/app/agent/evals/golden-data.yaml', 'utf8')); console.log(data.cases.length + ' cases parsed')"
```

Expected: `20 cases parsed`

**Step 3: Commit**

```bash
git add apps/api/src/app/agent/evals/golden-data.yaml
git commit -m "feat(evals): add 20 golden test cases for Stage 1+2 eval framework"
```

---

### Task 4: Write eval-runner.spec.ts (RED phase — failing tests first)

**Files:**

- Create: `apps/api/src/app/agent/evals/eval-runner.spec.ts`

This file tests the eval runner's internal logic WITHOUT hitting a real server. It imports pure functions from the runner and validates parsing, checking, and summarization. All HTTP calls are mocked.

**Step 1: Write the full test file**

The test file should import and test these functions (which we'll implement in Task 5):

- `loadGoldenData(yamlPath)` — parses YAML into GoldenCase[]
- `checkToolSelection(expected, actual)` — binary check
- `checkContentValidation(mustContain, responseText)` — case-insensitive
- `checkNegativeValidation(mustNotContain, responseText)` — case-insensitive
- `buildCoverageMatrix(results, cases)` — returns matrix data structure
- `computeSummary(results, cases)` — returns EvalSummary

```typescript
import * as path from 'path';

import {
  loadGoldenData,
  checkToolSelection,
  checkContentValidation,
  checkNegativeValidation,
  buildCoverageMatrix,
  computeSummary
} from './eval-runner';
import type { EvalResult, GoldenCase } from './types';

describe('Eval Runner — Unit Tests', () => {
  // ─── YAML Parsing ───

  describe('loadGoldenData', () => {
    it('should parse golden-data.yaml and return all 20 cases', () => {
      const goldenPath = path.join(__dirname, 'golden-data.yaml');
      const data = loadGoldenData(goldenPath);
      expect(data.cases).toHaveLength(20);
      expect(data.version).toBe('1.0');
      expect(data.stage).toBe(2);
    });

    it('should parse single-turn cases with query field', () => {
      const goldenPath = path.join(__dirname, 'golden-data.yaml');
      const data = loadGoldenData(goldenPath);
      const gs001 = data.cases.find((c) => c.id === 'gs-001');
      expect(gs001).toBeDefined();
      expect(gs001!.query).toBe('What is the current price of AAPL?');
      expect(gs001!.turns).toBeUndefined();
      expect(gs001!.expected_tools).toEqual(['market_data_fetch']);
    });

    it('should parse multi-turn cases with turns array', () => {
      const goldenPath = path.join(__dirname, 'golden-data.yaml');
      const data = loadGoldenData(goldenPath);
      const gs016 = data.cases.find((c) => c.id === 'gs-016');
      expect(gs016).toBeDefined();
      expect(gs016!.turns).toHaveLength(2);
      expect(gs016!.turns![0].query).toBe('What is the price of AAPL?');
      expect(gs016!.turns![1].expected_tools).toEqual([
        'portfolio_risk_analysis'
      ]);
    });

    it('should throw on invalid YAML path', () => {
      expect(() => loadGoldenData('/nonexistent/path.yaml')).toThrow();
    });
  });

  // ─── Tool Selection Check ───

  describe('checkToolSelection', () => {
    it('should pass when all expected tools are present', () => {
      expect(
        checkToolSelection(['market_data_fetch'], ['market_data_fetch'])
      ).toBe(true);
    });

    it('should pass when expected is subset of actual', () => {
      expect(
        checkToolSelection(
          ['market_data_fetch'],
          ['market_data_fetch', 'compliance_check']
        )
      ).toBe(true);
    });

    it('should fail when expected tool is missing', () => {
      expect(
        checkToolSelection(['market_data_fetch'], ['compliance_check'])
      ).toBe(false);
    });

    it('should pass when both expected and actual are empty (no tool expected)', () => {
      expect(checkToolSelection([], [])).toBe(true);
    });

    it('should pass when expected is empty but tools were called', () => {
      expect(checkToolSelection([], ['market_data_fetch'])).toBe(true);
    });

    it('should fail when expected tool present but actual is empty', () => {
      expect(checkToolSelection(['market_data_fetch'], [])).toBe(false);
    });
  });

  // ─── Content Validation Check ───

  describe('checkContentValidation', () => {
    it('should pass when all must_contain strings are present (case-insensitive)', () => {
      expect(
        checkContentValidation(
          ['AAPL', 'price'],
          'AAPL (Apple Inc.): $195.23 price data'
        )
      ).toBe(true);
    });

    it('should be case-insensitive', () => {
      expect(
        checkContentValidation(['aapl'], 'AAPL (Apple Inc.): $195.23')
      ).toBe(true);
    });

    it('should fail when a must_contain string is missing', () => {
      expect(
        checkContentValidation(['AAPL', 'MSFT'], 'AAPL (Apple Inc.): $195.23')
      ).toBe(false);
    });

    it('should pass when must_contain is empty', () => {
      expect(checkContentValidation([], 'any response')).toBe(true);
    });

    it('should fail when response is empty but must_contain has values', () => {
      expect(checkContentValidation(['AAPL'], '')).toBe(false);
    });
  });

  // ─── Negative Validation Check ───

  describe('checkNegativeValidation', () => {
    it('should pass when no must_not_contain strings are present', () => {
      expect(
        checkNegativeValidation(
          ['unable to', "I don't know"],
          'AAPL (Apple Inc.): $195.23'
        )
      ).toBe(true);
    });

    it('should fail when a must_not_contain string is found (case-insensitive)', () => {
      expect(
        checkNegativeValidation(['unable to'], 'I was Unable To fetch the data')
      ).toBe(false);
    });

    it('should pass when must_not_contain is empty', () => {
      expect(checkNegativeValidation([], 'any response')).toBe(true);
    });

    it('should pass on empty response when must_not_contain has values', () => {
      expect(checkNegativeValidation(['error'], '')).toBe(true);
    });
  });

  // ─── Summary Computation ───

  describe('computeSummary', () => {
    const mockCases: GoldenCase[] = [
      {
        id: 'gs-001',
        query: 'test',
        category: 'market_data',
        subcategory: 'single_symbol',
        difficulty: 'straightforward',
        expected_tools: ['market_data_fetch'],
        must_contain: ['AAPL'],
        must_not_contain: []
      },
      {
        id: 'gs-006',
        query: 'test',
        category: 'portfolio',
        subcategory: 'risk',
        difficulty: 'straightforward',
        expected_tools: ['portfolio_risk_analysis'],
        must_contain: [],
        must_not_contain: []
      },
      {
        id: 'gs-004',
        query: 'test',
        category: 'market_data',
        subcategory: 'invalid',
        difficulty: 'edge_case',
        expected_tools: ['market_data_fetch'],
        must_contain: [],
        must_not_contain: []
      }
    ];

    const mockResults: EvalResult[] = [
      {
        case_id: 'gs-001',
        passed: true,
        checks: {
          tool_selection: true,
          content_validation: true,
          negative_validation: true
        },
        response_text: 'AAPL: $195',
        actual_tools: ['market_data_fetch'],
        duration_ms: 100
      },
      {
        case_id: 'gs-006',
        passed: false,
        checks: {
          tool_selection: false,
          content_validation: true,
          negative_validation: true
        },
        response_text: 'error',
        actual_tools: [],
        duration_ms: 50
      },
      {
        case_id: 'gs-004',
        passed: true,
        checks: {
          tool_selection: true,
          content_validation: true,
          negative_validation: true
        },
        response_text: 'XYZNOTREAL: error',
        actual_tools: ['market_data_fetch'],
        duration_ms: 75
      }
    ];

    it('should compute correct total, passed, and failed counts', () => {
      const summary = computeSummary(mockResults, mockCases);
      expect(summary.total).toBe(3);
      expect(summary.passed).toBe(2);
      expect(summary.failed).toBe(1);
    });

    it('should compute correct pass_rate as percentage', () => {
      const summary = computeSummary(mockResults, mockCases);
      expect(summary.pass_rate).toBeCloseTo(66.67, 1);
    });

    it('should break down results by category', () => {
      const summary = computeSummary(mockResults, mockCases);
      expect(summary.by_category['market_data']).toEqual({
        total: 2,
        passed: 2
      });
      expect(summary.by_category['portfolio']).toEqual({
        total: 1,
        passed: 0
      });
    });

    it('should break down results by difficulty', () => {
      const summary = computeSummary(mockResults, mockCases);
      expect(summary.by_difficulty['straightforward']).toEqual({
        total: 2,
        passed: 1
      });
      expect(summary.by_difficulty['edge_case']).toEqual({
        total: 1,
        passed: 1
      });
    });
  });

  // ─── Coverage Matrix ───

  describe('buildCoverageMatrix', () => {
    const mockCases: GoldenCase[] = [
      {
        id: 'gs-001',
        query: 'q',
        category: 'market_data',
        subcategory: 's',
        difficulty: 'straightforward',
        expected_tools: [],
        must_contain: [],
        must_not_contain: []
      },
      {
        id: 'gs-004',
        query: 'q',
        category: 'market_data',
        subcategory: 's',
        difficulty: 'edge_case',
        expected_tools: [],
        must_contain: [],
        must_not_contain: []
      }
    ];

    const mockResults: EvalResult[] = [
      {
        case_id: 'gs-001',
        passed: true,
        checks: {
          tool_selection: true,
          content_validation: true,
          negative_validation: true
        },
        response_text: '',
        actual_tools: [],
        duration_ms: 10
      },
      {
        case_id: 'gs-004',
        passed: false,
        checks: {
          tool_selection: false,
          content_validation: true,
          negative_validation: true
        },
        response_text: '',
        actual_tools: [],
        duration_ms: 10
      }
    ];

    it('should build a matrix with category as columns and difficulty as rows', () => {
      const matrix = buildCoverageMatrix(mockResults, mockCases);
      expect(matrix['straightforward']['market_data']).toEqual({
        total: 1,
        passed: 1
      });
      expect(matrix['edge_case']['market_data']).toEqual({
        total: 1,
        passed: 0
      });
    });

    it('should return empty object for categories with no cases in a difficulty', () => {
      const matrix = buildCoverageMatrix(mockResults, mockCases);
      // 'ambiguous' difficulty has no cases
      expect(matrix['ambiguous']).toBeUndefined();
    });
  });
});
```

**Step 2: Run test to verify it fails (RED)**

Run:

```bash
npx dotenv-cli -e .env.example -- npx nx test api --testPathPattern="evals/eval-runner" --no-coverage
```

Expected: FAIL — `Cannot find module './eval-runner'` (module doesn't exist yet). This confirms our tests are correctly importing from the module we're about to create.

**Step 3: Commit the failing tests**

```bash
git add apps/api/src/app/agent/evals/eval-runner.spec.ts
git commit -m "test(evals): add failing tests for eval runner logic (RED phase)"
```

---

### Task 5: Implement eval-runner.ts (GREEN phase)

**Files:**

- Create: `apps/api/src/app/agent/evals/eval-runner.ts`

This file exports pure functions for the Jest tests AND has a `main()` function for standalone execution.

**Step 1: Write the eval runner**

```typescript
import * as fs from 'fs';
import * as yaml from 'js-yaml';

import type {
  ChatApiResponse,
  EvalResult,
  EvalSummary,
  EvalTurn,
  GoldenCase,
  GoldenDataFile
} from './types';

// ─── Pure functions (exported for testing) ───

export function loadGoldenData(yamlPath: string): GoldenDataFile {
  const raw = fs.readFileSync(yamlPath, 'utf8');
  return yaml.load(raw) as GoldenDataFile;
}

export function checkToolSelection(
  expected: string[],
  actual: string[]
): boolean {
  if (expected.length === 0) return true;
  return expected.every((tool) => actual.includes(tool));
}

export function checkContentValidation(
  mustContain: string[],
  responseText: string
): boolean {
  if (mustContain.length === 0) return true;
  const lower = responseText.toLowerCase();
  return mustContain.every((s) => lower.includes(s.toLowerCase()));
}

export function checkNegativeValidation(
  mustNotContain: string[],
  responseText: string
): boolean {
  if (mustNotContain.length === 0) return true;
  const lower = responseText.toLowerCase();
  return mustNotContain.every((s) => !lower.includes(s.toLowerCase()));
}

export function computeSummary(
  results: EvalResult[],
  cases: GoldenCase[]
): EvalSummary {
  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const failed = total - passed;
  const pass_rate =
    total === 0 ? 0 : Math.round((passed / total) * 10000) / 100;

  const by_category: Record<string, { total: number; passed: number }> = {};
  const by_difficulty: Record<string, { total: number; passed: number }> = {};

  for (const result of results) {
    const goldenCase = cases.find((c) => c.id === result.case_id);
    if (!goldenCase) continue;

    const cat = goldenCase.category;
    if (!by_category[cat]) by_category[cat] = { total: 0, passed: 0 };
    by_category[cat].total++;
    if (result.passed) by_category[cat].passed++;

    const diff = goldenCase.difficulty;
    if (!by_difficulty[diff]) by_difficulty[diff] = { total: 0, passed: 0 };
    by_difficulty[diff].total++;
    if (result.passed) by_difficulty[diff].passed++;
  }

  return {
    total,
    passed,
    failed,
    pass_rate,
    by_category,
    by_difficulty,
    results
  };
}

export function buildCoverageMatrix(
  results: EvalResult[],
  cases: GoldenCase[]
): Record<string, Record<string, { total: number; passed: number }>> {
  const matrix: Record<
    string,
    Record<string, { total: number; passed: number }>
  > = {};

  for (const result of results) {
    const goldenCase = cases.find((c) => c.id === result.case_id);
    if (!goldenCase) continue;

    const diff = goldenCase.difficulty;
    const cat = goldenCase.category;

    if (!matrix[diff]) matrix[diff] = {};
    if (!matrix[diff][cat]) matrix[diff][cat] = { total: 0, passed: 0 };
    matrix[diff][cat].total++;
    if (result.passed) matrix[diff][cat].passed++;
  }

  return matrix;
}

// ─── HTTP helpers (used only in standalone mode) ───

async function authenticate(
  baseUrl: string,
  accessToken: string
): Promise<string> {
  const res = await fetch(`${baseUrl}/api/auth/anonymous`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessToken })
  });

  if (!res.ok) {
    throw new Error(
      `Authentication failed: HTTP ${res.status} ${await res.text()}`
    );
  }

  const data = (await res.json()) as { authToken: string };
  return data.authToken;
}

async function sendChat(
  baseUrl: string,
  jwt: string,
  message: string,
  sessionId: string
): Promise<ChatApiResponse> {
  const res = await fetch(`${baseUrl}/api/v1/agent/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`
    },
    body: JSON.stringify({ message, session_id: sessionId })
  });

  if (!res.ok) {
    throw new Error(`Chat API error: HTTP ${res.status} ${await res.text()}`);
  }

  return (await res.json()) as ChatApiResponse;
}

// ─── Eval execution ───

const LONG_INPUT_PLACEHOLDER = 'PLACEHOLDER_LONG_INPUT';
const LONG_INPUT = 'A'.repeat(10000);

function resolveQuery(query: string): string {
  if (query === LONG_INPUT_PLACEHOLDER) return LONG_INPUT;
  return query;
}

async function evalSingleTurn(
  baseUrl: string,
  jwt: string,
  goldenCase: GoldenCase
): Promise<EvalResult> {
  const start = Date.now();
  const sessionId = `eval-${goldenCase.id}-${Date.now()}`;
  const query = resolveQuery(goldenCase.query || '');

  try {
    const response = await sendChat(baseUrl, jwt, query, sessionId);
    const actualTools = response.tool_calls.map((tc) => tc.name);

    const toolCheck = checkToolSelection(
      goldenCase.expected_tools,
      actualTools
    );
    const contentCheck = checkContentValidation(
      goldenCase.must_contain,
      response.response
    );
    const negativeCheck = checkNegativeValidation(
      goldenCase.must_not_contain,
      response.response
    );

    return {
      case_id: goldenCase.id,
      passed: toolCheck && contentCheck && negativeCheck,
      checks: {
        tool_selection: toolCheck,
        content_validation: contentCheck,
        negative_validation: negativeCheck
      },
      response_text: response.response,
      actual_tools: actualTools,
      duration_ms: Date.now() - start
    };
  } catch (err) {
    return {
      case_id: goldenCase.id,
      passed: false,
      checks: {
        tool_selection: false,
        content_validation: false,
        negative_validation: false
      },
      response_text: '',
      actual_tools: [],
      duration_ms: Date.now() - start,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}

async function evalMultiTurn(
  baseUrl: string,
  jwt: string,
  goldenCase: GoldenCase
): Promise<EvalResult> {
  const start = Date.now();
  const sessionId = `eval-${goldenCase.id}-${Date.now()}`;
  const turns = goldenCase.turns!;
  const allActualTools: string[] = [];
  let lastResponse = '';
  let allPassed = true;

  try {
    for (const turn of turns) {
      const query = resolveQuery(turn.query);
      const response = await sendChat(baseUrl, jwt, query, sessionId);
      const turnTools = response.tool_calls.map((tc) => tc.name);
      allActualTools.push(...turnTools);
      lastResponse = response.response;

      const toolOk = checkToolSelection(turn.expected_tools, turnTools);
      const contentOk = checkContentValidation(
        turn.must_contain,
        response.response
      );
      const negativeOk = checkNegativeValidation(
        turn.must_not_contain,
        response.response
      );

      if (!toolOk || !contentOk || !negativeOk) {
        allPassed = false;
      }
    }

    return {
      case_id: goldenCase.id,
      passed: allPassed,
      checks: {
        tool_selection: allPassed,
        content_validation: allPassed,
        negative_validation: allPassed
      },
      response_text: lastResponse,
      actual_tools: allActualTools,
      duration_ms: Date.now() - start
    };
  } catch (err) {
    return {
      case_id: goldenCase.id,
      passed: false,
      checks: {
        tool_selection: false,
        content_validation: false,
        negative_validation: false
      },
      response_text: lastResponse,
      actual_tools: allActualTools,
      duration_ms: Date.now() - start,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}

// ─── Output formatting ───

function printResultsTable(results: EvalResult[]): void {
  console.log('\n┌─────────┬────────┬───────┬─────────┬──────────┬────────┐');
  console.log('│ Case ID │ Status │ Tools │ Content │ Negative │  Time  │');
  console.log('├─────────┼────────┼───────┼─────────┼──────────┼────────┤');

  for (const r of results) {
    const status = r.passed ? ' PASS ' : ' FAIL ';
    const tools = r.checks.tool_selection ? '  ✓  ' : '  ✗  ';
    const content = r.checks.content_validation ? '   ✓   ' : '   ✗   ';
    const negative = r.checks.negative_validation ? '    ✓   ' : '    ✗   ';
    const time = `${r.duration_ms}ms`.padStart(6);
    console.log(
      `│ ${r.case_id} │${status}│${tools}│${content}│${negative}│${time}│`
    );
  }

  console.log('└─────────┴────────┴───────┴─────────┴──────────┴────────┘');
}

function printCoverageMatrix(
  matrix: Record<string, Record<string, { total: number; passed: number }>>,
  categories: string[]
): void {
  console.log('\n=== Coverage Matrix ===\n');

  const colWidth = 14;
  const header =
    ''.padEnd(16) +
    '│' +
    categories.map((c) => c.padStart(colWidth)).join('│') +
    '│';
  const separator =
    '─'.repeat(16) +
    '┼' +
    categories.map(() => '─'.repeat(colWidth)).join('┼') +
    '┤';

  console.log(header);
  console.log(separator);

  for (const diff of ['straightforward', 'ambiguous', 'edge_case']) {
    const row = diff.padEnd(16) + '│';
    const cells = categories.map((cat) => {
      const cell = matrix[diff]?.[cat];
      if (!cell) return '--'.padStart(colWidth);
      return `${cell.passed}/${cell.total}`.padStart(colWidth);
    });
    console.log(row + cells.join('│') + '│');
  }

  console.log('');
}

// ─── Main (standalone entry point) ───

async function main(): Promise<void> {
  const baseUrl = process.env.EVAL_BASE_URL || 'http://localhost:3333';
  const accessToken = process.env.EVAL_ACCESS_TOKEN;

  if (!accessToken) {
    console.error(
      'ERROR: EVAL_ACCESS_TOKEN environment variable is required.\n' +
        'Set it to the plain access token for a Ghostfolio user.\n' +
        'Usage: EVAL_ACCESS_TOKEN=xxx EVAL_BASE_URL=http://localhost:3333 npx tsx apps/api/src/app/agent/evals/eval-runner.ts'
    );
    process.exit(1);
  }

  console.log(`\n🔍 Eval Runner — Stage 1+2 Golden Sets`);
  console.log(`   Target: ${baseUrl}`);
  console.log(`   Authenticating...`);

  const jwt = await authenticate(baseUrl, accessToken);
  console.log(`   ✓ Authenticated\n`);

  const goldenPath = require('path').join(__dirname, 'golden-data.yaml');
  const data = loadGoldenData(goldenPath);
  console.log(
    `   Loaded ${data.cases.length} golden cases (v${data.version}, stage ${data.stage})\n`
  );

  const results: EvalResult[] = [];

  for (const goldenCase of data.cases) {
    const isMultiTurn =
      Array.isArray(goldenCase.turns) && goldenCase.turns.length > 0;
    const label = isMultiTurn
      ? `${goldenCase.id} (${goldenCase.turns!.length} turns)`
      : goldenCase.id;

    process.stdout.write(`   Running ${label}...`);

    const result = isMultiTurn
      ? await evalMultiTurn(baseUrl, jwt, goldenCase)
      : await evalSingleTurn(baseUrl, jwt, goldenCase);

    results.push(result);

    const icon = result.passed ? '✓' : '✗';
    console.log(` ${icon} (${result.duration_ms}ms)`);
  }

  // Print results
  printResultsTable(results);

  // Print summary
  const summary = computeSummary(results, data.cases);
  console.log(`\n=== Summary ===`);
  console.log(`   Total: ${summary.total}`);
  console.log(`   Passed: ${summary.passed}`);
  console.log(`   Failed: ${summary.failed}`);
  console.log(`   Pass Rate: ${summary.pass_rate}%`);

  console.log(`\n   By Category:`);
  for (const [cat, stats] of Object.entries(summary.by_category)) {
    console.log(`     ${cat}: ${stats.passed}/${stats.total}`);
  }

  console.log(`\n   By Difficulty:`);
  for (const [diff, stats] of Object.entries(summary.by_difficulty)) {
    console.log(`     ${diff}: ${stats.passed}/${stats.total}`);
  }

  // Print coverage matrix
  const matrix = buildCoverageMatrix(results, data.cases);
  const allCategories = [...new Set(data.cases.map((c) => c.category))];
  printCoverageMatrix(matrix, allCategories);

  // Exit code
  const passGate = 80;
  if (summary.pass_rate >= passGate) {
    console.log(`\n✅ PASS — ${summary.pass_rate}% >= ${passGate}% gate\n`);
    process.exit(0);
  } else {
    console.log(`\n❌ FAIL — ${summary.pass_rate}% < ${passGate}% gate\n`);
    process.exit(1);
  }
}

// Run main() only when executed directly (not when imported by Jest)
if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
```

**Step 2: Run tests to verify they pass (GREEN)**

Run:

```bash
npx dotenv-cli -e .env.example -- npx nx test api --testPathPattern="evals/eval-runner" --no-coverage
```

Expected: ALL PASS

**Step 3: Commit**

```bash
git add apps/api/src/app/agent/evals/eval-runner.ts
git commit -m "feat(evals): implement deterministic eval runner with binary checks (GREEN phase)"
```

---

### Task 6: Create README.md for evals directory

**Files:**

- Create: `apps/api/src/app/agent/evals/README.md`

**Step 1: Write the README**

````markdown
# Agent Eval Framework

Deterministic eval framework for the Ghostfolio AI agent. Implements Stages 1+2 of the Gauntlet 5-stage eval maturity framework.

## Quick Start

```bash
# Run eval runner tests (tests the runner's own logic)
npx dotenv-cli -e .env.example -- npx nx test api --testPathPattern="evals/eval-runner"

# Run evals against local dev server
EVAL_ACCESS_TOKEN=<your-token> npx tsx apps/api/src/app/agent/evals/eval-runner.ts

# Run evals against production
EVAL_ACCESS_TOKEN=<your-token> \
EVAL_BASE_URL=https://ghostfolio-production-e8d1.up.railway.app \
npx tsx apps/api/src/app/agent/evals/eval-runner.ts
```
````

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

- Same cases as Stage 1, but with labels: category, subcategory, difficulty
- Labels power the coverage matrix (shows where to write tests next)
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

````

**Step 2: Commit**

```bash
git add apps/api/src/app/agent/evals/README.md
git commit -m "docs(evals): add README for eval framework"
````

---

### Task 7: Update CLAUDE.md Layer 5 section

**Files:**

- Modify: `CLAUDE.md` (lines 95-126, the Layer 5 section)

**Step 1: Replace the Layer 5 section**

Replace lines 95-126 (from `### Layer 5: Production eval suite` through the `Design doc:` line) with:

````markdown
### Layer 5: Production eval suite — 5-stage framework

**Stages 1+2 (implemented):** Golden Sets + Labeled Scenarios

Deterministic binary checks against 20 golden test cases in `apps/api/src/app/agent/evals/golden-data.yaml`. No LLM judge — all checks are code-based.

Each case has 3 binary checks:

- `tool_selection`: Did the expected tool(s) appear in `tool_calls`?
- `content_validation`: Do all `must_contain` substrings appear in the response? (case-insensitive)
- `negative_validation`: Do none of the `must_not_contain` substrings appear? (case-insensitive)

**Run commands:**

```bash
# Test the eval runner's own logic (fast, no server needed)
npx dotenv-cli -e .env.example -- npx nx test api --testPathPattern="evals/eval-runner"

# Run evals against local dev server
EVAL_ACCESS_TOKEN=<token> npx tsx apps/api/src/app/agent/evals/eval-runner.ts

# Run evals against production
EVAL_ACCESS_TOKEN=<token> \
EVAL_BASE_URL=https://ghostfolio-production-e8d1.up.railway.app \
npx tsx apps/api/src/app/agent/evals/eval-runner.ts
```
````

**Pass gate:** ≥80% of cases must pass. Exit code 0 on pass, 1 on fail.

**4 rules:**

1. Start small (20 cases, grow organically)
2. Run on every commit (eval-runner.spec.ts) and pre-deploy (standalone runner)
3. Add from production bugs (every bug becomes a golden case)
4. NEVER change expected output to make tests pass — fix the agent

**Stages 3-5 (planned, not yet implemented):**

- Stage 3: Replay Harnesses — record real sessions as JSON fixtures, replay with ML metrics
- Stage 4: Rubrics — multi-dimensional scored eval with LLM judge + calibration
- Stage 5: Experiments — A/B test prompt/model changes with same test set

Design doc: `docs/agentforge/plans/2026-02-24-eval-framework-stage1-stage2-design.md`

````

**Step 2: Run format check**

Run:

```bash
npx nx format:write --files="CLAUDE.md"
````

**Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md Layer 5 to reflect 5-stage eval framework"
```

---

### Task 8: Update US-007 user story

**Files:**

- Modify: `docs/agentforge/user-stories/US-007-mvp-eval-suite.md`

**Step 1: Rewrite the TDD Plan and Implementation Plan sections**

Key changes:

- Replace `tests/mvp-eval.spec.ts` references with `evals/golden-data.yaml` + `evals/eval-runner.ts`
- Replace LangSmith SDK references with deterministic binary checks
- Add coverage matrix output to acceptance criteria
- Remove LangSmith traces from verification steps (move to Stage 4 future)
- Keep the 20 cases but reference them in golden-data.yaml format

Replace the TDD Plan section (lines 97-128) with:

```markdown
### Layer 5 — Production eval (≥20 cases): `evals/golden-data.yaml` + `evals/eval-runner.ts`

**Framework:** Deterministic binary checks (Stage 1+2 of 5-stage eval maturity framework). No LLM judge.

**Golden data:** 20 cases in YAML with 3 checks each (tool_selection, content_validation, negative_validation).

**Market data queries (5):**

1. `gs-001` Single symbol (AAPL) → `market_data_fetch`, must contain "AAPL"
2. `gs-002` Multi symbol (MSFT, GOOGL) → `market_data_fetch`, must contain both
3. `gs-003` Crypto (BTC-USD) → `market_data_fetch`, must contain "BTC"
4. `gs-004` Invalid symbol (XYZNOTREAL) → `market_data_fetch`, must contain "XYZNOTREAL"
5. `gs-005` Edge symbol (BRK.B) → `market_data_fetch`, must contain "BRK"

**Portfolio analysis queries (5):**

6. `gs-006` Concentration risk → `portfolio_risk_analysis`
7. `gs-007` Allocation breakdown → `portfolio_risk_analysis`
8. `gs-008` Empty portfolio → `portfolio_risk_analysis`
9. `gs-009` Single holding diversification → `portfolio_risk_analysis`
10. `gs-010` Performance/returns → `portfolio_risk_analysis`

**Compliance queries (5):**

11. `gs-011` Full ESG check → `compliance_check`
12. `gs-012` Fossil fuel flag → `compliance_check`
13. `gs-013` Category filter (tobacco) → `compliance_check`
14. `gs-014` Clean portfolio → `compliance_check`
15. `gs-015` Source attribution → `compliance_check`

**Multi-turn conversations (3):**

16. `gs-016` Tool switching (market → portfolio, 2 turns)
17. `gs-017` Follow-up question (MSFT → GOOGL, 2 turns)
18. `gs-018` Error recovery (empty → valid, 2 turns)

**Error recovery (2):**

19. `gs-019` Empty message → "provide a message"
20. `gs-020` 10K character input → no 500 error
```

Replace the Implementation Plan section (lines 130-143) with:

```markdown
## Step-by-step Implementation Plan

1. Install `js-yaml` dev dependency.
2. Create `apps/api/src/app/agent/evals/types.ts` — interfaces for eval cases and results.
3. Create `apps/api/src/app/agent/evals/golden-data.yaml` — 20 golden test cases.
4. Write failing `apps/api/src/app/agent/evals/eval-runner.spec.ts` — tests for eval logic (RED).
5. Implement `apps/api/src/app/agent/evals/eval-runner.ts` — deterministic eval runner (GREEN).
6. Create `apps/api/src/app/agent/evals/README.md` — usage docs.
7. Update `CLAUDE.md` Layer 5 section.
8. Run eval-runner.spec.ts locally → all pass.
9. Run standalone eval runner against local dev → print results + coverage matrix.
10. Run standalone eval runner against production → ≥80% pass rate.
11. Create MVP-EVIDENCE.md with results.
```

Replace the Local Validation section (lines 164-174) with:

````markdown
## Local Validation

```bash
# Eval runner logic tests (fast, no server)
npx dotenv-cli -e .env.example -- npx nx test api --testPathPattern="evals/eval-runner"

# Run evals against local
EVAL_ACCESS_TOKEN=<token> npx tsx apps/api/src/app/agent/evals/eval-runner.ts

# Run evals against production
EVAL_ACCESS_TOKEN=<token> \
EVAL_BASE_URL=https://ghostfolio-production-e8d1.up.railway.app \
npx tsx apps/api/src/app/agent/evals/eval-runner.ts

# Full test suite (should still pass)
npx nx test api
```
````

````

Update Acceptance Criteria (lines 156-161):

```markdown
## Acceptance Criteria

- [ ] AC1: `golden-data.yaml` contains ≥20 cases (5 market, 5 portfolio, 5 compliance, 3 multi-turn, 2 error).
- [ ] AC2: `eval-runner.spec.ts` passes (tests parsing, tool check, content check, negative check, summary, matrix).
- [ ] AC3: Standalone eval runner runs against production and prints results + coverage matrix.
- [ ] AC4: Overall pass rate ≥80% on production.
- [ ] AC5: Coverage matrix has no completely empty rows.
- [ ] AC6: CLAUDE.md Layer 5 section updated to reflect 5-stage framework.
````

**Step 2: Format and commit**

```bash
npx nx format:write --files="docs/agentforge/user-stories/US-007-mvp-eval-suite.md"
git add docs/agentforge/user-stories/US-007-mvp-eval-suite.md
git commit -m "docs: rewrite US-007 to align with 5-stage eval framework"
```

---

### Task 9: Run all tests and verify

**Step 1: Run eval runner tests**

```bash
npx dotenv-cli -e .env.example -- npx nx test api --testPathPattern="evals/eval-runner" --no-coverage
```

Expected: ALL PASS

**Step 2: Run full agent test suite**

```bash
npx dotenv-cli -e .env.example -- npx nx test api --testPathPattern="app/agent/" --no-coverage
```

Expected: ALL PASS (no regressions)

**Step 3: Production build**

```bash
npx nx build api --configuration=production
```

Expected: Build succeeds (eval files are not bundled since they're in evals/ and not imported by main app)

**Step 4: Commit verification**

```bash
git log --oneline -8
```

Expected: 7 commits from this plan

---

### Task 10: Run evals against local dev server

**Step 1: Start the server (in a separate terminal)**

```bash
npm run start:server
```

**Step 2: Run the eval runner**

```bash
EVAL_ACCESS_TOKEN=<your-token> npx tsx apps/api/src/app/agent/evals/eval-runner.ts
```

Expected: Results table + coverage matrix printed. Some cases may fail if no user portfolio data exists locally — that's expected. Market data cases (gs-001 through gs-005) and error recovery cases (gs-019, gs-020) should pass.

**Step 3: If pass rate <80%, investigate and fix agent issues, NOT golden data**

Rule: Never change expected output to make tests pass.

---

### Task 11: Push and deploy

**Step 1: Push to remote**

```bash
git push origin main
```

**Step 2: Verify Railway deployment completes**

Check Railway dashboard for successful deploy.

**Step 3: Run evals against production**

```bash
EVAL_ACCESS_TOKEN=<prod-token> \
EVAL_BASE_URL=https://ghostfolio-production-e8d1.up.railway.app \
npx tsx apps/api/src/app/agent/evals/eval-runner.ts
```

Expected: ≥80% pass rate. Coverage matrix printed.
