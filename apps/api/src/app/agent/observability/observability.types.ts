export type FeedbackRating = 'down' | 'up';

export interface AgentTokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface AgentLatencyBreakdown {
  reasoningMs: number;
  toolMs: number;
  totalMs: number;
}

export interface AgentToolExecutionMetric {
  errorType?: string;
  latencyMs: number;
  name: string;
  success: boolean;
}

export interface AgentExecutionTelemetry {
  latency: Omit<AgentLatencyBreakdown, 'totalMs'>;
  tokenUsage?: AgentTokenUsage;
  toolExecutions: AgentToolExecutionMetric[];
}

export interface AgentRequestObservability {
  errorType?: string;
  isError: boolean;
  latency: AgentLatencyBreakdown;
  orchestrator: 'deterministic' | 'langgraph';
  requestId: string;
  sessionId: string;
  timestamp: string;
  tokenUsage?: AgentTokenUsage;
  toolExecutions: AgentToolExecutionMetric[];
  toolStats: {
    failure: number;
    success: number;
    total: number;
  };
}

export interface AgentFeedbackInput {
  note?: string;
  rating: FeedbackRating;
  requestId: string;
  sessionId: string;
}

export interface AgentFeedbackRecord extends AgentFeedbackInput {
  createdAt: string;
  id: string;
  userHash: string;
}

export interface AgentMetricsSnapshot {
  errors: Record<string, number>;
  feedback: {
    down: number;
    total: number;
    up: number;
  };
  generatedAt: string;
  latencyMs: {
    avg: AgentLatencyBreakdown;
    p95: AgentLatencyBreakdown;
  };
  tokens: {
    input: number;
    output: number;
    requestsWithUsage: number;
    total: number;
  };
  tools: Record<
    string,
    {
      failure: number;
      success: number;
    }
  >;
  totals: {
    error: number;
    requests: number;
    success: number;
  };
}
