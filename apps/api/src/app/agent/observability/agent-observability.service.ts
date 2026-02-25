import { Inject, Injectable, Optional, BadRequestException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';

import { AGENT_REDIS_CACHE_SERVICE } from '../memory/session-memory.service';
import {
  type AgentFeedbackInput,
  type AgentFeedbackRecord,
  type AgentMetricsSnapshot,
  type AgentRequestObservability
} from './observability.types';

interface RedisCacheLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttl?: number): Promise<void>;
}

interface PersistedMetricsState {
  errors: Record<string, number>;
  feedback: {
    down: number;
    up: number;
  };
  latencySamples: {
    reasoning: number[];
    tool: number[];
    total: number[];
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
  updatedAt: string;
}

const FEEDBACK_NOTE_MAX_LENGTH = 500;
const FEEDBACK_STORAGE_LIMIT = 200;
const METRICS_STORAGE_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const SAMPLE_WINDOW_SIZE = 500;
const SNAPSHOT_DEFAULT_LIMIT = 50;
const SNAPSHOT_MAX_LIMIT = 200;

@Injectable()
export class AgentObservabilityService {
  private fallbackMetricsState: PersistedMetricsState = this.createDefaultState();
  private readonly feedbackFallback = new Map<string, AgentFeedbackRecord[]>();

  public constructor(
    @Optional()
    @Inject(AGENT_REDIS_CACHE_SERVICE)
    private readonly redisCacheService?: RedisCacheLike
  ) {}

  public async getMetricsSnapshot(): Promise<AgentMetricsSnapshot> {
    const state = await this.readMetricsState();
    return this.toSnapshot(state);
  }

  public async listFeedback(
    userId: string,
    options?: {
      limit?: number;
      requestId?: string;
      sessionId?: string;
    }
  ): Promise<AgentFeedbackRecord[]> {
    const userHash = this.hashUserId(userId);
    const limit = this.normalizeLimit(options?.limit);
    const all = await this.readFeedback(userHash);

    const filtered = all.filter((item) => {
      if (options?.requestId && item.requestId !== options.requestId) {
        return false;
      }

      if (options?.sessionId && item.sessionId !== options.sessionId) {
        return false;
      }

      return true;
    });

    return filtered.slice(0, limit);
  }

  public async recordChatOutcome(
    observability: AgentRequestObservability
  ): Promise<AgentMetricsSnapshot> {
    const nextState = await this.updateMetrics((state) => {
      state.totals.requests += 1;

      if (observability.isError) {
        state.totals.error += 1;
      } else {
        state.totals.success += 1;
      }

      if (observability.errorType) {
        state.errors[observability.errorType] =
          (state.errors[observability.errorType] || 0) + 1;
      }

      this.pushLatencySample(state.latencySamples.reasoning, observability.latency.reasoningMs);
      this.pushLatencySample(state.latencySamples.tool, observability.latency.toolMs);
      this.pushLatencySample(state.latencySamples.total, observability.latency.totalMs);

      if (
        observability.tokenUsage &&
        observability.tokenUsage.totalTokens > 0
      ) {
        state.tokens.input += observability.tokenUsage.inputTokens;
        state.tokens.output += observability.tokenUsage.outputTokens;
        state.tokens.total += observability.tokenUsage.totalTokens;
        state.tokens.requestsWithUsage += 1;
      }

      for (const toolExecution of observability.toolExecutions) {
        if (!state.tools[toolExecution.name]) {
          state.tools[toolExecution.name] = {
            failure: 0,
            success: 0
          };
        }

        if (toolExecution.success) {
          state.tools[toolExecution.name].success += 1;
        } else {
          state.tools[toolExecution.name].failure += 1;
        }
      }
    });

    return this.toSnapshot(nextState);
  }

  public async submitFeedback(
    userId: string,
    input: AgentFeedbackInput
  ): Promise<AgentFeedbackRecord> {
    this.validateFeedbackInput(input);

    const userHash = this.hashUserId(userId);
    const record: AgentFeedbackRecord = {
      createdAt: new Date().toISOString(),
      id: randomUUID(),
      note: input.note?.trim() ? input.note.trim() : undefined,
      rating: input.rating,
      requestId: input.requestId.trim(),
      sessionId: input.sessionId.trim(),
      userHash
    };

    const existing = await this.readFeedback(userHash);
    const next = [record, ...existing].slice(0, FEEDBACK_STORAGE_LIMIT);
    await this.writeFeedback(userHash, next);

    await this.updateMetrics((state) => {
      if (record.rating === 'up') {
        state.feedback.up += 1;
      } else {
        state.feedback.down += 1;
      }
    });

    return record;
  }

