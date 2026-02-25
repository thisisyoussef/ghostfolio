import { ConfigurationService } from '@ghostfolio/api/services/configuration/configuration.service';

import { Inject, Injectable, Optional } from '@nestjs/common';

import { type ToolCallInfo } from '../agent.types';

export type SessionRole = 'assistant' | 'system' | 'tool' | 'user';

export interface SessionMessage {
  role: SessionRole;
  content: string;
  createdAt: number;
  toolArgs?: Record<string, unknown>;
  toolName?: string;
  toolResultSummary?: string;
}

export interface SessionRecord {
  sessionId: string;
  userId: string;
  messages: SessionMessage[];
  summary: string;
  turnCount: number;
  createdAt: number;
  updatedAt: number;
}

interface FallbackEntry {
  expiresAt: number;
  record: SessionRecord;
}

interface RedisCacheLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttl?: number): Promise<void>;
}

export const AGENT_REDIS_CACHE_SERVICE = 'AGENT_REDIS_CACHE_SERVICE';

const DEFAULT_MEMORY_TTL_SECONDS = 604_800;
const DEFAULT_MAX_MESSAGES = 40;
const DEFAULT_RECENT_MESSAGES = 12;
const DEFAULT_MAX_FALLBACK_SESSIONS = 1000;
const SUMMARY_CHAR_LIMIT = 12_000;

@Injectable()
export class SessionMemoryService {
  private readonly fallbackSessions = new Map<string, FallbackEntry>();
  private readonly memoryTtlMs: number;
  private readonly maxFallbackSessions: number;
  private readonly maxMessages: number;
  private readonly recentMessages: number;

  public constructor(
    @Optional()
    @Inject(AGENT_REDIS_CACHE_SERVICE)
    private readonly redisCacheService?: RedisCacheLike,
    @Optional() private readonly configurationService?: ConfigurationService
  ) {
    this.memoryTtlMs =
      this.readConfigNumber('AGENT_MEMORY_TTL_SECONDS', DEFAULT_MEMORY_TTL_SECONDS) *
      1000;
    this.maxMessages = this.readConfigNumber(
      'AGENT_MEMORY_MAX_MESSAGES',
      DEFAULT_MAX_MESSAGES
    );
    this.recentMessages = this.readConfigNumber(
      'AGENT_MEMORY_RECENT_MESSAGES',
      DEFAULT_RECENT_MESSAGES
    );
    this.maxFallbackSessions = DEFAULT_MAX_FALLBACK_SESSIONS;
  }

  public async addTurn(args: {
    assistantMessage: string;
    sessionId: string;
    toolCalls: ToolCallInfo[];
    userId: string;
    userMessage: string;
  }): Promise<SessionRecord> {
    const { assistantMessage, sessionId, toolCalls, userId, userMessage } = args;

    const now = Date.now();
    const messages: SessionMessage[] = [
      {
        content: userMessage,
        createdAt: now,
        role: 'user'
      },
      ...toolCalls.map((toolCall) => ({
        content: toolCall.result,
        createdAt: now,
        role: 'tool' as const,
        toolArgs: toolCall.args,
        toolName: toolCall.name,
        toolResultSummary: this.summarizeToolResult(toolCall.result)
      })),
      {
        content: assistantMessage,
        createdAt: now,
        role: 'assistant'
      }
    ];

    return this.appendMessages(userId, sessionId, messages);
  }

  public async appendMessages(
    userId: string,
    sessionId: string,
    messages: SessionMessage[]
  ): Promise<SessionRecord> {
    const existing = await this.getSessionRecord(userId, sessionId);
    const now = Date.now();

    const record: SessionRecord = existing
      ? {
          ...existing,
          messages: [...existing.messages],
          updatedAt: now
        }
      : {
          createdAt: now,
          messages: [],
          sessionId,
          summary: '',
          turnCount: 0,
          updatedAt: now,
          userId
        };

    for (const message of messages) {
      record.messages.push({
        ...message,
        createdAt: message.createdAt ?? now
      });

      if (message.role === 'user') {
        record.turnCount += 1;
      }
    }

    const compacted = this.compactRecord(record);
    await this.persistRecord(compacted);

    return compacted;
  }

