import * as fs from 'fs';
import * as yaml from 'js-yaml';

import {
  AgentChatResponse,
  EvalResult,
  EvalSummary,
  EvalTurn,
  GoldenCase,
  GoldenDataFile
} from './types';

// ── Pure functions (exported for testing) ────────────────────────────────────

/**
 * Load and parse a golden-data.yaml file.
 * Throws if the file does not exist or is invalid YAML.
 */
export function loadGoldenData(yamlPath: string): GoldenDataFile {
  const raw = fs.readFileSync(yamlPath, 'utf-8');
  const parsed = yaml.load(raw) as GoldenDataFile;
  return parsed;
}

/**
 * Check that all expected tools were invoked.
 * Returns true if every item in `expected` appears in `actual`.
 * Empty `expected` always passes (no tool requirement).
 */
export function checkToolSelection(
  expected: string[],
  actual: string[]
): boolean {
  if (expected.length === 0) {
    return true;
  }
  return expected.every((tool) => actual.includes(tool));
}

/**
 * Check that all must_contain strings appear in the response (case-insensitive).
 * Empty `mustContain` always passes.
 */
export function checkContentValidation(
  mustContain: string[],
  responseText: string
): boolean {
  if (mustContain.length === 0) {
    return true;
  }
  const lower = responseText.toLowerCase();
  return mustContain.every((s) => lower.includes(s.toLowerCase()));
}

/**
 * Check that none of the must_not_contain strings appear in the response (case-insensitive).
 * Empty `mustNotContain` always passes.
 */
export function checkNegativeValidation(
  mustNotContain: string[],
  responseText: string
): boolean {
  if (mustNotContain.length === 0) {
    return true;
  }
  const lower = responseText.toLowerCase();
  return mustNotContain.every((s) => !lower.includes(s.toLowerCase()));
}

/**
 * Compute an aggregate summary from individual eval results.
 * pass_rate is a percentage (0-100), not a fraction.
 */
export function computeSummary(
  results: EvalResult[],
  cases: GoldenCase[]
): EvalSummary {
  const caseMap = new Map<string, GoldenCase>();
  for (const c of cases) {
    caseMap.set(c.id, c);
  }

  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const failed = total - passed;
  const pass_rate =
    total > 0
      ? Math.round((passed / total) * 10000) / 100 // two decimal places
      : 0;

  const by_category: Record<string, { total: number; passed: number }> = {};
  const by_difficulty: Record<string, { total: number; passed: number }> = {};

  for (const result of results) {
    const goldenCase = caseMap.get(result.case_id);
    if (!goldenCase) continue;

    const cat = goldenCase.category;
    const diff = goldenCase.difficulty;

    // Category breakdown
    if (!by_category[cat]) {
      by_category[cat] = { total: 0, passed: 0 };
    }
    by_category[cat].total++;
    if (result.passed) {
      by_category[cat].passed++;
    }

    // Difficulty breakdown
    if (!by_difficulty[diff]) {
      by_difficulty[diff] = { total: 0, passed: 0 };
    }
    by_difficulty[diff].total++;
    if (result.passed) {
      by_difficulty[diff].passed++;
    }
  }

  return { total, passed, failed, pass_rate, by_category, by_difficulty };
}

/**
 * Build a coverage matrix: difficulty (rows) x category (columns).
 * Only creates entries for difficulty/category combinations that have cases.
 */
export function buildCoverageMatrix(
  results: EvalResult[],
  cases: GoldenCase[]
): Record<string, Record<string, { total: number; passed: number }>> {
  const caseMap = new Map<string, GoldenCase>();
  for (const c of cases) {
    caseMap.set(c.id, c);
  }

  const resultMap = new Map<string, EvalResult>();
  for (const r of results) {
    resultMap.set(r.case_id, r);
  }

  const matrix: Record<
    string,
    Record<string, { total: number; passed: number }>
  > = {};

  for (const goldenCase of cases) {
    const diff = goldenCase.difficulty;
    const cat = goldenCase.category;
    const result = resultMap.get(goldenCase.id);

    if (!matrix[diff]) {
      matrix[diff] = {};
    }
    if (!matrix[diff][cat]) {
      matrix[diff][cat] = { total: 0, passed: 0 };
    }
    matrix[diff][cat].total++;
    if (result?.passed) {
      matrix[diff][cat].passed++;
    }
  }

  return matrix;
}

// ── Standalone runner (NOT exported) ─────────────────────────────────────────