  private createDefaultState(): PersistedMetricsState {
    return {
      errors: {},
      feedback: {
        down: 0,
        up: 0
      },
      latencySamples: {
        reasoning: [],
        tool: [],
        total: []
      },
      tokens: {
        input: 0,
        output: 0,
        requestsWithUsage: 0,
        total: 0
      },
      tools: {},
      totals: {
        error: 0,
        requests: 0,
        success: 0
      },
      updatedAt: new Date().toISOString()
    };
  }

  private hashUserId(userId: string): string {
    return createHash('sha256').update(userId).digest('hex').slice(0, 16);
  }

  private getFeedbackKey(userHash: string): string {
    return `agent:observability:v1:feedback:${userHash}`;
  }

  private getMetricsKey(): string {
    return 'agent:observability:v1:metrics';
  }

  private normalizeLimit(value?: number): number {
    if (!Number.isFinite(value)) {
      return SNAPSHOT_DEFAULT_LIMIT;
    }

    const rounded = Math.floor(value as number);
    if (rounded <= 0) {
      return SNAPSHOT_DEFAULT_LIMIT;
    }

    return Math.min(rounded, SNAPSHOT_MAX_LIMIT);
  }

  private percentile(values: number[], percentile: number): number {
    if (values.length === 0) {
      return 0;
    }

    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.min(
      sorted.length - 1,
      Math.floor(percentile * (sorted.length - 1))
    );

    return Math.round(sorted[index] * 100) / 100;
  }

  private pushLatencySample(samples: number[], value: number): void {
    const normalized = Number.isFinite(value) && value >= 0 ? value : 0;
    samples.push(Math.round(normalized * 100) / 100);

    while (samples.length > SAMPLE_WINDOW_SIZE) {
      samples.shift();
    }
  }

  private async readFeedback(userHash: string): Promise<AgentFeedbackRecord[]> {
    const key = this.getFeedbackKey(userHash);
    const fallback = this.feedbackFallback.get(key);

    if (!this.redisCacheService) {
      return fallback ? [...fallback] : [];
    }

    try {
      const payload = await this.redisCacheService.get(key);
      if (!payload) {
        return fallback ? [...fallback] : [];
      }

      const parsed = JSON.parse(payload) as AgentFeedbackRecord[];
      if (!Array.isArray(parsed)) {
        return fallback ? [...fallback] : [];
      }

      this.feedbackFallback.set(key, parsed);
      return [...parsed];
    } catch (error) {
      this.warn('feedback read failed', error);
      return fallback ? [...fallback] : [];
    }
  }

  private async readMetricsState(): Promise<PersistedMetricsState> {
    if (!this.redisCacheService) {
      return this.cloneState(this.fallbackMetricsState);
    }

    try {
      const payload = await this.redisCacheService.get(this.getMetricsKey());
      if (!payload) {
        return this.cloneState(this.fallbackMetricsState);
      }

      const parsed = JSON.parse(payload) as PersistedMetricsState;
      if (!parsed || typeof parsed !== 'object') {
        return this.cloneState(this.fallbackMetricsState);
      }

      const merged = this.normalizeState(parsed);
      this.fallbackMetricsState = merged;
      return this.cloneState(merged);
    } catch (error) {
      this.warn('metrics read failed', error);
      return this.cloneState(this.fallbackMetricsState);
    }
  }

  private async updateMetrics(
    mutator: (state: PersistedMetricsState) => void
  ): Promise<PersistedMetricsState> {
    const next = await this.readMetricsState();
    mutator(next);
    next.updatedAt = new Date().toISOString();
    await this.writeMetricsState(next);
    return next;
  }

  private validateFeedbackInput(input: AgentFeedbackInput): void {
    const rating = input.rating;
    if (rating !== 'up' && rating !== 'down') {
      throw new BadRequestException(
        'rating must be one of: up, down.'
      );
    }

    if (!input.requestId || !input.requestId.trim()) {
      throw new BadRequestException('request_id is required.');
    }

    if (!input.sessionId || !input.sessionId.trim()) {
      throw new BadRequestException('session_id is required.');
    }

    if (
      input.note &&
      input.note.length > FEEDBACK_NOTE_MAX_LENGTH
    ) {
      throw new BadRequestException(
        `note must be <= ${FEEDBACK_NOTE_MAX_LENGTH} characters.`
      );
    }
  }

