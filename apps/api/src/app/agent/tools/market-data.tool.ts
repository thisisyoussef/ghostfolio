// eslint-disable-next-line @typescript-eslint/no-require-imports
const YahooFinance = require('yahoo-finance2').default;

export interface MarketDataOutput {
  symbol: string;
  name?: string;
  price?: number;
  peRatio?: number;
  dividendYield?: number;
  marketCap?: number;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
  error?: string;
}

const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

async function fetchSingle(symbol: string): Promise<MarketDataOutput> {
  try {
    const quote = await yf.quote(symbol);
    if (!quote) {
      return { symbol, error: `No data returned for ${symbol}` };
    }
    return {
      symbol,
      name: quote.shortName ?? quote.longName,
      price: quote.regularMarketPrice,
      peRatio: quote.trailingPE,
      dividendYield: quote.dividendYield,
      marketCap: quote.marketCap,
      fiftyTwoWeekHigh: quote.fiftyTwoWeekHigh,
      fiftyTwoWeekLow: quote.fiftyTwoWeekLow
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      symbol,
      error: `Failed to fetch data for ${symbol}: ${message}`
    };
  }
}

export async function marketDataFetch(input: {
  symbols: string[];
}): Promise<Record<string, MarketDataOutput>> {
  const results: Record<string, MarketDataOutput> = {};
  const symbols = input.symbols.map((s) => s.trim().toUpperCase());

  await Promise.all(
    symbols.map(async (symbol) => {
      results[symbol] = await fetchSingle(symbol);
    })
  );

  return results;
}
