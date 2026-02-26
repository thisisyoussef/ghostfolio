import { PortfolioService } from '@ghostfolio/api/app/portfolio/portfolio.service';
import { ConfigurationService } from '@ghostfolio/api/services/configuration/configuration.service';

import { Injectable, Optional } from '@nestjs/common';
import { traceable } from 'langsmith/traceable';
import { createHash, randomUUID } from 'node:crypto';

import { type ChatRequest, type ChatResponse } from './agent.types';
import { AgentError, ErrorType } from './errors/agent-error';
import { SessionMemoryService } from './memory/session-memory.service';
import { AgentObservabilityService } from './observability/agent-observability.service';
import {
  type AgentRequestObservability,
  type AgentToolExecutionMetric
} from './observability/observability.types';
import { AgentGraphService } from './orchestration/agent-graph.service';
import {
  DeterministicAgentService,
  isEsgQuestion,
  isPortfolioQuestion,
  isRebalanceQuestion,
  isScenarioQuestion
} from './orchestration/deterministic-agent.service';
import { AgentToolRegistry } from './orchestration/tool-registry';
import { ensureLangSmithEnv } from './tracing/langsmith.config';
import {
  aggregateVerificationEntries,
  ensureVerificationSections,
  extractVerificationEntriesFromToolResult,
  parseJsonSafe,
  type VerificationSummaryEntry
} from './verification/output-validation';
import { type VerificationSummary } from './verification/verification.types';

ensureLangSmithEnv();