  private async writeFeedback(
    userHash: string,
    records: AgentFeedbackRecord[]
  ): Promise<void> {
    const key = this.getFeedbackKey(userHash);
    this.feedbackFallback.set(key, [...records]);

    if (!this.redisCacheService) {
      return;
    }

    try {
      await this.redisCacheService.set(
        key,
        JSON.stringify(records),
        METRICS_STORAGE_TTL_MS
      );
    } catch (error) {
      this.warn('feedback write failed', error);
    }
  }

  private async writeMetricsState(state: PersistedMetricsState): Promise<void> {
    this.fallbackMetricsState = this.cloneState(state);

    if (!this.redisCacheService) {
      return;
    }

    try {
      await this.redisCacheService.set(
        this.getMetricsKey(),
        JSON.stringify(state),
        METRICS_STORAGE_TTL_MS
      );
    } catch (error) {
      this.warn('metrics write failed', error);
    }
  }

  private cloneState(state: PersistedMetricsState): PersistedMetricsState {
    return JSON.parse(JSON.stringify(state)) as PersistedMetricsState;
  }

  private normalizeState(
    input: PersistedMetricsState
  ): PersistedMetricsState {
    const fallback = this.createDefaultState();

    return {
      errors:
        input.errors && typeof input.errors === 'object'
          ? input.errors
          : fallback.errors,
      feedback: {
        down: Number(input.feedback?.down || 0),
        up: Number(input.feedback?.up || 0)
      },
      latencySamples: {
        reasoning: Array.isArray(input.latencySamples?.reasoning)
          ? input.latencySamples.reasoning.map((value) => Number(value) || 0)
          : [],
        tool: Array.isArray(input.latencySamples?.tool)
          ? input.latencySamples.tool.map((value) => Number(value) || 0)
          : [],
        total: Array.isArray(input.latencySamples?.total)
          ? input.latencySamples.total.map((value) => Number(value) || 0)
          : []
      },
      tokens: {
        input: Number(input.tokens?.input || 0),
        output: Number(input.tokens?.output || 0),
        requestsWithUsage: Number(input.tokens?.requestsWithUsage || 0),
        total: Number(input.tokens?.total || 0)
      },
      tools:
        input.tools && typeof input.tools === 'object'
          ? input.tools
          : fallback.tools,
      totals: {
        error: Number(input.totals?.error || 0),
        requests: Number(input.totals?.requests || 0),
        success: Number(input.totals?.success || 0)
      },
      updatedAt: input.updatedAt || fallback.updatedAt
    };
  }

  private toSnapshot(state: PersistedMetricsState): AgentMetricsSnapshot {
    const average = (values: number[]) => {
      if (values.length === 0) {
        return 0;
      }

      const total = values.reduce((sum, value) => sum + value, 0);
      return Math.round((total / values.length) * 100) / 100;
    };

    const feedbackTotal = state.feedback.up + state.feedback.down;

    return {
      errors: state.errors,
      feedback: {
        down: state.feedback.down,
        total: feedbackTotal,
        up: state.feedback.up
      },
      generatedAt: new Date().toISOString(),
      latencyMs: {
        avg: {
          reasoningMs: average(state.latencySamples.reasoning),
          toolMs: average(state.latencySamples.tool),
          totalMs: average(state.latencySamples.total)
        },
        p95: {
          reasoningMs: this.percentile(state.latencySamples.reasoning, 0.95),
          toolMs: this.percentile(state.latencySamples.tool, 0.95),
          totalMs: this.percentile(state.latencySamples.total, 0.95)
        }
      },
      tokens: {
        input: state.tokens.input,
        output: state.tokens.output,
        requestsWithUsage: state.tokens.requestsWithUsage,
        total: state.tokens.total
      },
      tools: state.tools,
      totals: state.totals
    };
  }

  private warn(message: string, error: unknown): void {
    const details = error instanceof Error ? error.message : String(error);
    console.warn(`[agent-observability] ${message}: ${details}`);
  }
}
