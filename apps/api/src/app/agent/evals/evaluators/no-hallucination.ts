import type { EvaluationResult } from 'langsmith/evaluation';

/**
 * Checks that dollar amounts in the response can be traced to tool output.
 * Extracts all $X.XX patterns from the response and verifies each appears
 * in at least one tool call's result.
 *
 * Score 1.0: all numbers traceable (or no numbers in response)
 * Score 0.0-0.99: proportional to traceable numbers
 *
 * For the current keyword router, this is effectively always 1.0 since
 * the service builds responses directly from tool output. Becomes critical
 * when LLM generates free-text responses.
 */
export function noHallucination({
  outputs
}: {
  outputs?: Record<string, unknown>;
}): EvaluationResult {
  const response = (outputs?.response as string) ?? '';
  const toolCalls = (outputs?.tool_calls ?? []) as Array<{ result: string }>;

  // Extract dollar amounts from response (e.g., $185.00, $1,234.56)
  const dollarPattern = /\$[\d,]+\.?\d*/g;
  const responseDollars = response.match(dollarPattern) ?? [];

  if (responseDollars.length === 0) {
    return { key: 'no_hallucination', score: 1.0, comment: 'No dollar amounts to verify' };
  }

  // Concatenate all tool results for checking
  const toolResultText = toolCalls.map((tc) => tc.result).join(' ');

  let traceableCount = 0;
  const details: string[] = [];

  for (const dollar of responseDollars) {
    // Strip $ and commas to get the raw number
    const rawNumber = dollar.replace(/[$,]/g, '');
    if (toolResultText.includes(rawNumber)) {
      traceableCount++;
      details.push(`+ ${dollar}`);
    } else {
      details.push(`- ${dollar} (not in tool output)`);
    }
  }

  const score = traceableCount / responseDollars.length;
  return { key: 'no_hallucination', score, comment: details.join(', ') };
}
