import type { EvaluationResult } from 'langsmith/evaluation';

/**
 * Scores based on how many expected patterns appear in the response.
 * Each pattern in expectedPatterns is treated as a case-insensitive regex.
 * Score = matched / total. If no patterns specified, score is 1.0.
 */
export function dataAccuracy({
  outputs,
  referenceOutputs
}: {
  outputs?: Record<string, unknown>;
  referenceOutputs?: Record<string, unknown>;
}): EvaluationResult {
  const response = (outputs?.response as string) ?? '';
  const patterns = (referenceOutputs?.expectedPatterns as string[]) ?? [];

  if (patterns.length === 0) {
    return { key: 'data_accuracy', score: 1.0, comment: 'No patterns to check' };
  }

  let matched = 0;
  const results: string[] = [];

  for (const pattern of patterns) {
    try {
      const regex = new RegExp(pattern, 'i');
      if (regex.test(response)) {
        matched++;
        results.push(`+ ${pattern}`);
      } else {
        results.push(`- ${pattern}`);
      }
    } catch {
      // If pattern is not valid regex, fall back to substring match
      if (response.toLowerCase().includes(pattern.toLowerCase())) {
        matched++;
        results.push(`+ ${pattern} (substring)`);
      } else {
        results.push(`- ${pattern} (substring)`);
      }
    }
  }

  const score = matched / patterns.length;
  return { key: 'data_accuracy', score, comment: results.join(', ') };
}
