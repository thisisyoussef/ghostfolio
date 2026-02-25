import { ConfigurationService } from '@ghostfolio/api/services/configuration/configuration.service';

import { ChatAnthropic } from '@langchain/anthropic';
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage
} from '@langchain/core/messages';
import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { Injectable, Optional } from '@nestjs/common';
import { traceable } from 'langsmith/traceable';

import { type ChatResponse, type ToolCallInfo } from '../agent.types';
import { AgentError, ErrorType } from '../errors/agent-error';
import {
  SessionMemoryService,
  type SessionMessage
} from '../memory/session-memory.service';
import {
  type AgentTokenUsage,
  type AgentToolExecutionMetric
} from '../observability/observability.types';
import { AgentToolRegistry } from './tool-registry';

const GraphState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    default: () => [],
    reducer: (left, right) => left.concat(right)
  }),
  stepCount: Annotation<number>({
    default: () => 0,
    reducer: (_, right) => right
  }),
  reasoningMs: Annotation<number>({
    default: () => 0,
    reducer: (_, right) => right
  }),
  toolMs: Annotation<number>({
    default: () => 0,
    reducer: (_, right) => right
  }),
  tokenUsage: Annotation<AgentTokenUsage>({
    default: () => ({
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0
    }),
    reducer: (_, right) => right
  }),
  toolCalls: Annotation<ToolCallInfo[]>({
    default: () => [],
    reducer: (left, right) => left.concat(right)
  }),
  toolExecutions: Annotation<AgentToolExecutionMetric[]>({
    default: () => [],
    reducer: (left, right) => left.concat(right)
  })
});

type AgentGraphState = typeof GraphState.State;
type LlmRunnable = {
  invoke(messages: BaseMessage[]): Promise<AIMessage>;
};

const DEFAULT_MODEL = 'claude-3-5-sonnet-latest';
const DEFAULT_MAX_STEPS = 4;
const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_CONTEXT_BUDGET_BYTES = 14_000;
const DEFAULT_MESSAGE_CHAR_LIMIT = 1_000;
const DEFAULT_SUMMARY_CHAR_LIMIT = 2_400;
const DEFAULT_TOOL_MESSAGE_CHAR_LIMIT = 600;

@Injectable()
export class AgentGraphService {
  public constructor(
    private readonly sessionMemory: SessionMemoryService,
    private readonly toolRegistry: AgentToolRegistry,
    @Optional() private readonly configurationService?: ConfigurationService
  ) {}

  public async chat(input: {
    message: string;
    requestId?: string;
    sessionId: string;
    userId: string;
  }): Promise<ChatResponse> {
    const { message, requestId, sessionId, userId } = input;

    const model = this.buildModel(userId);
    const initialMessages = await this.buildInitialMessages(
      userId,
      sessionId,
      message
    );

    const maxSteps = this.getNumberConfig(
      'AGENT_MAX_GRAPH_STEPS',
      DEFAULT_MAX_STEPS
    );

    const graph = this.buildGraph({ maxSteps, model, requestId, userId });

    const initialState: AgentGraphState = {
      messages: initialMessages,
      reasoningMs: 0,
      stepCount: 0,
      tokenUsage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0
      },
      toolCalls: [],
      toolExecutions: [],
      toolMs: 0
    };

    const state = await graph.invoke(initialState);
    const response = this.extractFinalResponse(state.messages);
    const tokenUsage = state.tokenUsage || {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0
    };
    const reasoningMs = Number(state.reasoningMs) || 0;
    const toolMs = Number(state.toolMs) || 0;
    const toolExecutions = state.toolExecutions || [];

