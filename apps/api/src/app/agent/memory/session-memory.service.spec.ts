import { SessionMemoryService } from './session-memory.service';

describe('SessionMemoryService', () => {
  let service: SessionMemoryService;

  beforeEach(() => {
    service = new SessionMemoryService();
  });

  // Happy path (3)
  it('should store and retrieve session state', () => {
    service.updateSession('s1', {
      lastSymbols: ['AAPL'],
      lastTool: 'market_data',
      lastTopic: null
    });
    const state = service.getSession('s1');
    expect(state).toBeDefined();
    expect(state!.lastSymbols).toEqual(['AAPL']);
    expect(state!.lastTool).toBe('market_data');
    expect(state!.turnCount).toBe(1);
  });

  it('should carry context across multiple updates (turnCount grows)', () => {
    service.updateSession('s1', {
      lastSymbols: ['AAPL'],
      lastTool: 'market_data',
      lastTopic: null
    });
    service.updateSession('s1', {
      lastSymbols: ['MSFT'],
      lastTool: 'market_data',
      lastTopic: null
    });
    const state = service.getSession('s1');
    expect(state!.turnCount).toBe(2);
    expect(state!.lastSymbols).toEqual(['MSFT']);
  });

  it('should handle tool switching within same session', () => {
    service.updateSession('s1', {
      lastSymbols: ['AAPL'],
      lastTool: 'market_data',
      lastTopic: null
    });
    service.updateSession('s1', {
      lastSymbols: [],
      lastTool: 'compliance',
      lastTopic: 'esg'
    });
    const state = service.getSession('s1');
    expect(state!.lastTool).toBe('compliance');
    expect(state!.lastTopic).toBe('esg');
  });

  // Edge cases (3)
  it('should keep independent sessions completely separate', () => {
    service.updateSession('s1', {
      lastSymbols: ['AAPL'],
      lastTool: 'market_data',
      lastTopic: null
    });
    service.updateSession('s2', {
      lastSymbols: ['TSLA'],
      lastTool: 'portfolio',
      lastTopic: null
    });
    expect(service.getSession('s1')!.lastSymbols).toEqual(['AAPL']);
    expect(service.getSession('s2')!.lastSymbols).toEqual(['TSLA']);
  });

  it('should handle session_id with special characters (Unicode, slashes)', () => {
    const id = 'session/caf\u00e9-\u65e5\u672c\u8a9e/123';
    service.updateSession(id, {
      lastSymbols: ['AAPL'],
      lastTool: 'market_data',
      lastTopic: null
    });
    expect(service.getSession(id)).toBeDefined();
    expect(service.getSession(id)!.lastSymbols).toEqual(['AAPL']);
  });

  it('should handle rapid sequential updates to same session', () => {
    for (let i = 0; i < 20; i++) {
      service.updateSession('s1', {
        lastSymbols: [`SYM${i}`],
        lastTool: 'market_data',
        lastTopic: null
      });
    }
    const state = service.getSession('s1');
    expect(state!.turnCount).toBe(20);
    expect(state!.lastSymbols).toEqual(['SYM19']);
  });

  // Error/failure modes (2)
  it('should return undefined for non-existent session (not throw)', () => {
    expect(service.getSession('nonexistent')).toBeUndefined();
  });

  it('should handle updateSession with empty symbols array (no-op on symbols)', () => {
    service.updateSession('s1', {
      lastSymbols: ['AAPL'],
      lastTool: 'market_data',
      lastTopic: null
    });
    service.updateSession('s1', {
      lastSymbols: [],
      lastTool: 'market_data',
      lastTopic: null
    });
    const state = service.getSession('s1');
    expect(state!.lastSymbols).toEqual([]);
    expect(state!.turnCount).toBe(2);
  });

  // Boundary conditions (2)
  it('should evict oldest session when LRU limit is reached', () => {
    const small = new SessionMemoryService(5);
    for (let i = 0; i < 6; i++) {
      small.updateSession(`s${i}`, {
        lastSymbols: [],
        lastTool: null,
        lastTopic: null
      });
    }
    expect(small.getSession('s0')).toBeUndefined();
    expect(small.getSession('s5')).toBeDefined();
  });

  it('should handle very long conversation (50+ turns) without crash', () => {
    for (let i = 0; i < 60; i++) {
      service.updateSession('long', {
        lastSymbols: ['AAPL'],
        lastTool: 'market_data',
        lastTopic: null
      });
    }
    expect(service.getSession('long')!.turnCount).toBe(60);
  });
});
