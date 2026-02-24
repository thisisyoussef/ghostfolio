import type { EvaluationResult } from 'langsmith/evaluation';

const ERROR_INDICATORS = [
  'stack trace',
  'Error:',
  'TypeError',
  'ReferenceError',
  'SyntaxError',
  'undefined',
  'ECONNREFUSED',
  'Internal Server Error'
];

/**
 * Scores response quality on a 0-1 scale:
 *   1.0 = non-empty, no error indicators, reasonable length (10-5000 chars)
 *   0.5 = response present but contains error indicators or is too short/long
 *   0.0 = empty response or HTTP error
 */
export function responseQuality({
  outputs
}: {
  outputs?: Record<string, unknown>;
}): EvaluationResult {
  const response = (outputs?.response as string) ?? '';

  // Empty response
  if (response.trim().length === 0) {
    return { key: 'response_quality', score: 0.0, comment: 'Empty response' };
  }

  // HTTP error passthrough
  if (response.startsWith('HTTP ')) {
    return { key: 'response_quality', score: 0.0, comment: `HTTP error: ${response.substring(0, 50)}` };
  }

  let score = 1.0;
  const issues: string[] = [];

  // Check for error indicators
  for (const indicator of ERROR_INDICATORS) {
    if (response.includes(indicator)) {
      score = Math.min(score, 0.5);
      issues.push(`Contains "${indicator}"`);
    }
  }

  // Length checks
  if (response.length < 10) {
    score = Math.min(score, 0.5);
    issues.push(`Too short (${response.length} chars)`);
  }
  if (response.length > 5000) {
    score = Math.min(score, 0.5);
    issues.push(`Too long (${response.length} chars)`);
  }

  return {
    key: 'response_quality',
    score,
    comment: issues.length > 0 ? issues.join('; ') : 'Good quality'
  };
}
