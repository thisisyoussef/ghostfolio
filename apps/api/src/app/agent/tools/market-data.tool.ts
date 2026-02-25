import { buildVerificationSummary } from '../verification/confidence.policy';
import {
  attributionToSources,
  hasValidSourceAttribution,
  toSourceAttribution
} from '../verification/source-attribution';
import {
  type VerificationSourceAttribution,
  type VerificationSummary
} from '../verification/verification.types';

export interface MarketDataOutput {
  symbol: string;
  name?: string;
  price?: number;
  peRatio?: number;
  dividendYield?: number;
  marketCap?: number;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
  backupPrice?: number;
  backupSource?: string;
  priceDiscrepancyPct?: number;
  sourceAttribution?: VerificationSourceAttribution;
  verification?: VerificationSummary;
  error?: string;
}

interface BackupPriceResult {
  source: string;
  timestamp: string;
  price?: number;
  unavailableReason?: string;
}

const FETCH_TIMEOUT_MS = 10_000; // 10 second timeout per symbol
const DEFAULT_DISCREPANCY_THRESHOLD_PCT = 5;
const DEFAULT_BACKUP_SOURCE_TIMEOUT_MS = 4_000;
const DEFAULT_PRIMARY_RETRY_ATTEMPTS = 2;
const DEFAULT_PRIMARY_RETRY_BACKOFF_MS = 150;
const DEFAULT_SYMBOL_RETRY_ATTEMPTS = 2;
const DEFAULT_SYMBOL_RETRY_BACKOFF_MS = 250;
const YAHOO_SOURCE = 'Yahoo Finance (chart v8)';
const YAHOO_CHART_HOSTS = ['query2.finance.yahoo.com', 'query1.finance.yahoo.com'];
const RETRYABLE_HTTP_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);

function readNumberEnv(key: string, fallback: number): number {
  const value = Number(process.env[key]);

  if (Number.isFinite(value) && value > 0) {
    return value;
  }

  return fallback;
}

function getDiscrepancyThresholdPct(): number {
  return readNumberEnv(
    'AGENT_MARKET_DISCREPANCY_THRESHOLD_PCT',
    DEFAULT_DISCREPANCY_THRESHOLD_PCT
  );
}

function getBackupSourceTimeoutMs(): number {
  return readNumberEnv(
    'AGENT_BACKUP_SOURCE_TIMEOUT_MS',
    DEFAULT_BACKUP_SOURCE_TIMEOUT_MS
  );
}

function getPrimaryRetryAttempts(): number {
  const attempts = Math.floor(
    readNumberEnv('AGENT_MARKET_PRIMARY_RETRY_ATTEMPTS', DEFAULT_PRIMARY_RETRY_ATTEMPTS)
  );

  return Math.max(1, attempts);
}

function getPrimaryRetryBackoffMs(): number {
  const backoff = Math.floor(
    readNumberEnv(
      'AGENT_MARKET_PRIMARY_RETRY_BACKOFF_MS',
      DEFAULT_PRIMARY_RETRY_BACKOFF_MS
    )
  );

  return Math.max(1, backoff);
}

function getSymbolRetryAttempts(): number {
  const attempts = Math.floor(
    readNumberEnv('AGENT_MARKET_SYMBOL_RETRY_ATTEMPTS', DEFAULT_SYMBOL_RETRY_ATTEMPTS)
  );

  return Math.max(1, attempts);
}

function getSymbolRetryBackoffMs(): number {
  const backoff = Math.floor(
    readNumberEnv(
      'AGENT_MARKET_SYMBOL_RETRY_BACKOFF_MS',
      DEFAULT_SYMBOL_RETRY_BACKOFF_MS
    )
  );

  return Math.max(1, backoff);
}

