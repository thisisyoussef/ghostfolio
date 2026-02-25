/**
 * Tests for LangSmith deterministic evaluator functions.
 * These wrap the same binary logic from eval-runner.ts in LangSmith's
 * evaluator shape: (run, example) => { key, score, comment? }
 */
import {
  toolSelectionEvaluator,
  contentValidationEvaluator,
  negativeValidationEvaluator,
  verificationMetadataEvaluator,
  overallPassEvaluator,
  LangSmithRun,
  LangSmithExample
} from './langsmith-evaluators';

// ── Helper to build mock run/example objects ─────────────────────────────────

function makeRun(overrides: Partial<LangSmithRun['outputs']> = {}): LangSmithRun {
  return {
    outputs: {
      response: 'AAPL is currently trading at $195.50\n\n### Verification\nConfidence: 95/100\n\n### Sources\n- Yahoo Finance',
      tool_calls: [{ name: 'market_data_fetch', args: {}, result: '{}' }],
      ...overrides
    }
  };
}

function makeExample(
  overrides: Partial<LangSmithExample['outputs']> = {}
): LangSmithExample {
  return {
    outputs: {
      expectedTools: ['market_data_fetch'],
      mustContain: ['AAPL'],
      mustNotContain: ['unable to', 'I don\'t know'],
      category: 'market_data',
      requiresVerification: true,
      ...overrides
    }
  };
}

// ── toolSelectionEvaluator ───────────────────────────────────────────────────

describe('toolSelectionEvaluator', () => {
  it('should return score 1 when expected tool is called', () => {
    const result = toolSelectionEvaluator(makeRun(), makeExample());
    expect(result.key).toBe('tool_selection');
    expect(result.score).toBe(1);
  });

  it('should return score 0 when wrong tool is called', () => {
    const result = toolSelectionEvaluator(
      makeRun({ tool_calls: [{ name: 'compliance_check', args: {}, result: '{}' }] }),
      makeExample()
    );
    expect(result.score).toBe(0);
  });

  it('should return score 0 when no tools are called', () => {
    const result = toolSelectionEvaluator(
      makeRun({ tool_calls: [] }),
      makeExample()
    );
    expect(result.score).toBe(0);
  });

  it('should return score 1 when expectedTools is empty (no tool required)', () => {
    const result = toolSelectionEvaluator(
      makeRun({ tool_calls: [] }),
      makeExample({ expectedTools: [] })
    );
    expect(result.score).toBe(1);
  });
});

// ── contentValidationEvaluator ───────────────────────────────────────────────

describe('contentValidationEvaluator', () => {
  it('should return score 1 when all must_contain patterns found', () => {
    const result = contentValidationEvaluator(makeRun(), makeExample());
    expect(result.key).toBe('content_validation');
    expect(result.score).toBe(1);
  });

  it('should return score 0 when a must_contain pattern is missing', () => {
    const result = contentValidationEvaluator(
      makeRun({ response: 'The stock price is $195.50' }),
      makeExample({ mustContain: ['AAPL', 'MSFT'] })
    );
    expect(result.score).toBe(0);
  });

  it('should be case-insensitive', () => {
    const result = contentValidationEvaluator(
      makeRun({ response: 'aapl is trading well' }),
      makeExample({ mustContain: ['AAPL'] })
    );
    expect(result.score).toBe(1);
  });

  it('should return score 1 when mustContain is empty', () => {
    const result = contentValidationEvaluator(
      makeRun(),
      makeExample({ mustContain: [] })
    );
    expect(result.score).toBe(1);
  });
});

// ── negativeValidationEvaluator ──────────────────────────────────────────────

describe('negativeValidationEvaluator', () => {
  it('should return score 1 when no forbidden strings appear', () => {
    const result = negativeValidationEvaluator(makeRun(), makeExample());
    expect(result.key).toBe('negative_validation');
    expect(result.score).toBe(1);
  });

  it('should return score 0 when a forbidden string appears', () => {
    const result = negativeValidationEvaluator(
      makeRun({ response: 'I don\'t know the price' }),
      makeExample()
    );
    expect(result.score).toBe(0);
  });

  it('should be case-insensitive', () => {
    const result = negativeValidationEvaluator(
      makeRun({ response: 'UNABLE TO fetch the data' }),
      makeExample()
    );
    expect(result.score).toBe(0);
  });

  it('should return score 1 when mustNotContain is empty', () => {
    const result = negativeValidationEvaluator(
      makeRun(),
      makeExample({ mustNotContain: [] })
    );
    expect(result.score).toBe(1);
  });
});

// ── overallPassEvaluator ─────────────────────────────────────────────────────

describe('overallPassEvaluator', () => {
  it('should return score 1 when all checks pass', () => {
    const result = overallPassEvaluator(makeRun(), makeExample());
    expect(result.key).toBe('overall_pass');
    expect(result.score).toBe(1);
  });

  it('should return score 0 when tool selection fails', () => {
    const result = overallPassEvaluator(
      makeRun({ tool_calls: [{ name: 'wrong_tool', args: {}, result: '{}' }] }),
      makeExample()
    );
    expect(result.score).toBe(0);
  });

  it('should return score 0 when content validation fails', () => {
    const result = overallPassEvaluator(
      makeRun({ response: 'No relevant data found' }),
      makeExample({ mustContain: ['AAPL'] })
    );
    expect(result.score).toBe(0);
  });

  it('should return score 0 when negative validation fails', () => {
    const result = overallPassEvaluator(
      makeRun({ response: 'I don\'t know anything about that' }),
      makeExample()
    );
    expect(result.score).toBe(0);
  });

  it('should return score 0 when verification metadata check fails', () => {
    const result = overallPassEvaluator(
      makeRun({ response: 'AAPL is currently trading at $195.50' }),
      makeExample({ requiresVerification: true })
    );
    expect(result.score).toBe(0);
  });
});

// ── verificationMetadataEvaluator ───────────────────────────────────────────

describe('verificationMetadataEvaluator', () => {
  it('should return score 1 when verification metadata is present', () => {
    const result = verificationMetadataEvaluator(makeRun(), makeExample());
    expect(result.key).toBe('verification_metadata');
    expect(result.score).toBe(1);
  });

  it('should return score 0 when tool-backed response misses metadata', () => {
    const result = verificationMetadataEvaluator(
      makeRun({ response: 'AAPL is currently trading at $195.50' }),
      makeExample({ requiresVerification: true })
    );
    expect(result.score).toBe(0);
  });

  it('should return score 1 when no verification is required', () => {
    const result = verificationMetadataEvaluator(
      makeRun({ response: 'Please provide a message.' }),
      makeExample({ expectedTools: [], requiresVerification: false })
    );
    expect(result.score).toBe(1);
  });
});
