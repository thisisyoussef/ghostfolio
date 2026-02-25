/**
 * TypeScript interfaces for the eval framework.
 * Stage 1 (Golden Sets) + Stage 2 (Labeled Scenarios).
 */

// ── Agent API response shape ─────────────────────────────────────────────────

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

// ── Golden data types (golden-data.yaml → eval-runner.ts) ────────────────────

/** A single turn in a multi-turn golden case */
export interface EvalTurn {
  query: string;
  expected_tools: string[];
  must_contain: string[];
  must_not_contain: string[];
}

/** A golden test case from golden-data.yaml */
export interface GoldenCase {
  id: string;
  query?: string;
  category: string;
  subcategory: string;
  difficulty: string;
  coverage_bucket?: 'happy_path' | 'edge_case' | 'adversarial' | 'multi_step';
  requires_verification?: boolean;
  expected_tools: string[];
  must_contain: string[];
  must_not_contain: string[];
  turns?: EvalTurn[];
}

/** Top-level shape of golden-data.yaml */
export interface GoldenDataFile {
  version: string;
  stage: number;
  cases: GoldenCase[];
}

// ── Eval result types ────────────────────────────────────────────────────────

/** Result of evaluating a single golden case */
export interface EvalResult {
  case_id: string;
  passed: boolean;
  checks: {
    tool_selection: boolean;
    content_validation: boolean;
    negative_validation: boolean;
    verification_metadata: boolean;
  };
  response_text: string;
  actual_tools: string[];
  duration_ms: number;
  error?: string;
}

/** Aggregated summary of a deterministic eval run */
export interface EvalSummary {
  total: number;
  passed: number;
  failed: number;
  pass_rate: number;
  by_category: Record<string, { total: number; passed: number }>;
  by_difficulty: Record<string, { total: number; passed: number }>;
}