function buildYahooChartUrl(host: string, symbol: string): string {
  return `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
}

function getFetchCauseDetails(err: Error): string[] {
  const cause = (err as Error & { cause?: unknown }).cause;

  if (!cause || typeof cause !== 'object') {
    return [];
  }

  const causeRecord = cause as Record<string, unknown>;
  const details: string[] = [];

  for (const key of ['message', 'code', 'errno', 'syscall', 'address', 'port']) {
    const value = causeRecord[key];

    if (value !== undefined && value !== null && `${value}`.trim().length > 0) {
      details.push(`${key}=${value}`);
    }
  }

  return details;
}

function formatFetchError(err: unknown): string {
  if (!(err instanceof Error)) {
    return String(err);
  }

  const details = getFetchCauseDetails(err);

  if (details.length === 0) {
    return err.message;
  }

  return `${err.message}; ${details.join(', ')}`;
}

function isRetryableFetchError(err: unknown): boolean {
  if (!(err instanceof Error)) {
    return false;
  }

  if (err.name === 'AbortError') {
    return true;
  }

  const message = err.message.toLowerCase();

  if (
    message.includes('fetch failed') ||
    message.includes('timeout') ||
    message.includes('socket') ||
    message.includes('network')
  ) {
    return true;
  }

  const cause = (err as Error & { cause?: { code?: string } }).cause;
  const code = cause?.code?.toUpperCase();

  if (!code) {
    return false;
  }

  return [
    'EAI_AGAIN',
    'ECONNABORTED',
    'ECONNREFUSED',
    'ECONNRESET',
    'EHOSTUNREACH',
    'ENETUNREACH',
    'ENOTFOUND',
    'EPROTO',
    'ETIMEDOUT',
    'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_SOCKET',
    'UND_ERR_HEADERS_TIMEOUT'
  ].includes(code);
}

function isRetryableStatusCode(statusCode: number): boolean {
  return RETRYABLE_HTTP_STATUS_CODES.has(statusCode);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function fetchWithTimeout(args: {
  url: string;
  timeoutMs: number;
  headers?: Record<string, string>;
}): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), args.timeoutMs);

  try {
    return await fetch(args.url, {
      headers: args.headers,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchSinglePrimary(symbol: string): Promise<MarketDataOutput> {
  // Use Yahoo Finance v8 chart API directly via native fetch.
  // The yahoo-finance2 library's cookie/crumb handling fails in containerized
  // environments (Railway). Direct fetch with proper User-Agent works reliably.
  const errors: string[] = [];
  const retryAttempts = getPrimaryRetryAttempts();
  const retryBackoffMs = getPrimaryRetryBackoffMs();

  for (const host of YAHOO_CHART_HOSTS) {
    for (let attempt = 1; attempt <= retryAttempts; attempt++) {
      const url = buildYahooChartUrl(host, symbol);

      try {
        const response = await fetchWithTimeout({
          url,
          timeoutMs: FETCH_TIMEOUT_MS,
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; ghostfolio-agent/1.0)'
          }
        });

        if (!response.ok) {
          const message = `Yahoo Finance returned ${response.status} from ${host} for ${symbol}`;
          errors.push(message);

          if (isRetryableStatusCode(response.status) && attempt < retryAttempts) {
            await sleep(retryBackoffMs * attempt);
            continue;
          }

          break;
        }

        const data = await response.json();
        const result = data?.chart?.result?.[0];

        if (!result) {
          errors.push(`No data returned for ${symbol} from ${host}`);
          break;
        }

        const meta = result.meta || {};

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
        const message = formatFetchError(err);

        console.error(
          `[market-data] Failed to fetch ${symbol} via ${host} (attempt ${attempt}/${retryAttempts}): ${message}`
        );
        errors.push(`Fetch error from ${host}: ${message}`);

        if (isRetryableFetchError(err) && attempt < retryAttempts) {
          await sleep(retryBackoffMs * attempt);
          continue;
        }

        break;
      }
    }
  }

  return {
    symbol,
    error:
      errors[errors.length - 1] || `Failed to fetch data for ${symbol}: unknown error`
  };
}

function toStooqTicker(symbol: string): string {
  return `${symbol.trim().toLowerCase().replace(/\./g, '-')}.us`;
}

function isUsdCryptoPair(symbol: string): boolean {
  return /-USD$/i.test(symbol);
}

async function fetchAlphaVantagePrice(symbol: string): Promise<BackupPriceResult> {
  const apiKey = process.env.API_KEY_ALPHA_VANTAGE?.trim();

  if (!apiKey) {
    return {
      source: 'Alpha Vantage',
      timestamp: new Date().toISOString(),
      unavailableReason: 'API key is missing.'
    };
  }

  const query = new URLSearchParams({
    function: 'GLOBAL_QUOTE',
    symbol,
    apikey: apiKey
  });

  const response = await fetchWithTimeout({
    url: `https://www.alphavantage.co/query?${query.toString()}`,
    timeoutMs: getBackupSourceTimeoutMs()
  });

  if (!response.ok) {
    return {
      source: 'Alpha Vantage',
      timestamp: new Date().toISOString(),
      unavailableReason: `HTTP ${response.status}`
    };
  }

  const payload = await response.json();
  const quote = payload?.['Global Quote'];
  const rawPrice = quote?.['05. price'];
  const price = Number(rawPrice);

  if (!Number.isFinite(price) || price <= 0) {
    return {
      source: 'Alpha Vantage',
      timestamp: new Date().toISOString(),
      unavailableReason: 'No valid price in GLOBAL_QUOTE response.'
    };
  }

  return {
    source: 'Alpha Vantage',
    timestamp: new Date().toISOString(),
    price
  };
}

