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
});