  public async getConversationContext(
    userId: string,
    sessionId: string
  ): Promise<{
    recentMessages: SessionMessage[];
    summary: string;
    turnCount: number;
  }> {
    const record = await this.getSessionRecord(userId, sessionId);

    if (!record) {
      return {
        recentMessages: [],
        summary: '',
        turnCount: 0
      };
    }

    return {
      recentMessages: record.messages.slice(-this.recentMessages),
      summary: record.summary,
      turnCount: record.turnCount
    };
  }

  public async getLatestMarketContext(
    userId: string,
    sessionId: string
  ): Promise<{
    hasHistory: boolean;
    lastSymbols: string[];
    lastTool: string | null;
  }> {
    const record = await this.getSessionRecord(userId, sessionId);

    if (!record) {
      return { hasHistory: false, lastSymbols: [], lastTool: null };
    }

    let lastTool: string | null = null;

    for (let index = record.messages.length - 1; index >= 0; index -= 1) {
      const message = record.messages[index];

      if (message.role !== 'tool') {
        continue;
      }

      if (!lastTool && message.toolName) {
        lastTool = message.toolName;
      }

      if (message.toolName !== 'market_data_fetch') {
        continue;
      }

      const rawSymbols = message.toolArgs?.symbols;

      if (!Array.isArray(rawSymbols)) {
        continue;
      }

      const symbols = rawSymbols
        .map((symbol) => String(symbol).trim().toUpperCase())
        .filter(Boolean);

      if (symbols.length > 0) {
        return {
          hasHistory: true,
          lastSymbols: symbols,
          lastTool
        };
      }
    }

    return {
      hasHistory: true,
      lastSymbols: [],
      lastTool
    };
  }

  public async getSessionRecord(
    userId: string,
    sessionId: string
  ): Promise<SessionRecord | undefined> {
    const key = this.getSessionKey(userId, sessionId);

    const redisRecord = await this.getFromRedis(key);
    if (redisRecord) {
      this.setFallbackRecord(key, redisRecord);
      return redisRecord;
    }

    return this.getFallbackRecord(key);
  }

  private compactRecord(record: SessionRecord): SessionRecord {
    if (record.messages.length <= this.maxMessages) {
      return record;
    }

    const keepCount = Math.max(
      1,
      Math.min(this.maxMessages, this.recentMessages)
    );

    const splitIndex = record.messages.length - keepCount;
    const toSummarize = record.messages.slice(0, splitIndex);
    const toKeep = record.messages.slice(splitIndex);

    const summaryLines = toSummarize.map((message) => {
      return this.toSummaryLine(message);
    });

    const mergedSummary = [record.summary, ...summaryLines]
      .filter(Boolean)
      .join('\n');

    return {
      ...record,
      messages: toKeep,
      summary: mergedSummary.slice(-SUMMARY_CHAR_LIMIT)
    };
  }

  private async getFromRedis(key: string): Promise<SessionRecord | undefined> {
    if (!this.redisCacheService) {
      return undefined;
    }

    try {
      const payload = await this.redisCacheService.get(key);

      if (!payload) {
        return undefined;
      }

      const parsed =
        typeof payload === 'string' ? JSON.parse(payload) : (payload as any);

      return this.normalizeRecord(parsed);
    } catch (error) {
      this.warn(`read failed for ${key}`, error);
      return undefined;
    }
  }

  private getFallbackRecord(key: string): SessionRecord | undefined {
    const entry = this.fallbackSessions.get(key);

    if (!entry) {
      return undefined;
    }

    if (entry.expiresAt <= Date.now()) {
      this.fallbackSessions.delete(key);
      return undefined;
    }

    // Touch entry for LRU behavior.
    this.fallbackSessions.delete(key);
    this.fallbackSessions.set(key, entry);

    return {
      ...entry.record,
      messages: [...entry.record.messages]
    };
  }