async function fetchStooqPrice(symbol: string): Promise<BackupPriceResult> {
  const stooqTicker = toStooqTicker(symbol);
  const response = await fetchWithTimeout({
    url: `https://stooq.com/q/l/?s=${encodeURIComponent(stooqTicker)}&f=sd2t2ohlcv&h&e=csv`,
    timeoutMs: getBackupSourceTimeoutMs(),
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; ghostfolio-agent/1.0)'
    }
  });

  if (!response.ok) {
    return {
      source: 'Stooq',
      timestamp: new Date().toISOString(),
      unavailableReason: `HTTP ${response.status}`
    };
  }

  const text = await response.text();
  const lines = text.trim().split(/\r?\n/);

  if (lines.length < 2) {
    return {
      source: 'Stooq',
      timestamp: new Date().toISOString(),
      unavailableReason: 'Malformed CSV response.'
    };
  }

  const values = lines[1].split(',');
  const close = values[6];
  const price = Number(close);

  if (!close || close === 'N/D' || !Number.isFinite(price) || price <= 0) {
    return {
      source: 'Stooq',
      timestamp: new Date().toISOString(),
      unavailableReason: `No valid close price for ${stooqTicker}.`
    };
  }

  return {
    source: 'Stooq',
    timestamp: new Date().toISOString(),
    price
  };
}

async function resolveCoinGeckoId(baseSymbol: string): Promise<string | undefined> {
  const response = await fetchWithTimeout({
    url: `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(baseSymbol)}`,
    timeoutMs: getBackupSourceTimeoutMs()
  });

  if (!response.ok) {
    return undefined;
  }

  const payload = await response.json();
  const coins = Array.isArray(payload?.coins) ? payload.coins : [];
  const normalized = baseSymbol.toLowerCase();

  const exactMatch = coins.find((coin: any) => {
    return String(coin?.symbol || '').toLowerCase() === normalized;
  });

  return exactMatch?.id ? String(exactMatch.id) : undefined;
}

