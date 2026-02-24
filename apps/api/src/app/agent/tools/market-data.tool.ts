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

async function fetchSingle(symbol: string): Promise<MarketDataOutput> {
  // Use Yahoo Finance v8 chart API directly via native fetch.
  // The yahoo-finance2 library's cookie/crumb handling fails in containerized
  // environments (Railway). Direct fetch with proper User-Agent works reliably.
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ghostfolio-agent/1.0)'
      }
    });
    if (!response.ok) {
      return { symbol, error: `Yahoo Finance returned ${response.status} for ${symbol}` };
    }
    const data = await response.json();
    const result = data?.chart?.result?.[0];
    if (!result) {
      return { symbol, error: `No data returned for ${symbol}` };
    }
    const meta = result.meta;
    return {
      symbol: meta.symbol || symbol,
      name: meta.shortName ?? meta.longName,
      price: meta.regularMarketPrice,
      fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh,
      fiftyTwoWeekLow: meta.fiftyTwoWeekLow,
      marketCap: undefined, // Not available in chart API
      peRatio: undefined,
      dividendYield: undefined
    };
  } catch (err: unknown) {
    const message = err instanceof Error
      ? `${err.message}${(err as { cause?: { message?: string } }).cause?.message ? ` (cause: ${(err as { cause?: { message?: string } }).cause.message})` : ''}`
      : String(err);
    console.error(`[market-data] Failed to fetch ${symbol}:`, message);
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
