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
  toolCalls: Annotation<ToolCallInfo[]>({
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

@Injectable()
export class AgentGraphService {
  public constructor(
    private readonly sessionMemory: SessionMemoryService,
    private readonly toolRegistry: AgentToolRegistry,
    @Optional() private readonly configurationService?: ConfigurationService
  ) {}

  public async chat(input: {
    message: string;
    sessionId: string;
    userId: string;
  }): Promise<ChatResponse> {
    const { message, sessionId, userId } = input;

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

    const graph = this.buildGraph({ maxSteps, model, userId });

    const initialState: AgentGraphState = {
      messages: initialMessages,
      stepCount: 0,
      toolCalls: []
    };

    const state = await graph.invoke(initialState);
    const response = this.extractFinalResponse(state.messages);

    return {
      response,
      sessionId,
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

    const messages: BaseMessage[] = [
      new SystemMessage({
        content:
          'You are a portfolio assistant for Ghostfolio. Use tools whenever data is required. ' +
          'Prefer factual, concise responses grounded in tool outputs. ' +
          'When a user asks for both risk and ESG in one message, call both relevant tools in the same turn before answering. ' +
          'For ESG follow-up questions about biggest offender impact or score changes if holdings are removed, use compliance tool outputs to compute and explain the scenario. ' +
          'If user intent is unclear, ask a brief clarification.'
      })
    ];

    if (context.summary) {
      messages.push(
        new SystemMessage({ content: `Conversation summary:\n${context.summary}` })
      );
    }

    for (const historyMessage of context.recentMessages) {
      messages.push(this.toModelMessage(historyMessage));
    }

    messages.push(new HumanMessage({ content: currentMessage }));

    return messages;
  }

  private buildGraph(args: {
    maxSteps: number;
    model: LlmRunnable;
    userId: string;
  }) {
    const { maxSteps, model, userId } = args;

    const workflow = new StateGraph(GraphState)
      .addNode('reason', async (state: AgentGraphState) => {
        return this.reasonNode(state, model, userId);
      })
      .addNode('tool', async (state: AgentGraphState) => {
        return this.toolNode(state, userId);
      })
      .addNode('respond', async (state: AgentGraphState) => {
        return this.respondNode(state, maxSteps);
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
    userId: string
  ): Promise<Partial<AgentGraphState>> {
    const timeoutMs = this.getNumberConfig(
      'AGENT_MODEL_TIMEOUT_MS',
      DEFAULT_TIMEOUT_MS
    );

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
          user_id: this.hashUserId(userId)
        },
        name: 'agent_reason',
        run_type: 'llm'
      }
    );

    try {
      const aiMessage = await reasonSpan();

      return {
        messages: [aiMessage],
        stepCount: state.stepCount + 1
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
    maxSteps: number
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
        name: 'agent_respond',
        run_type: 'chain'
      }
    );

    return respondSpan();
  }

  private async toolNode(
    state: AgentGraphState,
    userId: string
  ): Promise<Partial<AgentGraphState>> {
    const lastMessage = state.messages[state.messages.length - 1];

    if (!(lastMessage instanceof AIMessage) || !lastMessage.tool_calls?.length) {
      return {};
    }

    const toolMessages: BaseMessage[] = [];
    const executedCalls: ToolCallInfo[] = [];

    for (const toolCall of lastMessage.tool_calls) {
      const toolName = toolCall.name;
      const toolArgs = (toolCall.args || {}) as Record<string, unknown>;

      const toolSpan = traceable(
        async () => {
          try {
            const result = await this.toolRegistry.executeToolCall(
              toolName,
              toolArgs,
              { userId }
            );

            return {
              isError: false,
              payload: result
            };
          } catch (error) {
            const message =
              error instanceof AgentError
                ? error.userMessage
                : error instanceof Error
                  ? error.message
                  : String(error);

            return {
              isError: true,
              payload: {
                error: message
              }
            };
          }
        },
        {
          metadata: {
            orchestrator: 'langgraph',
            user_id: this.hashUserId(userId)
          },
          name: toolName,
          run_type: 'tool'
        }
      );

      const toolResult = await toolSpan();
      const serializedResult = JSON.stringify(toolResult.payload);

      executedCalls.push({
        args: toolArgs,
        name: toolName,
        result: serializedResult
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
      toolCalls: executedCalls
    };
  }

  private toModelMessage(message: SessionMessage): BaseMessage {
    switch (message.role) {
      case 'assistant':
        return new AIMessage({ content: message.content });

      case 'system':
        return new SystemMessage({ content: message.content });

      case 'tool': {
        const toolLabel = message.toolName || 'tool';
        const summary = message.toolResultSummary || message.content;

        return new SystemMessage({
          content: `[Tool:${toolLabel}] ${summary}`
        });
      }

      case 'user':
      default:
        return new HumanMessage({ content: message.content });
    }
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
