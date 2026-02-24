/**
 * Shared types for the agent eval harness.
 *
 * EvalCase: a single test case with input, expected outputs, and metadata.
 * EvalInput: what gets sent to the agent API.
 * EvalReferenceOutput: ground truth for evaluators to score against.
 */

export interface EvalInput {
  message: string;
  session_id: string;
}

export interface EvalReferenceOutput {
  expectedTool: string | null; // null means no tool expected (error/refusal case)
  expectedPatterns: string[];  // regex or substring patterns the response should contain
  category: 'market_data' | 'portfolio' | 'compliance' | 'multi_turn' | 'error';
}

export interface EvalCase {
  inputs: EvalInput;
  outputs: EvalReferenceOutput;
}

/** Shape returned by POST /api/v1/agent/chat */
export interface AgentChatResponse {
  response: string;
  tool_calls: Array<{
    name: string;
    args: Record<string, unknown>;
    result: string;
  }>;
  session_id: string;
}
