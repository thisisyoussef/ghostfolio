export interface ToolCallInfo {
  name: string;
  args: Record<string, unknown>;
  result: string;
}

export interface ChatResponse {
  response: string;
  toolCalls: ToolCallInfo[];
  sessionId: string;
  isError?: boolean;
  errorType?: string;
}

export interface ChatRequest {
  message: string;
  sessionId: string;
  userId: string;
}
