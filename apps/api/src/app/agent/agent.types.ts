import {
  type AgentExecutionTelemetry,
  type AgentRequestObservability
} from './observability/observability.types';
import { type VerificationSummary } from './verification/verification.types';

export interface ToolCallInfo {
  name: string;
  args: Record<string, unknown>;
  result: string;
}

export interface ChatResponse {
  response: string;
  toolCalls: ToolCallInfo[];
  sessionId: string;
  requestId?: string;
  observability?: AgentRequestObservability;
  telemetry?: AgentExecutionTelemetry;
  verification?: VerificationSummary;
  isError?: boolean;
  errorType?: string;
}

export interface ChatRequest {
  message: string;
  sessionId: string;
  userId: string;
  requestId?: string;
}
