jest.mock('yahoo-finance2', () => {
  const mockQuote = jest.fn();
  function MockYahooFinance() {
    return { quote: mockQuote };
  }
  return { default: MockYahooFinance, __mockQuote: mockQuote };
});

import { marketDataFetch, MarketDataOutput } from './market-data.tool';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { __mockQuote } = require('yahoo-finance2');

describe('marketDataFetch', () => {
  beforeEach(() => {
    __mockQuote.mockReset();
  });

  it('should return price > 0 for valid symbol (AAPL)', async () => {
    __mockQuote.mockResolvedValue({
      shortName: 'Apple Inc.',
      regularMarketPrice: 195.23,
      trailingPE: 30.5,
      dividendYield: 0.005,
      marketCap: 3000000000000,
      fiftyTwoWeekHigh: 200.0,
      fiftyTwoWeekLow: 140.0
    });

    const result = await marketDataFetch({ symbols: ['AAPL'] });

    expect(result).toHaveProperty('AAPL');
    const data: MarketDataOutput = result['AAPL'];
    expect(data.price).toBeDefined();
    expect(data.price).toBeGreaterThan(0);
    expect(data.name).toBe('Apple Inc.');
    expect(data.error).toBeUndefined();
  });

  it('should return error info for invalid symbol (XYZNOTREAL)', async () => {
    __mockQuote.mockResolvedValue(undefined);

    const result = await marketDataFetch({ symbols: ['XYZNOTREAL'] });

    expect(result).toHaveProperty('XYZNOTREAL');
    const data: MarketDataOutput = result['XYZNOTREAL'];
    expect(data.error).toBeDefined();
    expect(data.error).toContain('XYZNOTREAL');
  });

  it('should return data for multiple symbols (MSFT, GOOGL)', async () => {
    __mockQuote
      .mockResolvedValueOnce({
        shortName: 'Microsoft Corporation',
        regularMarketPrice: 420.5,
        fiftyTwoWeekHigh: 450.0,
        fiftyTwoWeekLow: 300.0
      })
      .mockResolvedValueOnce({
        shortName: 'Alphabet Inc.',
        regularMarketPrice: 175.3,
        fiftyTwoWeekHigh: 200.0,
        fiftyTwoWeekLow: 120.0
      });

    const result = await marketDataFetch({ symbols: ['MSFT', 'GOOGL'] });

    expect(result).toHaveProperty('MSFT');
    expect(result).toHaveProperty('GOOGL');
    expect(result['MSFT'].price).toBeGreaterThan(0);
    expect(result['GOOGL'].price).toBeGreaterThan(0);
  });
});
