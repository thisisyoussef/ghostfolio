import {
  SessionMemoryService,
  type SessionMessage
} from './session-memory.service';

class FakeRedisCacheService {
  public failRead = false;
  public failWrite = false;
  public readonly store = new Map<string, string>();

  public async get(key: string): Promise<string | null> {
    if (this.failRead) {
      throw new Error('redis read failed');
    }

    return this.store.get(key) || null;
  }

  public async set(
    key: string,
    value: string,
    _ttl?: number
  ): Promise<void> {
    if (this.failWrite) {
      throw new Error('redis write failed');
    }

    this.store.set(key, value);
  }
}

describe('SessionMemoryService', () => {
  const USER_ID = 'user-1';
  const SESSION_ID = 'session-1';

  afterEach(() => {
    delete process.env.AGENT_MEMORY_MAX_MESSAGES;
    delete process.env.AGENT_MEMORY_RECENT_MESSAGES;
    delete process.env.AGENT_MEMORY_TTL_SECONDS;
    jest.restoreAllMocks();
  });

  it('should append and retrieve full session message history', async () => {
    const service = new SessionMemoryService();

    await service.appendMessages(USER_ID, SESSION_ID, [
      {
        content: 'Price of AAPL',
        createdAt: Date.now(),
        role: 'user'
      },
      {
        content: 'AAPL: $190.00',
        createdAt: Date.now(),
        role: 'assistant'
      }
    ]);

    const record = await service.getSessionRecord(USER_ID, SESSION_ID);

    expect(record).toBeDefined();
    expect(record?.messages).toHaveLength(2);
    expect(record?.messages[0].role).toBe('user');
    expect(record?.messages[1].role).toBe('assistant');
  });

  it('should support 5+ turn recall for same session', async () => {
    const service = new SessionMemoryService();

    for (let i = 1; i <= 6; i += 1) {
      await service.appendMessages(USER_ID, SESSION_ID, [
        {
          content: `Question ${i}`,
          createdAt: Date.now(),
          role: 'user'
        },
        {
          content: `Answer ${i}`,
          createdAt: Date.now(),
          role: 'assistant'
        }
      ]);
    }

    const context = await service.getConversationContext(USER_ID, SESSION_ID);

    expect(context.turnCount).toBe(6);
    expect(context.recentMessages.length).toBeGreaterThanOrEqual(6);
    expect(context.recentMessages[0].content).toContain('Question');
  });

  it('should compact history into summary when max message threshold is exceeded', async () => {
    process.env.AGENT_MEMORY_MAX_MESSAGES = '4';
    process.env.AGENT_MEMORY_RECENT_MESSAGES = '2';

    const service = new SessionMemoryService();

    const history: SessionMessage[] = [];
    for (let i = 1; i <= 8; i += 1) {
      history.push({
        content: `message-${i}`,
        createdAt: Date.now(),
        role: i % 2 === 0 ? 'assistant' : 'user'
      });
    }

    await service.appendMessages(USER_ID, SESSION_ID, history);

    const record = await service.getSessionRecord(USER_ID, SESSION_ID);

    expect(record).toBeDefined();
    expect(record?.messages.length).toBeLessThanOrEqual(2);
    expect(record?.summary).toContain('message-1');
    expect(record?.summary).toContain('message-6');
  });

  it('should return latest market symbols context from stored tool messages', async () => {
    const service = new SessionMemoryService();

    await service.appendMessages(USER_ID, SESSION_ID, [
      {
        content: '{"AAPL":{"price":190}}',
        createdAt: Date.now(),
        role: 'tool',
        toolArgs: { symbols: ['AAPL'] },
        toolName: 'market_data_fetch',
        toolResultSummary: 'AAPL market data'
      },
      {
        content: 'AAPL is trading at $190',
        createdAt: Date.now(),
        role: 'assistant'
      }
    ]);

    const context = await service.getLatestMarketContext(USER_ID, SESSION_ID);

    expect(context.lastSymbols).toEqual(['AAPL']);
    expect(context.lastTool).toBe('market_data_fetch');
  });

  it('should fallback to in-process memory when redis read/write fails', async () => {
    const fakeRedis = new FakeRedisCacheService();
    fakeRedis.failRead = true;
    fakeRedis.failWrite = true;

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {
      // no-op
    });

    const service = new SessionMemoryService(fakeRedis as any);

    await service.appendMessages(USER_ID, SESSION_ID, [
      {
        content: 'test',
        createdAt: Date.now(),
        role: 'user'
      }
    ]);

    const record = await service.getSessionRecord(USER_ID, SESSION_ID);

    expect(record).toBeDefined();
    expect(record?.messages).toHaveLength(1);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('should expire fallback memory entries based on TTL', async () => {
    process.env.AGENT_MEMORY_TTL_SECONDS = '1';

    const nowSpy = jest.spyOn(Date, 'now');
    nowSpy.mockReturnValue(1_000);

    const service = new SessionMemoryService();

    await service.appendMessages(USER_ID, SESSION_ID, [
      {
        content: 'short-lived message',
        createdAt: Date.now(),
        role: 'user'
      }
    ]);

    nowSpy.mockReturnValue(2_500);

    const record = await service.getSessionRecord(USER_ID, SESSION_ID);

    expect(record).toBeUndefined();
  });
});