  private getSessionKey(userId: string, sessionId: string): string {
    return `agent:session:v2:${userId}:${sessionId}`;
  }

  private normalizeRecord(raw: any): SessionRecord {
    const now = Date.now();

    return {
      createdAt: Number(raw?.createdAt) || now,
      messages: Array.isArray(raw?.messages)
        ? raw.messages
            .filter((message: any) => {
              return message && typeof message.content === 'string';
            })
            .map((message: any) => ({
              content: String(message.content),
              createdAt: Number(message.createdAt) || now,
              role: this.normalizeRole(message.role),
              ...(message.toolArgs ? { toolArgs: message.toolArgs } : {}),
              ...(message.toolName
                ? { toolName: String(message.toolName) }
                : {}),
              ...(message.toolResultSummary
                ? { toolResultSummary: String(message.toolResultSummary) }
                : {})
            }))
        : [],
      sessionId: String(raw?.sessionId || ''),
      summary: typeof raw?.summary === 'string' ? raw.summary : '',
      turnCount: Number(raw?.turnCount) || 0,
      updatedAt: Number(raw?.updatedAt) || now,
      userId: String(raw?.userId || '')
    };
  }

  private normalizeRole(value: unknown): SessionRole {
    const role = String(value || 'user') as SessionRole;

    if (
      role === 'assistant' ||
      role === 'system' ||
      role === 'tool' ||
      role === 'user'
    ) {
      return role;
    }

    return 'user';
  }

  private async persistRecord(record: SessionRecord): Promise<void> {
    const key = this.getSessionKey(record.userId, record.sessionId);
    const serialized = JSON.stringify(record);

    if (this.redisCacheService) {
      try {
        await this.redisCacheService.set(key, serialized, this.memoryTtlMs);
      } catch (error) {
        this.warn(`write failed for ${key}`, error);
      }
    }

    this.setFallbackRecord(key, record);
  }

  private readConfigNumber(
    key:
      | 'AGENT_MEMORY_MAX_MESSAGES'
      | 'AGENT_MEMORY_RECENT_MESSAGES'
      | 'AGENT_MEMORY_TTL_SECONDS',
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

  private setFallbackRecord(key: string, record: SessionRecord): void {
    if (this.fallbackSessions.has(key)) {
      this.fallbackSessions.delete(key);
    }

    this.fallbackSessions.set(key, {
      expiresAt: Date.now() + this.memoryTtlMs,
      record
    });

    while (this.fallbackSessions.size > this.maxFallbackSessions) {
      const oldestKey = this.fallbackSessions.keys().next().value;
      if (!oldestKey) {
        break;
      }
      this.fallbackSessions.delete(oldestKey);
    }
  }

  private summarizeToolResult(result: string): string {
    try {
      const parsed = JSON.parse(result);

      if (Array.isArray(parsed)) {
        return `Array result (${parsed.length} items)`;
      }

      if (parsed && typeof parsed === 'object') {
        const keys = Object.keys(parsed as object).slice(0, 5);
        return `Object result with keys: ${keys.join(', ')}`;
      }
    } catch {
      // no-op
    }

    return result.slice(0, 160);
  }

  private toSummaryLine(message: SessionMessage): string {
    const content = message.content.replace(/\s+/g, ' ').trim().slice(0, 180);

    if (message.role === 'tool') {
      const toolName = message.toolName || 'unknown_tool';
      const summary = message.toolResultSummary || content;
      return `[TOOL:${toolName}] ${summary}`;
    }

    return `[${message.role.toUpperCase()}] ${content}`;
  }

  private warn(message: string, error: unknown): void {
    const details = error instanceof Error ? error.message : String(error);
    console.warn(`[agent-memory] ${message}: ${details}`);
  }
}