    return {
      response,
      sessionId,
      telemetry: {
        latency: {
          reasoningMs,
          toolMs
        },
        ...(tokenUsage.totalTokens > 0
          ? { tokenUsage }
          : {}),
        toolExecutions
      },
      toolCalls: state.toolCalls
    };
  }

  private async buildInitialMessages(
    userId: string,
    sessionId: string,
    currentMessage: string
  ): Promise<BaseMessage[]> {
    const context = await this.sessionMemory.getConversationContext(
      userId,
      sessionId
    );
    const boundedSummary = this.truncateText(
      context.summary,
      DEFAULT_SUMMARY_CHAR_LIMIT
    );
    const normalizedRecentMessages = context.recentMessages.map((message) => {
      return this.normalizeMessageForContext(message);
    });

    const systemSections = [
      'You are a portfolio assistant for Ghostfolio. Use tools whenever data is required. ' +
        'Prefer factual, concise responses grounded in tool outputs. ' +
        'When a user asks for both risk and ESG in one message, call both relevant tools in the same turn before answering. ' +
        'For ESG follow-up questions about biggest offender impact or score changes if holdings are removed, use compliance tool outputs to compute and explain the scenario. ' +
        'When ESG requests name specific holdings, pass those tickers via compliance_check.symbols so the response is scoped. ' +
        'For stress tests, expected shortfall, basis-point sensitivity, and breakeven questions, use scenario_analysis. ' +
        'Never call market_data_fetch unless you have explicit ticker symbols. Never treat words like "add", "both", or "yes" as symbols. ' +
        'If user intent is unclear, ask a brief clarification.'
    ];

    if (boundedSummary) {
      systemSections.push(`Conversation summary:\n${boundedSummary}`);
    }

    const contextAnchors = this.buildContextAnchors(normalizedRecentMessages);
    if (contextAnchors) {
      systemSections.push(`Recent context anchors:\n${contextAnchors}`);
    }

    const systemContent = systemSections.join('\n\n');
    const budgetForHistory = Math.max(
      1_500,
      DEFAULT_CONTEXT_BUDGET_BYTES -
        this.byteLength(systemContent) -
        this.byteLength(currentMessage)
    );
    const boundedRecentMessages = this.selectRecentMessagesWithinBudget(
      normalizedRecentMessages,
      budgetForHistory
    );

    const messages: BaseMessage[] = [
      new SystemMessage({
        content: systemContent
      })
    ];

    for (const historyMessage of boundedRecentMessages) {
      messages.push(this.toModelMessage(historyMessage));
    }

    messages.push(new HumanMessage({ content: currentMessage }));

    const toolPayloadBytes = boundedRecentMessages
      .filter((message) => message.role === 'tool')
      .reduce((sum, message) => {
        return sum + this.byteLength(message.content);
      }, 0);

    this.logContextPreflight({
      contextBytes: this.computeMessageBytes(messages),
      droppedMessages:
        normalizedRecentMessages.length - boundedRecentMessages.length,
      messageCount: messages.length,
      sessionId,
      summaryBytes: this.byteLength(boundedSummary),
      toolPayloadBytes,
      userHash: this.hashUserId(userId)
    });

    return messages;
  }

  private buildGraph(args: {
    maxSteps: number;
    model: LlmRunnable;
    requestId?: string;
    userId: string;
  }) {
    const { maxSteps, model, requestId, userId } = args;

    const workflow = new StateGraph(GraphState)
      .addNode('reason', async (state: AgentGraphState) => {
        return this.reasonNode(state, model, userId, requestId);
      })
      .addNode('tool', async (state: AgentGraphState) => {
        return this.toolNode(state, userId, requestId);
      })
      .addNode('respond', async (state: AgentGraphState) => {
        return this.respondNode(state, maxSteps, requestId);
      })
      .addEdge(START, 'reason')
      .addConditionalEdges(
        'reason',
        (state: AgentGraphState) => {
          const lastMessage = state.messages[state.messages.length - 1];
          const lastAi = lastMessage instanceof AIMessage ? lastMessage : null;

          if (
            lastAi?.tool_calls?.length &&
            state.stepCount <= maxSteps
          ) {
            return 'tool';
          }

          return 'respond';
        },
        {
          respond: 'respond',
          tool: 'tool'
        }
      )
      .addEdge('tool', 'reason')
      .addEdge('respond', END);

    return workflow.compile();
  }

  private buildModel(userId: string): LlmRunnable {
    const modelName = this.getStringConfig('AGENT_ANTHROPIC_MODEL', DEFAULT_MODEL);
    const tools = this.toolRegistry.getLangChainTools({ userId });

    return new ChatAnthropic({
      anthropicApiKey: process.env.ANTHROPIC_API_KEY,
      model: modelName,
      temperature: 0
    }).bindTools(tools as any) as unknown as LlmRunnable;
  }

  private extractFinalResponse(messages: BaseMessage[]): string {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];

      if (!(message instanceof AIMessage)) {
        continue;
      }

      const content = this.messageContentToString(message.content);
      if (content.trim()) {
        return content;
      }
    }

    return 'I could not generate a final response. Please try rephrasing your request.';
  }

  private getNumberConfig(
    key:
      | 'AGENT_MAX_GRAPH_STEPS'
      | 'AGENT_MODEL_TIMEOUT_MS'
      | 'AGENT_MEMORY_RECENT_MESSAGES',
    fallback: number
  ): number {
    const envValue = process.env[key];
    if (envValue) {
      const parsed = Number(envValue);
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
    }

    if (!this.configurationService) {
      return fallback;
    }

    try {
      const parsed = Number(this.configurationService.get(key as any));
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
    } catch {
      // no-op
    }

    return fallback;
  }

  private getStringConfig(
    key: 'AGENT_ANTHROPIC_MODEL',
    fallback: string
  ): string {
    const envValue = process.env[key];
    if (envValue?.trim()) {
      return envValue.trim();
    }

    if (!this.configurationService) {
      return fallback;
    }

    try {
      const configured = this.configurationService.get(key as any);
      if (configured && String(configured).trim()) {
        return String(configured).trim();
      }
    } catch {
      // no-op
    }

    return fallback;
  }

  private messageContentToString(content: unknown): string {
    if (typeof content === 'string') {
      return content;
    }

    if (!Array.isArray(content)) {
      return '';
    }

    return content
      .map((item) => {
        if (typeof item === 'string') {
          return item;
        }

        if (item && typeof item === 'object' && 'text' in item) {
          const text = (item as { text?: unknown }).text;
          return typeof text === 'string' ? text : '';
        }

        return '';
      })
      .join(' ')
      .trim();
  }

  private async reasonNode(
    state: AgentGraphState,
    model: LlmRunnable,
    userId: string,
    requestId?: string
  ): Promise<Partial<AgentGraphState>> {
    const timeoutMs = this.getNumberConfig(
      'AGENT_MODEL_TIMEOUT_MS',
      DEFAULT_TIMEOUT_MS
    );
    const startedAt = Date.now();

    const reasonSpan = traceable(
      async () => {
        const invocation = model.invoke(state.messages);
        const timeout = new Promise<never>((_, reject) => {
          setTimeout(() => {
            reject(
              new AgentError(
                ErrorType.MODEL,
                `Model timed out after ${timeoutMs}ms.`,
                true
              )
            );
          }, timeoutMs);
        });

        const result = (await Promise.race([invocation, timeout])) as AIMessage;

        return result;
      },
      {
        metadata: {
          orchestrator: 'langgraph',
          request_id: requestId || 'unknown',
          user_id: this.hashUserId(userId)
        },
        name: 'agent_reason',
        run_type: 'llm'
      }
    );

    try {
      const aiMessage = await reasonSpan();
      const elapsedMs = Math.max(0, Date.now() - startedAt);
      const tokenUsage = this.extractTokenUsage(aiMessage);

      return {
        messages: [aiMessage],
        reasoningMs: state.reasoningMs + elapsedMs,
        stepCount: state.stepCount + 1,
        tokenUsage: this.mergeTokenUsage(state.tokenUsage, tokenUsage)
      };
    } catch (error) {
      if (error instanceof AgentError) {
        throw error;
      }

      const message = error instanceof Error ? error.message : String(error);
      const isAuthError = /api key|401|unauthorized|authentication/i.test(message);

      throw new AgentError(
        ErrorType.MODEL,
        isAuthError
          ? 'Model authentication failed. Please verify ANTHROPIC_API_KEY.'
          : 'Model reasoning failed. Please try again.',
        true,
        error instanceof Error ? error : undefined
      );
    }
  }

  private async respondNode(
    state: AgentGraphState,
    maxSteps: number,
    requestId?: string
  ): Promise<Partial<AgentGraphState>> {
    const respondSpan = traceable(
      async () => {
        const lastMessage = state.messages[state.messages.length - 1];

        if (
          state.stepCount > maxSteps &&
          lastMessage instanceof AIMessage &&
          lastMessage.tool_calls?.length
        ) {
          return {
            messages: [
              new AIMessage({
                content:
                  'I reached the tool execution step limit before finalizing the answer. ' +
                  'Please narrow the question and try again.'
              })
            ]
          };
        }

        return {};
      },
      {
        metadata: {
          orchestrator: 'langgraph',
          request_id: requestId || 'unknown'
        },
        name: 'agent_respond',
        run_type: 'chain'
      }
    );

    return respondSpan();
  }

  private async toolNode(
    state: AgentGraphState,
    userId: string,
    requestId?: string
  ): Promise<Partial<AgentGraphState>> {
    const lastMessage = state.messages[state.messages.length - 1];

    if (!(lastMessage instanceof AIMessage) || !lastMessage.tool_calls?.length) {
      return {};
    }

    const toolMessages: BaseMessage[] = [];
    const executedCalls: ToolCallInfo[] = [];
    const executionMetrics: AgentToolExecutionMetric[] = [];
    const cachedExecutions = new Map<
      string,
      {
        errorType?: ErrorType;
        isError: boolean;
        serializedResult: string;
      }
    >();
    let totalToolMs = 0;

    for (const toolCall of lastMessage.tool_calls) {
      const toolName = toolCall.name;
      const toolArgs = (toolCall.args || {}) as Record<string, unknown>;
      const cacheKey = `${toolName}:${this.serializeToolArgs(toolArgs)}`;
      const cachedExecution = cachedExecutions.get(cacheKey);

      if (cachedExecution) {
        executedCalls.push({
          args: toolArgs,
          name: toolName,
          result: cachedExecution.serializedResult
        });
        executionMetrics.push({
          ...(cachedExecution.errorType
            ? { errorType: cachedExecution.errorType }
            : {}),
          latencyMs: 0,
          name: toolName,
          success: !cachedExecution.isError
        });
        toolMessages.push(
          new ToolMessage({
            content: cachedExecution.serializedResult,
            tool_call_id: String(toolCall.id || toolName)
          })
        );
        continue;
      }

      const startedAt = Date.now();

      const toolSpan = traceable(
        async () => {
          try {
            const result = await this.toolRegistry.executeToolCall(
              toolName,
              toolArgs,
              { userId }
            );

            return {
              errorType: undefined,
              isError: false,
              payload: result
            };
          } catch (error) {
            const classifiedError =
              error instanceof AgentError
                ? error
                : new AgentError(
                    ErrorType.TOOL,
                    error instanceof Error
                      ? error.message
                      : 'Tool execution failed.',
                    true,
                    error instanceof Error ? error : undefined
                  );

            return {
              errorType: classifiedError.type,
              isError: true,
              payload: {
                error: classifiedError.userMessage
              }
            };
          }
        },
        {
          metadata: {
            orchestrator: 'langgraph',
            request_id: requestId || 'unknown',
            user_id: this.hashUserId(userId)
          },
          name: toolName,
          run_type: 'tool'
        }
      );

      const toolResult = await toolSpan();
      const elapsedMs = Math.max(0, Date.now() - startedAt);
      const serializedResult = JSON.stringify(toolResult.payload);
      totalToolMs += elapsedMs;
      cachedExecutions.set(cacheKey, {
        ...(toolResult.errorType ? { errorType: toolResult.errorType } : {}),
        isError: toolResult.isError,
        serializedResult
      });

      executedCalls.push({
        args: toolArgs,
        name: toolName,
        result: serializedResult
      });
      executionMetrics.push({
        ...(toolResult.errorType ? { errorType: toolResult.errorType } : {}),
        latencyMs: elapsedMs,
        name: toolName,
        success: !toolResult.isError
      });

      toolMessages.push(
        new ToolMessage({
          content: serializedResult,
          tool_call_id: String(toolCall.id || toolName)
        })
      );
    }

    return {
      messages: toolMessages,
      toolCalls: executedCalls,
      toolExecutions: executionMetrics,
      toolMs: state.toolMs + totalToolMs
    };
  }

  private serializeToolArgs(args: Record<string, unknown>): string {
    try {
      return JSON.stringify(args);
    } catch {
      return '[unserializable-tool-args]';
    }
  }

  private mergeTokenUsage(
    current: AgentTokenUsage,
    incoming: AgentTokenUsage
  ): AgentTokenUsage {
    return {
      inputTokens: current.inputTokens + incoming.inputTokens,
      outputTokens: current.outputTokens + incoming.outputTokens,
      totalTokens: current.totalTokens + incoming.totalTokens
    };
  }

  private extractTokenUsage(message: AIMessage): AgentTokenUsage {
    const candidate = message as unknown as {
      response_metadata?: {
        usage?: Record<string, unknown>;
      };
      usage_metadata?: Record<string, unknown>;
    };

    const usage = candidate.usage_metadata || candidate.response_metadata?.usage;
    if (!usage) {
      return {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0
      };
    }

    const inputTokens = this.toTokenNumber(
      usage.input_tokens ?? usage.inputTokens
    );
    const outputTokens = this.toTokenNumber(
      usage.output_tokens ?? usage.outputTokens
    );
    const totalTokensRaw = this.toTokenNumber(
      usage.total_tokens ?? usage.totalTokens
    );
    const totalTokens =
      totalTokensRaw > 0 ? totalTokensRaw : inputTokens + outputTokens;

    return {
      inputTokens,
      outputTokens,
      totalTokens
    };
  }

  private toTokenNumber(value: unknown): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return 0;
    }

    return parsed;
  }

  private toModelMessage(message: SessionMessage): BaseMessage {
    switch (message.role) {
      case 'assistant':
        return new AIMessage({ content: message.content });

      case 'system':
        return new HumanMessage({
          content: `[Session context] ${message.content}`
        });

      case 'tool': {
        const toolLabel = message.toolName || 'tool';
        const summary = message.toolResultSummary || message.content;

        return new HumanMessage({
          content: `[Tool output: ${toolLabel}] ${summary}`
        });
      }

      case 'user':
      default:
        return new HumanMessage({ content: message.content });
    }
  }

  private normalizeMessageForContext(message: SessionMessage): SessionMessage {
    const maxLength =
      message.role === 'tool'
        ? DEFAULT_TOOL_MESSAGE_CHAR_LIMIT
        : DEFAULT_MESSAGE_CHAR_LIMIT;
    const normalizedContent =
      message.role === 'tool'
        ? message.toolResultSummary || message.content
        : message.content;

    return {
      ...message,
      content: this.truncateText(normalizedContent, maxLength),
      ...(message.toolResultSummary
        ? {
            toolResultSummary: this.truncateText(
              message.toolResultSummary,
              DEFAULT_TOOL_MESSAGE_CHAR_LIMIT
            )
          }
        : {})
    };
  }

  private selectRecentMessagesWithinBudget(
    messages: SessionMessage[],
    budgetBytes: number
  ): SessionMessage[] {
    const selected: SessionMessage[] = [];
    let usedBytes = 0;

    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      const messageBytes =
        this.byteLength(message.content) + this.byteLength(message.role) + 12;

      if (usedBytes + messageBytes > budgetBytes && selected.length > 0) {
        continue;
      }

      if (usedBytes + messageBytes > budgetBytes && selected.length === 0) {
        selected.unshift({
          ...message,
          content: this.truncateText(message.content, 240)
        });
        break;
      }

      selected.unshift(message);
      usedBytes += messageBytes;
    }

    return selected;
  }

  private buildContextAnchors(messages: SessionMessage[]): string {
    if (messages.length === 0) {
      return '';
    }

    const recent = messages.slice(-12);
    const recentTools = Array.from(
      new Set(
        recent
          .filter((message) => message.role === 'tool')
          .map((message) => String(message.toolName || '').trim())
          .filter(Boolean)
      )
    );

    const recentTickers = Array.from(
      new Set(
        recent.flatMap((message) => {
          return (message.content.match(/\b[A-Z]{2,5}\b/g) || []).filter(
            (token) => !['AND', 'THE', 'WITH', 'FROM', 'WHAT', 'THAT'].includes(token)
          );
        })
      )
    ).slice(0, 12);

    const numericAnchors = recent
      .flatMap((message) => {
        return message.content.match(/\b\d+(?:\.\d+)?\s*(?:%|bps|basis points?)?\b/gi) || [];
      })
      .slice(0, 20);

    const recentUserIntents = recent
      .filter((message) => message.role === 'user')
      .slice(-4)
      .map((message) => message.content.slice(0, 160));

    return JSON.stringify(
      {
        numericAnchors,
        recentTickers,
        recentTools,
        recentUserIntents
      },
      null,
      2
    );
  }

  private computeMessageBytes(messages: BaseMessage[]): number {
    return messages.reduce((sum, message) => {
      return sum + this.byteLength(this.messageContentToString(message.content));
    }, 0);
  }

  private byteLength(value: string): number {
    return Buffer.byteLength(value || '', 'utf8');
  }

  private truncateText(value: string, maxChars: number): string {
    if (!value) {
      return '';
    }

    if (value.length <= maxChars) {
      return value;
    }

    return `${value.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
  }

  private logContextPreflight(args: {
    contextBytes: number;
    droppedMessages: number;
    messageCount: number;
    sessionId: string;
    summaryBytes: number;
    toolPayloadBytes: number;
    userHash: string;
  }): void {
    console.info(
      `[agent-graph] context_preflight ${JSON.stringify({
        context_bytes: args.contextBytes,
        dropped_messages: args.droppedMessages,
        message_count: args.messageCount,
        session_id: args.sessionId,
        summary_bytes: args.summaryBytes,
        tool_payload_bytes: args.toolPayloadBytes,
        user_hash: args.userHash
      })}`
    );
  }

  private hashUserId(userId: string): string {
    let hash = 0;

    for (let index = 0; index < userId.length; index += 1) {
      hash = (hash << 5) - hash + userId.charCodeAt(index);
      hash |= 0;
    }

    return `u_${Math.abs(hash)}`;
  }
}