async function fetchCoinGeckoPrice(symbol: string): Promise<BackupPriceResult> {
  const baseSymbol = symbol.replace(/-USD$/i, '').trim();

  const coinId = await resolveCoinGeckoId(baseSymbol);

  if (!coinId) {
    return {
      source: 'CoinGecko',
      timestamp: new Date().toISOString(),
      unavailableReason: `No CoinGecko id found for ${baseSymbol}.`
    };
  }

  const response = await fetchWithTimeout({
    url: `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(coinId)}&vs_currencies=usd`,
    timeoutMs: getBackupSourceTimeoutMs()
  });

  if (!response.ok) {
    return {
      source: 'CoinGecko',
      timestamp: new Date().toISOString(),
      unavailableReason: `HTTP ${response.status}`
    };
  }

  const payload = await response.json();
  const price = Number(payload?.[coinId]?.usd);

  if (!Number.isFinite(price) || price <= 0) {
    return {
      source: 'CoinGecko',
      timestamp: new Date().toISOString(),
      unavailableReason: 'No valid USD price in response.'
    };
  }

  return {
    source: 'CoinGecko',
    timestamp: new Date().toISOString(),
    price
  };
}

async function fetchBackupPrice(symbol: string): Promise<BackupPriceResult> {
  const issues: string[] = [];

  if (process.env.API_KEY_ALPHA_VANTAGE?.trim()) {
    try {
      const alpha = await fetchAlphaVantagePrice(symbol);

      if (alpha.price !== undefined) {
        return alpha;
      }

      issues.push(`Alpha Vantage: ${alpha.unavailableReason || 'No price.'}`);
    } catch (error) {
      issues.push(
        `Alpha Vantage: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  try {
    const publicBackup = isUsdCryptoPair(symbol)
      ? await fetchCoinGeckoPrice(symbol)
      : await fetchStooqPrice(symbol);

    if (publicBackup.price !== undefined) {
      return publicBackup;
    }

    issues.push(
      `${publicBackup.source}: ${publicBackup.unavailableReason || 'No price.'}`
    );

    return {
      source: publicBackup.source,
      timestamp: publicBackup.timestamp,
      unavailableReason: issues.join(' | ')
    };
  } catch (error) {
    return {
      source: isUsdCryptoPair(symbol) ? 'CoinGecko' : 'Stooq',
      timestamp: new Date().toISOString(),
      unavailableReason: `${issues.join(' | ')} | ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

function isValidOutputSchema(output: MarketDataOutput): boolean {
  const hasSymbol = typeof output.symbol === 'string' && output.symbol.length > 0;
  const hasPrice = typeof output.price === 'number' && Number.isFinite(output.price);
  const hasError = typeof output.error === 'string' && output.error.length > 0;

  return hasSymbol && (hasPrice || hasError);
}

async function fetchSingle(symbol: string): Promise<MarketDataOutput> {
  const primary = await fetchSinglePrimary(symbol);
  const backup = await fetchBackupPrice(symbol);

  const discrepancyThresholdPct = getDiscrepancyThresholdPct();
  const hasPrimaryPrice =
    typeof primary.price === 'number' && Number.isFinite(primary.price);
  const hasBackupPrice =
    typeof backup.price === 'number' && Number.isFinite(backup.price);

  let discrepancyPct: number | undefined;

  if (hasPrimaryPrice && hasBackupPrice && primary.price && backup.price) {
    discrepancyPct =
      Math.abs(primary.price - backup.price) / primary.price * 100;
  }

  const sourceAttribution = toSourceAttribution({
    primarySource: YAHOO_SOURCE,
    backupSource: backup.source,
    backupTimestamp: backup.timestamp
  });

  const crossSourcePricePassed =
    discrepancyPct !== undefined
      ? discrepancyPct <= discrepancyThresholdPct
      : false;

  let crossSourcePriceReason: string | undefined;

  if (discrepancyPct === undefined && !hasBackupPrice) {
    crossSourcePriceReason = 'Backup source price unavailable.';
  } else if (discrepancyPct === undefined && !hasPrimaryPrice) {
    crossSourcePriceReason = 'Primary source price unavailable.';
  } else if (discrepancyPct === undefined) {
    crossSourcePriceReason = 'Unable to compare cross-source prices.';
  } else if (discrepancyPct > discrepancyThresholdPct) {
    crossSourcePriceReason = `Discrepancy ${discrepancyPct.toFixed(2)}% exceeds threshold ${discrepancyThresholdPct.toFixed(2)}%.`;
  }

  const checks = {
    crossSourcePrice: {
      passed: crossSourcePricePassed,
      reason: crossSourcePriceReason,
      details: {
        backupSource: backup.source,
        backupUnavailableReason: backup.unavailableReason,
        backupPrice: backup.price,
        discrepancyPct,
        primaryPrice: primary.price,
        thresholdPct: discrepancyThresholdPct
      }
    },
    outputSchema: {
      passed: isValidOutputSchema(primary),
      reason: isValidOutputSchema(primary)
        ? undefined
        : 'Output must contain symbol and either price or error.'
    },
    sourceAttribution: {
      passed: hasValidSourceAttribution(sourceAttribution),
      reason: hasValidSourceAttribution(sourceAttribution)
        ? undefined
        : 'Source attribution must include source and timestamp.'
    }
  };

  const verification = buildVerificationSummary({
    checks,
    sources: attributionToSources({
      attribution: sourceAttribution,
      tool: 'market_data_fetch',
      primaryClaim: `price quote for ${symbol}`,
      backupClaim: `backup quote for ${symbol}`
    }),
    flags: {
      outputSchemaFailed: !checks.outputSchema.passed,
      sourceAttributionFailed: !checks.sourceAttribution.passed,
      discrepancyExceeded:
        discrepancyPct !== undefined && discrepancyPct > discrepancyThresholdPct,
      backupUnavailable: !hasBackupPrice,
      hardError: typeof primary.error === 'string' && !hasPrimaryPrice
    }
  });

  const resolvedPrimaryPrice = hasPrimaryPrice ? primary.price : undefined;
  const resolvedPrice =
    resolvedPrimaryPrice ??
    (hasBackupPrice ? (backup.price as number) : undefined);
  const primaryUnavailableReason =
    !hasPrimaryPrice && typeof primary.error === 'string'
      ? primary.error
      : undefined;

  return {
    ...primary,
    ...(resolvedPrice !== undefined ? { price: resolvedPrice } : {}),
    ...(resolvedPrice !== undefined
      ? {}
      : primaryUnavailableReason
        ? { error: primaryUnavailableReason }
        : {}),
    ...(hasBackupPrice ? { backupPrice: backup.price } : {}),
    backupSource: backup.source,
    ...(discrepancyPct !== undefined
      ? { priceDiscrepancyPct: Math.round(discrepancyPct * 100) / 100 }
      : {}),
    sourceAttribution,
    verification
  };
}

function shouldRetrySymbol(output: MarketDataOutput): boolean {
  if (typeof output.price === 'number' && Number.isFinite(output.price)) {
    return false;
  }

  if (!output.error) {
    return false;
  }

  const reason = output.error.toLowerCase();

  if (reason.includes('no data returned')) {
    return false;
  }

  return /(timeout|fetch error|failed to fetch|429|500|502|503|504|network|socket|temporarily unavailable)/.test(
    reason
  );
}

async function fetchSingleWithRetry(symbol: string): Promise<MarketDataOutput> {
  const attempts = getSymbolRetryAttempts();
  const backoffMs = getSymbolRetryBackoffMs();
  let latest: MarketDataOutput | undefined;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    latest = await fetchSingle(symbol);

    if (!shouldRetrySymbol(latest) || attempt >= attempts) {
      return latest;
    }

    await sleep(backoffMs * attempt);
  }

  return (
    latest || {
      symbol,
      error: `Failed to fetch data for ${symbol}: unknown error`
    }
  );
}

export async function marketDataFetch(input: {
  symbols: string[];
}): Promise<Record<string, MarketDataOutput>> {
  const results: Record<string, MarketDataOutput> = {};
  const symbols = input.symbols.map((s) => s.trim().toUpperCase());

  await Promise.all(
    symbols.map(async (symbol) => {
      results[symbol] = await fetchSingleWithRetry(symbol);
    })
  );

  return results;
}
