import { marketDataFetch, MarketDataOutput } from './market-data.tool';

const mockFetch = jest.fn();
global.fetch = mockFetch;

function makeChartResponse(meta: Record<string, unknown>) {
  return {
    ok: true,
    json: async () => ({ chart: { result: [{ meta }] } })
  };
}

describe('marketDataFetch', () => {
  beforeEach(() => {
    mockFetch.mockReset();
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
    expect(result['AAPL'].error).toMatch(/failed to fetch/i);
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
});
