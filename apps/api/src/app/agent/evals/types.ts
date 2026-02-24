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

// ── Deterministic eval runner types (golden-data.yaml based) ──────────────

/** A single turn in a multi-turn eval case */
export interface EvalTurn {
  query: string;
  expected_tools: string[];
  must_contain: string[];
  must_not_contain: string[];
}

/** A golden test case from golden-data.yaml */
export interface GoldenCase {
  id: string;
  query?: string;            // present for single-turn cases
  category: string;
  subcategory: string;
  difficulty: string;
  expected_tools: string[];
  must_contain: string[];
  must_not_contain: string[];
  turns?: EvalTurn[];        // present for multi-turn cases
}

/** Top-level shape of golden-data.yaml */
export interface GoldenDataFile {
  version: string;
  stage: number;
  cases: GoldenCase[];
}

/** Result of evaluating a single golden case */
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
}

/** Aggregated summary of an eval run */
export interface EvalSummary {
  total: number;
  passed: number;
  failed: number;
  pass_rate: number;           // percentage (0-100)
  by_category: Record<string, { total: number; passed: number }>;
  by_difficulty: Record<string, { total: number; passed: number }>;
}

/** Alias for backward compatibility with task description */
export type ChatApiResponse = AgentChatResponse;