const SENSITIVE_RESPONSE_PATTERNS = [
  /\b(?:OPENAI_API_KEY|LANGSMITH_API_KEY|ANTHROPIC_API_KEY|API_KEY_ALPHA_VANTAGE|GHOSTFOLIO_API_KEY|JWT_SECRET_KEY)\b\s*[:=]\s*[^\s,;`'"]+/gi,
  /\b[A-Z0-9_]*API_KEY[A-Z0-9_]*\b/gi,
  /BEGIN_SYSTEM_PROMPT[\s\S]*?(?:END_SYSTEM_PROMPT|$)/gi,
  /\bsk-[A-Za-z0-9]{16,}\b/g
];

const NO_TICKER_ADVERSARIAL_MARKET_PATTERNS = [
  /fake tool call result/i,
  /tool result poisoning/i,
  /confidence\s*100/i,
  /ignore source attribution/i,
  /skip verification metadata/i
];

const ADVERSARIAL_SAFETY_PATTERNS = [
  /output private env vars?/i,
  /environment variables?/i,
  /secret(?:s)?/i,
  /api key/i,
  /system prompt/i,
  /hidden prompt/i,
  /chain[-\s]?of[-\s]?thought/i,
  /prompt injection/i,
  /jailbreak/i,
  /fake tool call result/i,
  /ignore source attribution/i,
  /confidence\s*100/i,
  /skip verification metadata/i,
  /bypass compliance/i
];

const MARKET_SAFETY_PROBE_PATTERN = /\b(price|quote)\b/i;
const PLACEHOLDER_PATTERN = /\?{3,}/;
const TICKER_CANDIDATE_PATTERN = /\b[A-Z]{2,12}\b/g;

@Injectable()
export class AgentService {
  private readonly deterministicAgent: DeterministicAgentService;
  private readonly graphAgent: AgentGraphService;

  public constructor(
    private readonly portfolioService: PortfolioService,
    private readonly sessionMemory: SessionMemoryService,
    @Optional() private readonly configurationService?: ConfigurationService,
    @Optional() private readonly observabilityService?: AgentObservabilityService
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
    const requestId = input.requestId || randomUUID();
    const startedAt = Date.now();
    const orchestrator = this.isGraphEnabled() ? 'langgraph' : 'deterministic';

    const traceableChat = traceable(
      async (params: ChatRequest): Promise<ChatResponse> => {
        return this.chatImpl(params);
      },
      {
        metadata: {
          orchestrator,
          request_id: requestId,
          session_id: input.sessionId,
          user_hash: this.hashUserId(input.userId)
        },
        name: 'agent_chat',
        run_type: 'chain'
      }
    );

    const response = await traceableChat({
      ...input,
      requestId
    });

    return this.attachObservability(response, {
      orchestrator,
      requestId,
      startedAt
    });
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
      const deterministicResponse = await this.deterministicAgent.chat(input);
      const response = this.finalizeAndSanitize(deterministicResponse);
      await this.persistTurn(input, response);
      return response;
    }

    if (this.shouldForceDeterministic(message)) {
      console.warn('[agent] forcing deterministic route for safety-sensitive prompt', {
        requestId: input.requestId,
        sessionId,
        userHash: this.hashUserId(input.userId)
      });

      const deterministicResponse = await this.deterministicAgent.chat(input);
      const response = this.finalizeAndSanitize(deterministicResponse);
      await this.persistTurn(input, response);
      return response;
    }

    try {
      const graphResponse = await this.executeGraphWithTimeout(input);

      if (this.shouldRunDeterministicSecondPass(message, graphResponse)) {
        console.warn(
          '[agent] graph returned low-confidence response; retrying deterministic route',
          {
            requestId: input.requestId,
            sessionId,
            userHash: this.hashUserId(input.userId)
          }
        );

        const deterministicSecondPass = await this.deterministicAgent.chat(input);
        const retryResponse = this.finalizeAndSanitize(
          deterministicSecondPass
        );
        await this.persistTurn(input, retryResponse);
        return retryResponse;
      }

      const response = this.finalizeAndSanitize(graphResponse);
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
        console.warn(
          '[agent] graph orchestration failed; switching to deterministic fallback',
          {
            requestId: input.requestId,
            sessionId,
            userHash: this.hashUserId(input.userId)
          }
        );
        const fallbackResponse = await this.deterministicAgent.chat(input);
        const response = this.finalizeAndSanitize(
          this.withFallbackNotice(fallbackResponse)
        );
        await this.persistTurn(input, response);
        return response;
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
        const sanitizedResponse = this.sanitizeSensitiveResponse(response);

        await this.persistTurn(input, sanitizedResponse);

        return sanitizedResponse;
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
      const configured = this.configurationService.get(key as any);

      if (typeof configured === 'boolean') {
        return configured;
      }

      if (typeof configured === 'string') {
        const normalized = configured.trim().toLowerCase();
        if (['1', 'on', 'true', 'yes'].includes(normalized)) {
          return true;
        }
        if (['0', 'false', 'no', 'off'].includes(normalized)) {
          return false;
        }
      }

      return fallback;
    } catch {
      return fallback;
    }
  }

  private getNumberConfig(
    key: 'AGENT_MODEL_TIMEOUT_MS',
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
      const configured = this.configurationService.get(key as any);
      const parsed = Number(configured);

      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
    } catch {
      // no-op
    }

    return fallback;
  }

  private hashUserId(userId: string): string {
    return createHash('sha256').update(userId).digest('hex').slice(0, 16);
  }

  private isGraphEnabled(): boolean {
    return this.getBooleanConfig('ENABLE_FEATURE_AGENT_LANGGRAPH', false);
  }

  private async executeGraphWithTimeout(
    input: ChatRequest
  ): Promise<ChatResponse> {
    const modelTimeoutMs = this.getNumberConfig('AGENT_MODEL_TIMEOUT_MS', 12_000);
    const graphTimeoutMs = Math.min(
      18_000,
      Math.max(8_000, modelTimeoutMs + 4_000)
    );
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    try {
      const timeout = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(
            new AgentError(
              ErrorType.MODEL,
              `Graph orchestration timed out after ${graphTimeoutMs}ms.`,
              true
            )
          );
        }, graphTimeoutMs);
      });

      return await Promise.race([this.graphAgent.chat(input), timeout]);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  private shouldRunDeterministicSecondPass(
    message: string,
    response: ChatResponse
  ): boolean {
    if (response.isError) {
      return true;
    }

    const lower = response.response.toLowerCase();
    const isHelpMenu = lower.includes('i can help you with');
    const likelyInScope = this.isLikelyInScopeMessage(message);

    if (response.toolCalls.length === 0 && likelyInScope) {
      return true;
    }

    if (isHelpMenu && likelyInScope) {
      return true;
    }

    if (this.requiresExplicitRiskLevel(message) && !this.hasExplicitRiskLevel(lower)) {
      return true;
    }

    if (
      this.requiresComplianceToolEvidence(message) &&
      !this.responseIncludesTool(response, 'compliance_check')
    ) {
      return true;
    }

    if (
      this.isNoTickerAdversarialMarketProbe(message) &&
      !this.responseIncludesTool(response, 'market_data_fetch')
    ) {
      return true;
    }

    if (
      this.requestsUnsupportedPortfolioMetric(message) &&
      !this.hasCapabilityAcknowledgement(lower)
    ) {
      return true;
    }

    return false;
  }

  private isLikelyInScopeMessage(message: string): boolean {
    if (
      isEsgQuestion(message) ||
      isPortfolioQuestion(message) ||
      isRebalanceQuestion(message) ||
      isScenarioQuestion(message)
    ) {
      return true;
    }

    const lower = message.toLowerCase();
    return /\b(yes|yeah|yep|ok|okay|both|all of the above|go ahead|do that)\b/.test(
      lower
    );
  }

  private shouldForceDeterministic(message: string): boolean {
    return (
      this.requiresComplianceToolEvidence(message) ||
      this.isAdversarialSensitiveMessage(message) ||
      this.isNoTickerMarketSafetyProbe(message)
    );
  }

  private requiresComplianceToolEvidence(message: string): boolean {
    return isEsgQuestion(message);
  }

  private responseIncludesTool(response: ChatResponse, toolName: string): boolean {
    return response.toolCalls.some((toolCall) => toolCall.name === toolName);
  }

  private isAdversarialSensitiveMessage(message: string): boolean {
    return ADVERSARIAL_SAFETY_PATTERNS.some((pattern) => pattern.test(message));
  }

  private isNoTickerMarketSafetyProbe(message: string): boolean {
    if (!MARKET_SAFETY_PROBE_PATTERN.test(message)) {
      return false;
    }

    if (!PLACEHOLDER_PATTERN.test(message)) {
      return false;
    }

    return this.extractTickerCandidates(message).length === 0;
  }

  private isNoTickerAdversarialMarketProbe(message: string): boolean {
    if (this.extractTickerCandidates(message).length > 0) {
      return false;
    }

    if (this.isNoTickerMarketSafetyProbe(message)) {
      return true;
    }

    return NO_TICKER_ADVERSARIAL_MARKET_PATTERNS.some((pattern) => {
      return pattern.test(message);
    });
  }

  private extractTickerCandidates(message: string): string[] {
    const matches = message.match(TICKER_CANDIDATE_PATTERN) || [];
    return Array.from(new Set(matches.map((match) => match.toUpperCase())));
  }

  private requiresExplicitRiskLevel(message: string): boolean {
    return /(overall\s+risk\s+level|high,\s*medium,\s*or\s*low|high\s+medium\s+or\s+low)/i.test(
      message
    );
  }

  private hasExplicitRiskLevel(responseLower: string): boolean {
    return /\b(high|medium|low)\b/.test(responseLower);
  }

  private requestsUnsupportedPortfolioMetric(message: string): boolean {
    const lower = message.toLowerCase();

    return (
      /(sharpe|sortino|correlation|benchmark|s&p|sp500|expected return|projected return|forecast|forward return)/.test(
        lower
      ) || /recover.*return/.test(lower)
    );
  }

  private hasCapabilityAcknowledgement(responseLower: string): boolean {
    return /(can't|cannot|not currently|not available|capability note|closest available)/.test(
      responseLower
    );
  }

  private withFallbackNotice(response: ChatResponse): ChatResponse {
    const notice =
      'Note: I had a temporary reasoning-engine issue and answered using deterministic fallback mode.';

    if (!this.shouldAttachFallbackNotice(response)) {
      return response;
    }

    if (response.response.includes(notice)) {
      return response;
    }

    return {
      ...response,
      response: `${response.response}\n\n${notice}`
    };
  }

  private finalizeAndSanitize(response: ChatResponse): ChatResponse {
    const finalized = this.finalizeVerifiedResponse(response);
    return this.sanitizeSensitiveResponse(finalized);
  }

  private shouldAttachFallbackNotice(response: ChatResponse): boolean {
    if (response.isError) {
      return true;
    }

    if (response.toolCalls.length > 0) {
      return false;
    }

    const lower = response.response.toLowerCase();

    if (lower.includes('i can help you with')) {
      return true;
    }

    return false;
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

  private finalizeVerifiedResponse(response: ChatResponse): ChatResponse {
    if (response.toolCalls.length === 0) {
      return response;
    }

    const verificationEntries: VerificationSummaryEntry[] = [];
    const parseErrors: string[] = [];

    for (const toolCall of response.toolCalls) {
      const parsedResult = parseJsonSafe(toolCall.result);

      if (parsedResult.error) {
        parseErrors.push(
          `${toolCall.name}: unable to parse tool result JSON (${parsedResult.error})`
        );
        continue;
      }

      verificationEntries.push(
        ...extractVerificationEntriesFromToolResult({
          toolName: toolCall.name,
          parsed: parsedResult.parsed
        })
      );
    }

    if (parseErrors.length > 0) {
      return this.buildVerificationFailureResponse(
        response.sessionId,
        response.toolCalls,
        parseErrors,
        response.telemetry
      );
    }

    const verification = aggregateVerificationEntries(verificationEntries);
    const responseWithSections = ensureVerificationSections({
      response: response.response,
      summary: verification
    });

    return {
      ...response,
      response: responseWithSections,
      verification
    };
  }

  private sanitizeSensitiveResponse(response: ChatResponse): ChatResponse {
    const sanitized = this.sanitizeSensitiveText(response.response);

    if (sanitized === response.response) {
      return response;
    }

    return {
      ...response,
      response: sanitized
    };
  }

  private sanitizeSensitiveText(text: string): string {
    let sanitized = text;
    let redacted = false;

    for (const pattern of SENSITIVE_RESPONSE_PATTERNS) {
      sanitized = sanitized.replace(pattern, () => {
        redacted = true;
        return '[redacted secret]';
      });
    }

    if (
      redacted &&
      !/cannot expose secrets or internal prompts/i.test(sanitized)
    ) {
      sanitized = `${sanitized}\n\nI cannot expose secrets or internal prompts.`;
    }

    return sanitized;
  }

  private buildVerificationFailureResponse(
    sessionId: string,
    toolCalls: ChatResponse['toolCalls'],
    issues: string[],
    telemetry?: ChatResponse['telemetry']
  ): ChatResponse {
    const verification: VerificationSummary = {
      status: 'fail',
      confidenceScore: 0,
      confidenceLevel: 'low',
      checks: {
        outputValidation: {
          passed: false,
          reason: 'Unable to parse tool result payload for verification.',
          details: { issues }
        }
      },
      sources: [],
      generatedAt: new Date().toISOString()
    };

    return {
      errorType: ErrorType.DATA,
      isError: true,
      response:
        'I could not safely verify the tool outputs for this response. Please retry your request.',
      sessionId,
      toolCalls,
      ...(telemetry ? { telemetry } : {}),
      verification
    };
  }

  private async attachObservability(
    response: ChatResponse,
    context: {
      orchestrator: 'deterministic' | 'langgraph';
      requestId: string;
      startedAt: number;
    }
  ): Promise<ChatResponse> {
    const totalMs = Math.max(0, Date.now() - context.startedAt);
    const telemetry = response.telemetry;

    const toolExecutions =
      telemetry?.toolExecutions?.length && telemetry.toolExecutions.length > 0
        ? telemetry.toolExecutions
        : this.deriveToolExecutionsFromToolCalls(response.toolCalls);

    const toolMs =
      telemetry?.latency?.toolMs !== undefined
        ? this.normalizeLatency(telemetry.latency.toolMs)
        : response.toolCalls.length > 0
          ? totalMs
          : 0;

    const reasoningMs =
      telemetry?.latency?.reasoningMs !== undefined
        ? this.normalizeLatency(telemetry.latency.reasoningMs)
        : Math.max(0, totalMs - toolMs);

    const tokenUsage =
      telemetry?.tokenUsage &&
      telemetry.tokenUsage.totalTokens > 0
        ? telemetry.tokenUsage
        : undefined;

    const toolStats = {
      failure: toolExecutions.filter((toolExecution) => !toolExecution.success)
        .length,
      success: toolExecutions.filter((toolExecution) => toolExecution.success)
        .length,
      total: toolExecutions.length
    };

    const observability: AgentRequestObservability = {
      ...(response.errorType ? { errorType: response.errorType } : {}),
      isError: response.isError === true,
      latency: {
        reasoningMs,
        toolMs,
        totalMs
      },
      orchestrator: context.orchestrator,
      requestId: context.requestId,
      sessionId: response.sessionId,
      timestamp: new Date().toISOString(),
      ...(tokenUsage ? { tokenUsage } : {}),
      toolExecutions,
      toolStats
    };

    try {
      const traceableMetrics = traceable(
        async () => {
          return true;
        },
        {
          metadata: {
            error_type: observability.errorType || null,
            latency_reasoning_ms: observability.latency.reasoningMs,
            latency_tool_ms: observability.latency.toolMs,
            latency_total_ms: observability.latency.totalMs,
            orchestrator: observability.orchestrator,
            request_id: observability.requestId,
            session_id: observability.sessionId,
            token_total: observability.tokenUsage?.totalTokens || 0,
            tool_failure_count: observability.toolStats.failure,
            tool_success_count: observability.toolStats.success
          },
          name: 'agent_observability_metrics',
          run_type: 'chain'
        }
      );

      await traceableMetrics();
    } catch {
      // Best effort only; observability should never break the response path.
    }

    try {
      await this.observabilityService?.recordChatOutcome(observability);
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      console.warn(`[agent-observability] failed to record metrics: ${details}`);
    }

    this.logObservability(observability);

    const responseWithoutTelemetry: ChatResponse = {
      ...response
    };
    delete responseWithoutTelemetry.telemetry;

    return {
      ...responseWithoutTelemetry,
      observability,
      requestId: context.requestId
    };
  }

  private deriveToolExecutionsFromToolCalls(
    toolCalls: ChatResponse['toolCalls']
  ): AgentToolExecutionMetric[] {
    return toolCalls.map((toolCall) => {
      const parsed = parseJsonSafe(toolCall.result);
      const hasParseError = Boolean(parsed.error);
      const hasStructuredError =
        !hasParseError && this.payloadRepresentsFailure(parsed.parsed);

      return {
        errorType: hasParseError ? ErrorType.TOOL : undefined,
        latencyMs: 0,
        name: toolCall.name,
        success: !hasParseError && !hasStructuredError
      };
    });
  }

  private payloadRepresentsFailure(payload: unknown): boolean {
    if (!payload || typeof payload !== 'object') {
      return false;
    }

    if ('error' in (payload as Record<string, unknown>)) {
      const error = (payload as Record<string, unknown>).error;
      if (typeof error === 'string' && error.trim().length > 0) {
        return true;
      }
    }

    const entries = Object.values(payload as Record<string, unknown>);
    if (entries.length === 0) {
      return false;
    }

    const allErrored = entries.every((entry) => {
      if (!entry || typeof entry !== 'object') {
        return false;
      }

      const error = (entry as Record<string, unknown>).error;
      return typeof error === 'string' && error.trim().length > 0;
    });

    return allErrored;
  }

  private normalizeLatency(value: number): number {
    if (!Number.isFinite(value) || value < 0) {
      return 0;
    }

    return Math.round(value * 100) / 100;
  }

  private logObservability(observability: AgentRequestObservability): void {
    const payload = {
      error_type: observability.errorType || null,
      is_error: observability.isError,
      latency_ms: observability.latency,
      orchestrator: observability.orchestrator,
      request_id: observability.requestId,
      session_id: observability.sessionId,
      timestamp: observability.timestamp,
      token_usage: observability.tokenUsage || null,
      tool_stats: observability.toolStats
    };

    console.info(`[agent-observability] ${JSON.stringify(payload)}`);
  }
}

export type { ChatResponse } from './agent.types';
