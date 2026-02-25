import { PortfolioService } from '@ghostfolio/api/app/portfolio/portfolio.service';
import { ConfigurationService } from '@ghostfolio/api/services/configuration/configuration.service';

import { Injectable, Optional } from '@nestjs/common';
import { traceable } from 'langsmith/traceable';
import { createHash } from 'node:crypto';

import { type ChatRequest, type ChatResponse } from './agent.types';
import { AgentError, ErrorType } from './errors/agent-error';
import { SessionMemoryService } from './memory/session-memory.service';
import { AgentGraphService } from './orchestration/agent-graph.service';
import { DeterministicAgentService } from './orchestration/deterministic-agent.service';
import { AgentToolRegistry } from './orchestration/tool-registry';
import { ensureLangSmithEnv } from './tracing/langsmith.config';

ensureLangSmithEnv();

@Injectable()
export class AgentService {
  private readonly deterministicAgent: DeterministicAgentService;
  private readonly graphAgent: AgentGraphService;

  public constructor(
    private readonly portfolioService: PortfolioService,
    private readonly sessionMemory: SessionMemoryService,
    @Optional() private readonly configurationService?: ConfigurationService
  ) {
    const toolRegistry = new AgentToolRegistry(this.portfolioService);

    this.deterministicAgent = new DeterministicAgentService(
      this.portfolioService,
      this.sessionMemory
    );
    this.graphAgent = new AgentGraphService(
      this.sessionMemory,
      toolRegistry,
      this.configurationService
    );
  }

  public async chat(input: ChatRequest): Promise<ChatResponse> {
    const orchestrator = this.isGraphEnabled() ? 'langgraph' : 'deterministic';

    const traceableChat = traceable(
      async (params: ChatRequest): Promise<ChatResponse> => {
        return this.chatImpl(params);
      },
      {
        metadata: {
          orchestrator,
          session_id: input.sessionId,
          user_hash: this.hashUserId(input.userId)
        },
        name: 'agent_chat',
        run_type: 'chain'
      }
    );

    return traceableChat(input);
  }

  private async chatImpl(input: ChatRequest): Promise<ChatResponse> {
    const { message, sessionId } = input;

    if (!message.trim()) {
      return {
        response: 'Please provide a message to get started.',
        sessionId,
        toolCalls: []
      };
    }

    if (!this.isGraphEnabled()) {
      const response = await this.deterministicAgent.chat(input);
      await this.persistTurn(input, response);
      return response;
    }

    try {
      const response = await this.graphAgent.chat(input);
      await this.persistTurn(input, response);
      return response;
    } catch (error) {
      const modelError =
        error instanceof AgentError
          ? error
          : new AgentError(
              ErrorType.MODEL,
              'Model orchestration failed. Please try again shortly.',
              true,
              error instanceof Error ? error : undefined
            );

      console.error(`[agent] ${modelError.type} error:`, modelError.userMessage);

      try {
        const fallbackResponse = await this.deterministicAgent.chat(input);
        await this.persistTurn(input, fallbackResponse);
        return fallbackResponse;
      } catch (fallbackError) {
        const fallback =
          fallbackError instanceof AgentError
            ? fallbackError
            : new AgentError(
                ErrorType.MODEL,
                modelError.userMessage,
                true,
                fallbackError instanceof Error ? fallbackError : undefined
              );

        const response: ChatResponse = {
          errorType: ErrorType.MODEL,
          isError: true,
          response: fallback.userMessage,
          sessionId,
          toolCalls: []
        };

        await this.persistTurn(input, response);

        return response;
      }
    }
  }

  private getBooleanConfig(
    key: 'ENABLE_FEATURE_AGENT_LANGGRAPH',
    fallback: boolean
  ): boolean {
    const envValue = process.env[key];
    if (envValue !== undefined) {
      return String(envValue).toLowerCase() === 'true';
    }

    if (!this.configurationService) {
      return fallback;
    }

    try {
      return Boolean(this.configurationService.get(key as any));
    } catch {
      return fallback;
    }
  }

  private hashUserId(userId: string): string {
    return createHash('sha256').update(userId).digest('hex').slice(0, 16);
  }

  private isGraphEnabled(): boolean {
    return this.getBooleanConfig('ENABLE_FEATURE_AGENT_LANGGRAPH', false);
  }

  private async persistTurn(
    input: ChatRequest,
    response: ChatResponse
  ): Promise<void> {
    try {
      await this.sessionMemory.addTurn({
        assistantMessage: response.response,
        sessionId: input.sessionId,
        toolCalls: response.toolCalls,
        userId: input.userId,
        userMessage: input.message
      });
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      console.warn(`[agent] failed to persist chat turn: ${details}`);
    }
  }
}

export type { ChatResponse } from './agent.types';
