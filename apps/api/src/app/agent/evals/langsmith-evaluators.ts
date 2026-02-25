/**
 * LangSmith-compatible deterministic evaluators.
 *
 * Each evaluator wraps the same binary check logic from eval-runner.ts
 * in the LangSmith evaluator shape: (run, example) => { key, score }.
 *
 * NO LLM-as-judge — all checks are pure substring/array matching.
 */
import {
  checkToolSelection,
  checkContentValidation,
  checkNegativeValidation,
  checkVerificationMetadata
} from './eval-runner';

// ── Types matching LangSmith evaluate() callback shapes ──────────────────────

export interface LangSmithRun {
  outputs: {
    response: string;
    tool_calls: Array<{ name: string; args: Record<string, unknown>; result: string }>;
    [key: string]: unknown;
  };
}

export interface LangSmithExample {
  outputs: {
    expectedTools: string[];
    mustContain: string[];
    mustNotContain: string[];
    category: string;
    requiresVerification?: boolean;
    [key: string]: unknown;
  };
}

export interface EvaluatorResult {
  key: string;
  score: number;
  comment?: string;
}

// ── Evaluator functions ──────────────────────────────────────────────────────

export function toolSelectionEvaluator(
  run: LangSmithRun,
  example: LangSmithExample
): EvaluatorResult {
  const expected = example.outputs.expectedTools;
  const actual = (run.outputs.tool_calls || []).map((tc) => tc.name);
  const passed = checkToolSelection(expected, actual);

  return {
    key: 'tool_selection',
    score: passed ? 1 : 0,
    comment: passed
      ? `Correct: called [${actual.join(', ')}]`
      : `Expected [${expected.join(', ')}], got [${actual.join(', ')}]`
  };
}

export function contentValidationEvaluator(
  run: LangSmithRun,
  example: LangSmithExample
): EvaluatorResult {
  const mustContain = example.outputs.mustContain;
  const response = run.outputs.response || '';
  const passed = checkContentValidation(mustContain, response);

  return {
    key: 'content_validation',
    score: passed ? 1 : 0,
    comment: passed
      ? 'All required patterns found'
      : `Missing patterns in response`
  };
}

export function negativeValidationEvaluator(
  run: LangSmithRun,
  example: LangSmithExample
): EvaluatorResult {
  const mustNotContain = example.outputs.mustNotContain;
  const response = run.outputs.response || '';
  const passed = checkNegativeValidation(mustNotContain, response);

  return {
    key: 'negative_validation',
    score: passed ? 1 : 0,
    comment: passed
      ? 'No forbidden patterns found'
      : `Forbidden pattern detected in response`
  };
}

export function overallPassEvaluator(
  run: LangSmithRun,
  example: LangSmithExample
): EvaluatorResult {
  const tool = toolSelectionEvaluator(run, example);
  const content = contentValidationEvaluator(run, example);
  const negative = negativeValidationEvaluator(run, example);
  const verification = verificationMetadataEvaluator(run, example);
  const passed =
    tool.score === 1 &&
    content.score === 1 &&
    negative.score === 1 &&
    verification.score === 1;

  return {
    key: 'overall_pass',
    score: passed ? 1 : 0,
    comment: `tool=${tool.score} content=${content.score} negative=${negative.score} verification=${verification.score}`
  };
}

export function verificationMetadataEvaluator(
  run: LangSmithRun,
  example: LangSmithExample
): EvaluatorResult {
  const expectedTools = example.outputs.expectedTools;
  const response = run.outputs.response || '';
  const requiresVerification = example.outputs.requiresVerification;
  const passed = checkVerificationMetadata({
    expectedTools,
    responseText: response,
    requiresVerification
  });

  return {
    key: 'verification_metadata',
    score: passed ? 1 : 0,
    comment: passed
      ? 'Verification and sources sections are present when required'
      : 'Missing verification/sources sections in tool-backed response'
  };
}
