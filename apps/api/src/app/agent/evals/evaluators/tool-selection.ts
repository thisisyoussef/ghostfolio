import type { EvaluationResult } from 'langsmith/evaluation';

/**
 * Scores 1.0 if the agent invoked the expected tool, 0.0 otherwise.
 * If expectedTool is null (error/refusal case), scores 1.0 when no tools were called.
 */
export function toolSelection({
  outputs,
  referenceOutputs
}: {
  outputs?: Record<string, unknown>;
  referenceOutputs?: Record<string, unknown>;
}): EvaluationResult {
  const toolCalls = (outputs?.tool_calls ?? []) as Array<{ name: string }>;
  const expectedTool = referenceOutputs?.expectedTool as string | null;

  if (expectedTool === null) {
    // Expect no tool call
    const score = toolCalls.length === 0 ? 1.0 : 0.0;
    return { key: 'tool_selection', score, comment: score === 1.0 ? 'Correctly no tool' : `Unexpected tool: ${toolCalls[0]?.name}` };
  }

  const actualTool = toolCalls[0]?.name;
  const score = actualTool === expectedTool ? 1.0 : 0.0;
  return {
    key: 'tool_selection',
    score,
    comment: score === 1.0 ? `Correct: ${actualTool}` : `Expected ${expectedTool}, got ${actualTool || 'none'}`
  };
}
