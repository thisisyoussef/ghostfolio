import { Injectable } from '@nestjs/common';

export interface SessionState {
  lastSymbols: string[];
  lastTool: string | null;
  lastTopic: string | null;
  turnCount: number;
  createdAt: number;
  lastAccessedAt: number;
}

export interface SessionUpdate {
  lastSymbols: string[];
  lastTool: string | null;
  lastTopic: string | null;
}

const DEFAULT_MAX_SESSIONS = 1000;

@Injectable()
export class SessionMemoryService {
  private sessions = new Map<string, SessionState>();
  private readonly maxSessions: number;

  constructor(maxSessions: number = DEFAULT_MAX_SESSIONS) {
    this.maxSessions = maxSessions;
  }

  getSession(sessionId: string): SessionState | undefined {
    const state = this.sessions.get(sessionId);
    if (state) {
      state.lastAccessedAt = Date.now();
    }
    return state;
  }

  updateSession(sessionId: string, update: SessionUpdate): void {
    const existing = this.sessions.get(sessionId);
    const now = Date.now();

    if (existing) {
      existing.lastSymbols = update.lastSymbols;
      existing.lastTool = update.lastTool;
      existing.lastTopic = update.lastTopic;
      existing.turnCount += 1;
      existing.lastAccessedAt = now;
    } else {
      this.evictIfNeeded();
      this.sessions.set(sessionId, {
        lastSymbols: update.lastSymbols,
        lastTool: update.lastTool,
        lastTopic: update.lastTopic,
        turnCount: 1,
        createdAt: now,
        lastAccessedAt: now
      });
    }
  }

  private evictIfNeeded(): void {
    if (this.sessions.size < this.maxSessions) {
      return;
    }
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    for (const [key, state] of this.sessions) {
      if (state.lastAccessedAt < oldestTime) {
        oldestTime = state.lastAccessedAt;
        oldestKey = key;
      }
    }
    if (oldestKey) {
      this.sessions.delete(oldestKey);
    }
  }
}