const LONG_INPUT_PLACEHOLDER = 'PLACEHOLDER_LONG_INPUT';
const LONG_INPUT_REPLACEMENT = 'A'.repeat(10000);

interface AuthResponse {
  authToken: string;
}

async function authenticate(
  baseUrl: string,
  accessToken: string
): Promise<string> {
  const res = await fetch(`${baseUrl}/api/v1/auth/anonymous/${accessToken}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Authentication failed (${res.status}): ${text}`);
  }
  const body = (await res.json()) as AuthResponse;
  return body.authToken;
}

async function sendChat(
  baseUrl: string,
  jwt: string,
  message: string,
  sessionId: string
): Promise<AgentChatResponse> {
  const res = await fetch(`${baseUrl}/api/v1/agent/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`
    },
    body: JSON.stringify({ message, session_id: sessionId })
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Chat API error: HTTP ${res.status} ${text}`);
  }

  return (await res.json()) as AgentChatResponse;
}

function extractToolNames(response: AgentChatResponse): string[] {
  return response.tool_calls.map((tc) => tc.name);
}

function resolveQuery(query: string): string {
  if (query === LONG_INPUT_PLACEHOLDER) {
    return LONG_INPUT_REPLACEMENT;
  }
  return query;
}

async function evaluateSingleTurn(
  baseUrl: string,
  jwt: string,
  goldenCase: GoldenCase
): Promise<EvalResult> {
  const query = resolveQuery(goldenCase.query || '');
  const sessionId = `eval-${goldenCase.id}-${Date.now()}`;
  const start = Date.now();

  try {
    const response = await sendChat(baseUrl, jwt, query, sessionId);
    const duration_ms = Date.now() - start;

    const actualTools = extractToolNames(response);
    const tool_selection = checkToolSelection(
      goldenCase.expected_tools,
      actualTools
    );
    const content_validation = checkContentValidation(
      goldenCase.must_contain,
      response.response
    );
    const negative_validation = checkNegativeValidation(
      goldenCase.must_not_contain,
      response.response
    );

    const passed = tool_selection && content_validation && negative_validation;

    return {
      case_id: goldenCase.id,
      passed,
      checks: { tool_selection, content_validation, negative_validation },
      response_text: response.response,
      actual_tools: actualTools,
      duration_ms
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

async function evaluateMultiTurn(
  baseUrl: string,
  jwt: string,
  goldenCase: GoldenCase
): Promise<EvalResult> {
  const turns: EvalTurn[] = goldenCase.turns || [];
  const sessionId = `eval-${goldenCase.id}-${Date.now()}`;
  const start = Date.now();

  try {
    let allPassed = true;
    let lastResponseText = '';
    let lastActualTools: string[] = [];
    const overallChecks = {
      tool_selection: true,
      content_validation: true,
      negative_validation: true
    };

    for (const turn of turns) {
      const query = resolveQuery(turn.query);
      const response = await sendChat(baseUrl, jwt, query, sessionId);

      const actualTools = extractToolNames(response);
      const toolOk = checkToolSelection(turn.expected_tools, actualTools);
      const contentOk = checkContentValidation(
        turn.must_contain,
        response.response
      );
      const negativeOk = checkNegativeValidation(
        turn.must_not_contain,
        response.response
      );

      if (!toolOk) overallChecks.tool_selection = false;
      if (!contentOk) overallChecks.content_validation = false;
      if (!negativeOk) overallChecks.negative_validation = false;

      if (!toolOk || !contentOk || !negativeOk) {
        allPassed = false;
      }

      lastResponseText = response.response;
      lastActualTools = actualTools;
    }

    return {
      case_id: goldenCase.id,
      passed: allPassed,
      checks: overallChecks,
      response_text: lastResponseText,
      actual_tools: lastActualTools,
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

function printResultsTable(results: EvalResult[], cases: GoldenCase[]): void {
  const caseMap = new Map<string, GoldenCase>();
  for (const c of cases) {
    caseMap.set(c.id, c);
  }

  console.log('\n┌──────────┬──────────────┬────────────┬──────┬───────┬─────────┬──────────┐');
  console.log('│ ID       │ Category     │ Difficulty │ Pass │ Tools │ Content │ Negative │');
  console.log('├──────────┼──────────────┼────────────┼──────┼───────┼─────────┼──────────┤');

  for (const result of results) {
    const gc = caseMap.get(result.case_id);
    const id = result.case_id.padEnd(8);
    const cat = (gc?.category || '').padEnd(12);
    const diff = (gc?.difficulty || '').padEnd(10);
    const pass = result.passed ? ' OK ' : 'FAIL';
    const tool = result.checks.tool_selection ? '  OK ' : ' FAIL';
    const cont = result.checks.content_validation ? '   OK  ' : '  FAIL ';
    const neg = result.checks.negative_validation ? '   OK   ' : '  FAIL  ';
    console.log(`│ ${id} │ ${cat} │ ${diff} │ ${pass} │${tool} │${cont} │${neg} │`);
  }

  console.log('└──────────┴──────────────┴────────────┴──────┴───────┴─────────┴──────────┘');
}

function printSummary(summary: EvalSummary): void {
  console.log('\n=== Summary ===');
  console.log(`Total: ${summary.total}  Passed: ${summary.passed}  Failed: ${summary.failed}  Pass Rate: ${summary.pass_rate}%`);

  console.log('\nBy Category:');
  for (const [cat, data] of Object.entries(summary.by_category)) {
    console.log(`  ${cat}: ${data.passed}/${data.total}`);
  }

  console.log('\nBy Difficulty:');
  for (const [diff, data] of Object.entries(summary.by_difficulty)) {
    console.log(`  ${diff}: ${data.passed}/${data.total}`);
  }
}

function printCoverageMatrix(
  matrix: Record<string, Record<string, { total: number; passed: number }>>,
  cases: GoldenCase[]
): void {
  const categories = [...new Set(cases.map((c) => c.category))];

  console.log('\n=== Coverage Matrix (Difficulty x Category) ===');
  console.log(`${''.padEnd(16)} ${categories.map((c) => c.padEnd(14)).join(' ')}`);

  for (const [diff, catMap] of Object.entries(matrix)) {
    const cells = categories.map((cat) => {
      const entry = catMap[cat];
      return entry ? `${entry.passed}/${entry.total}`.padEnd(14) : '-'.padEnd(14);
    });
    console.log(`${diff.padEnd(16)} ${cells.join(' ')}`);
  }
}

async function main(): Promise<void> {
  console.log('=== Ghostfolio Agent Eval Suite (Deterministic) ===\n');

  const baseUrl =
    process.env.EVAL_BASE_URL || 'http://localhost:3333';
  const accessToken = process.env.EVAL_ACCESS_TOKEN;

  if (!accessToken) {
    console.error('ERROR: EVAL_ACCESS_TOKEN not set');
    process.exit(1);
  }

  console.log(`Target: ${baseUrl}`);

  // Load golden data
  const yamlPath = require('path').resolve(__dirname, 'golden-data.yaml');
  const goldenData = loadGoldenData(yamlPath);
  console.log(`Loaded ${goldenData.cases.length} golden cases (v${goldenData.version}, stage ${goldenData.stage})\n`);

  // Authenticate
  console.log('Authenticating...');
  const jwt = await authenticate(baseUrl, accessToken);
  console.log('Authenticated successfully.\n');

  // Run evaluations
  const results: EvalResult[] = [];

  for (const goldenCase of goldenData.cases) {
    const isMultiTurn = Array.isArray(goldenCase.turns) && goldenCase.turns.length > 0;
    const label = `[${goldenCase.id}] ${goldenCase.category}/${goldenCase.subcategory}`;

    process.stdout.write(`Evaluating ${label}...`);

    let result: EvalResult;
    if (isMultiTurn) {
      result = await evaluateMultiTurn(baseUrl, jwt, goldenCase);
    } else {
      result = await evaluateSingleTurn(baseUrl, jwt, goldenCase);
    }

    results.push(result);
    console.log(` ${result.passed ? 'PASS' : 'FAIL'} (${result.duration_ms}ms)`);
  }

  // Print results
  printResultsTable(results, goldenData.cases);

  const summary = computeSummary(results, goldenData.cases);
  printSummary(summary);

  const matrix = buildCoverageMatrix(results, goldenData.cases);
  printCoverageMatrix(matrix, goldenData.cases);

  // Exit code based on pass rate
  console.log(`\nPass rate: ${summary.pass_rate}%`);
  if (summary.pass_rate >= 80) {
    console.log('PASS: Eval suite meets >=80% pass rate gate.');
    process.exit(0);
  } else {
    console.error(`FAIL: Pass rate ${summary.pass_rate}% < 80% gate`);
    process.exit(1);
  }
}

// Only run main() when executed directly, not when imported by Jest
if (require.main === module) {
  main().catch((err) => {
    console.error('Eval runner failed:', err);
    process.exit(1);
  });
}
