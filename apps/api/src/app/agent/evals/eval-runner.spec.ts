import * as path from 'path';

import {
  loadGoldenData,
  checkToolSelection,
  checkContentValidation,
  checkNegativeValidation,
  computeSummary,
  buildCoverageMatrix
} from './eval-runner';
import { EvalResult, GoldenCase } from './types';

// ── loadGoldenData ──────────────────────────────────────────────────────────

describe('loadGoldenData', () => {
  const yamlPath = path.resolve(__dirname, 'golden-data.yaml');

  it('should parse golden-data.yaml and return all 27 cases', () => {
    const data = loadGoldenData(yamlPath);
    expect(data.cases).toHaveLength(27);
  });

  it('should parse single-turn cases with query field', () => {
    const data = loadGoldenData(yamlPath);
    const singleTurn = data.cases.find((c) => c.id === 'gs-001');
    expect(singleTurn).toBeDefined();
    expect(singleTurn!.query).toBe('What is the current price of AAPL?');
    expect(singleTurn!.turns).toBeUndefined();
  });

  it('should parse multi-turn cases with turns array', () => {
    const data = loadGoldenData(yamlPath);
    const multiTurn = data.cases.find((c) => c.id === 'gs-016');
    expect(multiTurn).toBeDefined();
    expect(multiTurn!.turns).toBeDefined();
    expect(multiTurn!.turns!.length).toBeGreaterThanOrEqual(2);
    expect(multiTurn!.turns![0].query).toBe('What is the price of AAPL?');
  });

  it('should throw on invalid YAML path', () => {
    expect(() => loadGoldenData('/nonexistent/path/to/file.yaml')).toThrow();
  });
});

// ── checkToolSelection ──────────────────────────────────────────────────────

describe('checkToolSelection', () => {
  it('should pass when all expected tools are present', () => {
    expect(checkToolSelection(['market_data_fetch'], ['market_data_fetch'])).toBe(true);
  });

  it('should pass when expected is subset of actual', () => {
    expect(
      checkToolSelection(
        ['market_data_fetch'],
        ['market_data_fetch', 'portfolio_risk_analysis']
      )
    ).toBe(true);
  });

  it('should fail when expected tool is missing', () => {
    expect(
      checkToolSelection(['market_data_fetch'], ['portfolio_risk_analysis'])
    ).toBe(false);
  });

  it('should pass when both expected and actual are empty', () => {
    expect(checkToolSelection([], [])).toBe(true);
  });

  it('should pass when expected is empty but tools were called', () => {
    expect(checkToolSelection([], ['market_data_fetch'])).toBe(true);
  });

  it('should fail when expected tool present but actual is empty', () => {
    expect(checkToolSelection(['market_data_fetch'], [])).toBe(false);
  });
});

// ── checkContentValidation ──────────────────────────────────────────────────

describe('checkContentValidation', () => {
  it('should pass when all must_contain strings are present', () => {
    expect(checkContentValidation(['AAPL', 'price'], 'The price of AAPL is $195')).toBe(true);
  });

  it('should be case-insensitive', () => {
    expect(checkContentValidation(['aapl'], 'AAPL price is $195')).toBe(true);
    expect(checkContentValidation(['AAPL'], 'aapl price is $195')).toBe(true);
  });

  it('should fail when a must_contain string is missing', () => {
    expect(checkContentValidation(['AAPL', 'MSFT'], 'The price of AAPL is $195')).toBe(false);
  });

  it('should pass when must_contain is empty', () => {
    expect(checkContentValidation([], 'any response text')).toBe(true);
  });

  it('should fail when response is empty but must_contain has values', () => {
    expect(checkContentValidation(['AAPL'], '')).toBe(false);
  });
});

// ── checkNegativeValidation ─────────────────────────────────────────────────

describe('checkNegativeValidation', () => {
  it('should pass when no must_not_contain strings are present', () => {
    expect(
      checkNegativeValidation(['unable to', 'I don\'t know'], 'AAPL price is $195')
    ).toBe(true);
  });

  it('should fail when a must_not_contain string is found (case-insensitive)', () => {
    expect(
      checkNegativeValidation(['unable to'], 'I was UNABLE TO fetch the data')
    ).toBe(false);
  });

  it('should pass when must_not_contain is empty', () => {
    expect(checkNegativeValidation([], 'any response text')).toBe(true);
  });

  it('should pass on empty response when must_not_contain has values', () => {
    expect(checkNegativeValidation(['error', '500'], '')).toBe(true);
  });
});

// ── computeSummary ──────────────────────────────────────────────────────────

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
      checks: { tool_selection: true, content_validation: true, negative_validation: true },
      response_text: 'AAPL: $195',
      actual_tools: ['market_data_fetch'],
      duration_ms: 100
    },
    {
      case_id: 'gs-006',
      passed: false,
      checks: { tool_selection: false, content_validation: true, negative_validation: true },
      response_text: 'error',
      actual_tools: [],
      duration_ms: 50
    },
    {
      case_id: 'gs-004',
      passed: true,
      checks: { tool_selection: true, content_validation: true, negative_validation: true },
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
    expect(summary.by_category).toEqual({
      market_data: { total: 2, passed: 2 },
      portfolio: { total: 1, passed: 0 }
    });
  });

  it('should break down results by difficulty', () => {
    const summary = computeSummary(mockResults, mockCases);
    expect(summary.by_difficulty).toEqual({
      straightforward: { total: 2, passed: 1 },
      edge_case: { total: 1, passed: 1 }
    });
  });

  it('should return zero pass_rate for empty results', () => {
    const summary = computeSummary([], []);
    expect(summary.total).toBe(0);
    expect(summary.passed).toBe(0);
    expect(summary.failed).toBe(0);
    expect(summary.pass_rate).toBe(0);
  });
});

// ── buildCoverageMatrix ─────────────────────────────────────────────────────

describe('buildCoverageMatrix', () => {
  const matrixCases: GoldenCase[] = [
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

  const matrixResults: EvalResult[] = [
    {
      case_id: 'gs-001',
      passed: true,
      checks: { tool_selection: true, content_validation: true, negative_validation: true },
      response_text: 'AAPL: $195',
      actual_tools: ['market_data_fetch'],
      duration_ms: 100
    },
    {
      case_id: 'gs-004',
      passed: false,
      checks: { tool_selection: true, content_validation: false, negative_validation: true },
      response_text: 'error',
      actual_tools: ['market_data_fetch'],
      duration_ms: 75
    }
  ];

  it('should build a matrix with category as columns and difficulty as rows', () => {
    const matrix = buildCoverageMatrix(matrixResults, matrixCases);

    // difficulty "straightforward" has market_data: 1 total, 1 passed
    expect(matrix['straightforward']).toBeDefined();
    expect(matrix['straightforward']['market_data']).toEqual({ total: 1, passed: 1 });

    // difficulty "edge_case" has market_data: 1 total, 0 passed
    expect(matrix['edge_case']).toBeDefined();
    expect(matrix['edge_case']['market_data']).toEqual({ total: 1, passed: 0 });
  });

  it('should return undefined for difficulties with no cases', () => {
    const matrix = buildCoverageMatrix(matrixResults, matrixCases);

    // "ambiguous" difficulty has no cases
    expect(matrix['ambiguous']).toBeUndefined();
  });
});
