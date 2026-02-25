import { marketDataFetch, MarketDataOutput } from './market-data.tool';

const mockFetch = jest.fn();
global.fetch = mockFetch;
const originalPrimaryRetryAttempts = process.env.AGENT_MARKET_PRIMARY_RETRY_ATTEMPTS;
const originalPrimaryRetryBackoffMs =
  process.env.AGENT_MARKET_PRIMARY_RETRY_BACKOFF_MS;

function makeChartResponse(meta: Record<string, unknown>) {
  return {
    ok: true,
    json: async () => ({ chart: { result: [{ meta }] } })
  };
}

function makeStooqResponse(close: string) {
  return {
    ok: true,
    text: async () =>
      `Symbol,Date,Time,Open,High,Low,Close,Volume\nAAPL.US,2026-02-24,22:00:19,100,102,99,${close},100000`
  };
}

describe('marketDataFetch', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    process.env.AGENT_MARKET_PRIMARY_RETRY_ATTEMPTS = '2';
    process.env.AGENT_MARKET_PRIMARY_RETRY_BACKOFF_MS = '1';
  });

  afterAll(() => {
    if (originalPrimaryRetryAttempts === undefined) {
      delete process.env.AGENT_MARKET_PRIMARY_RETRY_ATTEMPTS;
    } else {
      process.env.AGENT_MARKET_PRIMARY_RETRY_ATTEMPTS =
        originalPrimaryRetryAttempts;
    }

    if (originalPrimaryRetryBackoffMs === undefined) {
      delete process.env.AGENT_MARKET_PRIMARY_RETRY_BACKOFF_MS;
    } else {
      process.env.AGENT_MARKET_PRIMARY_RETRY_BACKOFF_MS =
        originalPrimaryRetryBackoffMs;
    }
  });

  // === Happy path (3) ===

  it('should return price > 0 for valid symbol (AAPL)', async () => {
    mockFetch.mockResolvedValue(
      makeChartResponse({
        symbol: 'AAPL',
        shortName: 'Apple Inc.',
        regularMarketPrice: 195.23,
        fiftyTwoWeekHigh: 200.0,
        fiftyTwoWeekLow: 140.0
      })
    );

    const result = await marketDataFetch({ symbols: ['AAPL'] });

    expect(result).toHaveProperty('AAPL');
    const data: MarketDataOutput = result['AAPL'];
    expect(data.price).toBeDefined();
    expect(data.price).toBeGreaterThan(0);
    expect(data.name).toBe('Apple Inc.');
    expect(data.error).toBeUndefined();
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('AAPL'),
      expect.objectContaining({ headers: expect.any(Object) })
    );
  });

  it('should return error info for invalid symbol (XYZNOTREAL)', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ chart: { result: null } })
    });

    const result = await marketDataFetch({ symbols: ['XYZNOTREAL'] });

    expect(result).toHaveProperty('XYZNOTREAL');
    const data: MarketDataOutput = result['XYZNOTREAL'];
    expect(data.error).toBeDefined();
    expect(data.error).toContain('XYZNOTREAL');
  });

  it('should return data for multiple symbols (MSFT, GOOGL)', async () => {
    mockFetch
      .mockResolvedValueOnce(
        makeChartResponse({
          symbol: 'MSFT',
          shortName: 'Microsoft Corporation',
          regularMarketPrice: 420.5,
          fiftyTwoWeekHigh: 450.0,
          fiftyTwoWeekLow: 300.0
        })
      )
      .mockResolvedValueOnce(
        makeChartResponse({
          symbol: 'GOOGL',
          shortName: 'Alphabet Inc.',
          regularMarketPrice: 175.3,
          fiftyTwoWeekHigh: 200.0,
          fiftyTwoWeekLow: 120.0
        })
      );

    const result = await marketDataFetch({ symbols: ['MSFT', 'GOOGL'] });

    expect(result).toHaveProperty('MSFT');
    expect(result).toHaveProperty('GOOGL');
    expect(result['MSFT'].price).toBeGreaterThan(0);
    expect(result['GOOGL'].price).toBeGreaterThan(0);
  });

  // === Edge cases (3) ===

  it('should handle empty symbols array', async () => {
    const result = await marketDataFetch({ symbols: [] });

    expect(Object.keys(result)).toHaveLength(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should trim and uppercase symbols', async () => {
    mockFetch.mockResolvedValue(
      makeChartResponse({
        symbol: 'AAPL',
        shortName: 'Apple Inc.',
        regularMarketPrice: 195.0,
        fiftyTwoWeekHigh: 200.0,
        fiftyTwoWeekLow: 140.0
      })
    );

    const result = await marketDataFetch({ symbols: ['  aapl  '] });

    expect(result).toHaveProperty('AAPL');
    expect(result['AAPL'].price).toBe(195.0);
  });

  it('should handle symbol with dot (BRK.A)', async () => {
    mockFetch.mockResolvedValue(
      makeChartResponse({
        symbol: 'BRK.A',
        shortName: 'Berkshire Hathaway Inc.',
        regularMarketPrice: 627000.0,
        fiftyTwoWeekHigh: 700000.0,
        fiftyTwoWeekLow: 500000.0
      })
    );

    const result = await marketDataFetch({ symbols: ['BRK.A'] });

    // Use ['BRK.A'] instead of toHaveProperty — Jest treats dots as nested paths
    expect(result['BRK.A']).toBeDefined();
    expect(result['BRK.A'].price).toBe(627000.0);
    expect(result['BRK.A'].name).toBe('Berkshire Hathaway Inc.');
  });

  // === Error/failure modes (2) ===

  it('should handle network timeout (fetch rejects)', async () => {
    mockFetch.mockRejectedValue(new Error('network timeout'));

    const result = await marketDataFetch({ symbols: ['AAPL'] });

    expect(result).toHaveProperty('AAPL');
    expect(result['AAPL'].error).toBeDefined();
    expect(result['AAPL'].error).toMatch(/fetch error|failed to fetch/i);
    expect(result['AAPL'].price).toBeUndefined();
  });

  it('should abort fetch after timeout (AbortError)', async () => {
    const abortError = new DOMException('The operation was aborted', 'AbortError');
    mockFetch.mockRejectedValue(abortError);

    const result = await marketDataFetch({ symbols: ['AAPL'] });

    expect(result).toHaveProperty('AAPL');
    expect(result['AAPL'].error).toBeDefined();
    expect(result['AAPL'].error).toMatch(/fetch error|failed to fetch/i);
    expect(result['AAPL'].price).toBeUndefined();
  });

  it('should handle HTTP 429 rate limit response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({})
    });

    const result = await marketDataFetch({ symbols: ['TSLA'] });

    expect(result).toHaveProperty('TSLA');
    expect(result['TSLA'].error).toBeDefined();
    expect(result['TSLA'].error).toContain('429');
  });

  it('should retry query2 and succeed on a later attempt', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        json: async () => ({})
      })
      .mockResolvedValueOnce(
        makeChartResponse({
          symbol: 'TSLA',
          shortName: 'Tesla, Inc.',
          regularMarketPrice: 205.5
        })
      )
      .mockResolvedValueOnce(makeStooqResponse('206'));

    const result = await marketDataFetch({ symbols: ['TSLA'] });

    expect(result['TSLA'].price).toBe(205.5);
    expect(result['TSLA'].error).toBeUndefined();
  });

  it('should fallback from query2 to query1 when query2 repeatedly fails', async () => {
    mockFetch
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockResolvedValueOnce(
        makeChartResponse({
          symbol: 'AAPL',
          shortName: 'Apple Inc.',
          regularMarketPrice: 196.75,
          fiftyTwoWeekHigh: 200.0,
          fiftyTwoWeekLow: 140.0
        })
      )
      .mockResolvedValueOnce(makeStooqResponse('197'));

    const result = await marketDataFetch({ symbols: ['AAPL'] });

    expect(result['AAPL'].price).toBe(196.75);
    expect(
      mockFetch.mock.calls.some(([url]) =>
        String(url).includes('query1.finance.yahoo.com')
      )
    ).toBe(true);
  });

  it('should include low-level fetch cause details in the primary error', async () => {
    process.env.AGENT_MARKET_PRIMARY_RETRY_ATTEMPTS = '1';

    const networkError = Object.assign(new Error('fetch failed'), {
      cause: {
        address: '10.0.0.1',
        code: 'ETIMEDOUT',
        errno: 'ETIMEDOUT',
        port: 443,
        syscall: 'connect'
      }
    });

    mockFetch
      .mockRejectedValueOnce(networkError)
      .mockRejectedValueOnce(networkError)
      .mockResolvedValueOnce(makeStooqResponse('101'));

    const result = await marketDataFetch({ symbols: ['AAPL'] });

    expect(result['AAPL'].error).toContain('code=ETIMEDOUT');
    expect(result['AAPL'].error).toContain('syscall=connect');
  });

  // === Boundary conditions (2) ===

  it('should handle malformed API response (missing meta fields)', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ chart: { result: [{ meta: {} }] } })
    });

    const result = await marketDataFetch({ symbols: ['AAPL'] });

    expect(result).toHaveProperty('AAPL');
    // Should not crash — price will be undefined but no error thrown
    expect(result['AAPL'].error).toBeUndefined();
    expect(result['AAPL'].price).toBeUndefined();
  });

  it('should handle HTTP 500 server error response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({})
    });

    const result = await marketDataFetch({ symbols: ['AAPL'] });

    expect(result).toHaveProperty('AAPL');
    expect(result['AAPL'].error).toBeDefined();
    expect(result['AAPL'].error).toContain('500');
  });

  // === Verification system expansion (US-009) ===

  it('should mark cross-source verification as pass when discrepancy is below threshold', async () => {
    mockFetch
      .mockResolvedValueOnce(
        makeChartResponse({
          symbol: 'AAPL',
          shortName: 'Apple Inc.',
          regularMarketPrice: 100
        })
      )
      .mockResolvedValueOnce(makeStooqResponse('102'));

    const result = await marketDataFetch({ symbols: ['AAPL'] });

    expect(result['AAPL'].verification).toBeDefined();
    expect(result['AAPL'].verification?.checks.crossSourcePrice.passed).toBe(
      true
    );
    expect(result['AAPL'].verification?.status).toBe('pass');
    expect(result['AAPL'].verification?.confidenceLevel).toBe('high');
  });

  it('should mark discrepancy warning and downgrade confidence when backup price diverges above threshold', async () => {
    mockFetch
      .mockResolvedValueOnce(
        makeChartResponse({
          symbol: 'AAPL',
          shortName: 'Apple Inc.',
          regularMarketPrice: 100
        })
      )
      .mockResolvedValueOnce(makeStooqResponse('150'));

    const result = await marketDataFetch({ symbols: ['AAPL'] });

    expect(result['AAPL'].verification?.checks.crossSourcePrice.passed).toBe(
      false
    );
    expect(result['AAPL'].verification?.status).toBe('warning');
    expect(result['AAPL'].verification?.confidenceLevel).toBe('low');
  });

  it('should mark backup-unavailable warning, keep source timestamps, and map confidence to medium', async () => {
    mockFetch
      .mockResolvedValueOnce(
        makeChartResponse({
          symbol: 'AAPL',
          shortName: 'Apple Inc.',
          regularMarketPrice: 100
        })
      )
      .mockResolvedValueOnce(makeStooqResponse('N/D'));

    const result = await marketDataFetch({ symbols: ['AAPL'] });

    expect(result['AAPL'].verification?.checks.crossSourcePrice.passed).toBe(
      false
    );
    expect(result['AAPL'].verification?.status).toBe('warning');
    expect(result['AAPL'].verification?.confidenceLevel).toBe('medium');
    expect(result['AAPL'].sourceAttribution?.primary.timestamp).toBeDefined();
    expect(result['AAPL'].sourceAttribution?.backup?.timestamp).toBeDefined();
  });

  it('should describe primary-unavailable when backup exists but primary fetch fails', async () => {
    process.env.AGENT_MARKET_PRIMARY_RETRY_ATTEMPTS = '1';

    mockFetch
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockResolvedValueOnce(makeStooqResponse('102'));

    const result = await marketDataFetch({ symbols: ['AAPL'] });

    expect(result['AAPL'].verification?.checks.crossSourcePrice.reason).toBe(
      'Primary source price unavailable.'
    );
    expect(
      result['AAPL'].verification?.checks.crossSourcePrice.details.backupPrice
    ).toBe(102);
  });
});
