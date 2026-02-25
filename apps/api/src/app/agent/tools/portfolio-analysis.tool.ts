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

export interface PortfolioAnalysisInput {
  dateRange?: string;
  metrics?: string[];
}

export interface HoldingInfo {
  symbol: string;
  name: string;
  percentage: number;
}

export interface PortfolioAnalysisOutput {
  concentration: {
    topHoldingSymbol: string;
    topHoldingPercent: number;
    herfindahlIndex: number;
    topHoldings: HoldingInfo[];
    diversificationLevel: string;
  };
  allocation: {
    byAssetClass: Record<string, number>;
  };
  performance: {
    currentValue: number;
    totalReturn: number;
    totalReturnPercent: number;
    totalInvestment: number;
  };
  holdingsCount: number;
  sourceAttribution?: VerificationSourceAttribution;
  verification?: VerificationSummary;
  error?: string;
}

function isValidPortfolioOutput(output: PortfolioAnalysisOutput): boolean {
  return (
    typeof output.holdingsCount === 'number' &&
    typeof output.concentration?.topHoldingSymbol === 'string' &&
    typeof output.concentration?.topHoldingPercent === 'number' &&
    typeof output.concentration?.herfindahlIndex === 'number' &&
    Array.isArray(output.concentration?.topHoldings) &&
    typeof output.concentration?.diversificationLevel === 'string' &&
    !!output.allocation &&
    typeof output.allocation.byAssetClass === 'object' &&
    typeof output.performance?.currentValue === 'number' &&
    typeof output.performance?.totalReturn === 'number' &&
    typeof output.performance?.totalReturnPercent === 'number' &&
    typeof output.performance?.totalInvestment === 'number'
  );
}

function checkAllocationSanity(output: PortfolioAnalysisOutput): {
  passed: boolean;
  reason?: string;
  details?: Record<string, unknown>;
} {
  const allocationValues = Object.values(output.allocation.byAssetClass || {});
  const total = allocationValues.reduce((sum, value) => {
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0);

  if (output.holdingsCount === 0) {
    return {
      passed: true,
      details: { totalAllocationPercent: total }
    };
  }

  const passed = total >= 95 && total <= 105;

  return {
    passed,
    reason: passed
      ? undefined
      : `Asset allocation total (${total.toFixed(2)}%) is outside 95-105%.`,
    details: {
      totalAllocationPercent: Math.round(total * 100) / 100
    }
  };
}

function checkReturnMathConsistency(output: PortfolioAnalysisOutput): {
  passed: boolean;
  reason?: string;
  details?: Record<string, unknown>;
} {
  const investment = output.performance.totalInvestment;
  const totalReturn = output.performance.totalReturn;
  const observedPercent = output.performance.totalReturnPercent;

  if (investment <= 0) {
    return {
      passed: true,
      details: { observedPercent }
    };
  }

  const expectedPercent = (totalReturn / investment) * 100;
  const delta = Math.abs(expectedPercent - observedPercent);
  const passed = delta <= 1;

  return {
    passed,
    reason: passed
      ? undefined
      : `Return math mismatch (delta ${delta.toFixed(2)}pp).`,
    details: {
      delta,
      expectedPercent: Math.round(expectedPercent * 100) / 100,
      observedPercent
    }
  };
}

function attachVerification(
  output: PortfolioAnalysisOutput
): PortfolioAnalysisOutput {
  const sourceAttribution = toSourceAttribution({
    primarySource: 'Ghostfolio PortfolioService'
  });

  const outputSchemaPassed = isValidPortfolioOutput(output);
  const sourceAttributionPassed = hasValidSourceAttribution(sourceAttribution);
  const allocationSanity = checkAllocationSanity(output);
  const returnMathConsistency = checkReturnMathConsistency(output);

  const checks = {
    outputSchema: {
      passed: outputSchemaPassed,
      reason: outputSchemaPassed
        ? undefined
        : 'Portfolio output schema is invalid.'
    },
    sourceAttribution: {
      passed: sourceAttributionPassed,
      reason: sourceAttributionPassed
        ? undefined
        : 'Source attribution must include source and timestamp.'
    },
    allocationSanity,
    returnMathConsistency
  };

  const verification = buildVerificationSummary({
    checks,
    sources: attributionToSources({
      attribution: sourceAttribution,
      tool: 'portfolio_risk_analysis',
      primaryClaim: 'portfolio analytics data'
    }),
    flags: {
      outputSchemaFailed: !outputSchemaPassed,
      sourceAttributionFailed: !sourceAttributionPassed,
      hardError: !!output.error
    }
  });

  return {
    ...output,
    sourceAttribution,
    verification
  };
}

/**
 * Returns true if the string looks like a UUID (MANUAL data source assigns these as symbols).
 */
function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

/**
 * Returns a user-friendly display symbol. For MANUAL data source holdings,
 * the symbol is a UUID — in that case, prefer the name.
 */
function displaySymbol(symbol: string, name: string): string {
  if (isUuid(symbol) && name) {
    return name;
  }
  return symbol;
}

/**
 * Compute the Herfindahl-Hirschman Index from allocation fractions.
 * HHI = Σ(allocation_i²) where allocation_i is a fraction (0–1).
 * Range: 0 (perfectly diversified) to 1 (single holding).
 */
function computeHHI(allocations: number[]): number {
  return allocations.reduce((sum, a) => sum + a * a, 0);
}

function classifyDiversification(hhi: number): string {
  if (hhi >= 0.5) return 'Highly Concentrated';
  if (hhi >= 0.25) return 'Moderately Concentrated';
  if (hhi >= 0.15) return 'Moderately Diversified';
  return 'Well Diversified';
}

/**
 * Portfolio risk analysis tool that accesses Ghostfolio portfolio data
 * via NestJS dependency injection and computes risk metrics.
 *
 * @param input - Optional date range and metrics filter
 * @param portfolioService - Ghostfolio PortfolioService instance
 * @param userId - Authenticated user's ID (from JWT)
 */
export async function portfolioRiskAnalysis(
  input: PortfolioAnalysisInput,
  portfolioService: any,
  userId: string
): Promise<PortfolioAnalysisOutput> {
  const emptyResult: PortfolioAnalysisOutput = {
    concentration: {
      topHoldingSymbol: '',
      topHoldingPercent: 0,
      herfindahlIndex: 0,
      topHoldings: [],
      diversificationLevel: ''
    },
    allocation: { byAssetClass: {} },
    performance: {
      currentValue: 0,
      totalReturn: 0,
      totalReturnPercent: 0,
      totalInvestment: 0
    },
    holdingsCount: 0
  };

  if (!userId) {
    return attachVerification({
      ...emptyResult,
      error: 'No authenticated user — unable to access portfolio data.'
    });
  }

  // Fetch portfolio details and performance
  let holdings: Record<string, any>;
  let performanceData: any;
  try {
    const [details, performance] = await Promise.all([
      portfolioService.getDetails({
        dateRange: (input.dateRange as any) || 'max',
        filters: [],
        impersonationId: undefined,
        userId,
        withSummary: true
      }),
      portfolioService.getPerformance({
        dateRange: (input.dateRange as any) || 'max',
        filters: [],
        impersonationId: undefined,
        userId
      })
    ]);
    holdings = details.holdings || {};
    performanceData = performance?.performance;
  } catch {
    return attachVerification({
      ...emptyResult,
      error: 'Unable to access portfolio data. Please try again later.'
    });
  }

  const holdingEntries = Object.entries(holdings);
  if (holdingEntries.length === 0) {
    return attachVerification({
      ...emptyResult,
      error: 'No holdings found in portfolio.'
    });
  }

  // --- Concentration ---
  const holdingsList = holdingEntries.map(([symbol, data]: [string, any]) => ({
    symbol,
    name: data.name || symbol,
    allocation: data.allocationInPercentage || 0
  }));

  // Sort by allocation descending
  holdingsList.sort((a, b) => b.allocation - a.allocation);

  const allocations = holdingsList.map((h) => h.allocation);
  const hhi = computeHHI(allocations);

  const topHoldings: HoldingInfo[] = holdingsList
    .slice(0, 5)
    .map((h) => ({
      symbol: displaySymbol(h.symbol, h.name),
      name: h.name,
      percentage: Math.round(h.allocation * 100 * 100) / 100
    }));

  const topEntry = holdingsList[0];
  const concentration = {
    topHoldingSymbol: topEntry ? displaySymbol(topEntry.symbol, topEntry.name) : '',
    topHoldingPercent: Math.round((topEntry?.allocation || 0) * 100 * 100) / 100,
    herfindahlIndex: Math.round(hhi * 10000) / 10000,
    topHoldings,
    diversificationLevel: classifyDiversification(hhi)
  };

  // --- Allocation by asset class ---
  const assetClassMap: Record<string, number> = {};
  for (const [, data] of holdingEntries) {
    let assetClass = (data as any).assetClass || 'UNKNOWN';
    // Map internal labels to user-friendly names
    if (assetClass === 'UNKNOWN') {
      assetClass = 'Other';
    }
    const pct = ((data as any).allocationInPercentage || 0) * 100;
    assetClassMap[assetClass] = Math.round(((assetClassMap[assetClass] || 0) + pct) * 100) / 100;
  }

  // --- Performance ---
  const performance = {
    currentValue: performanceData?.currentValueInBaseCurrency ?? 0,
    totalReturn: performanceData?.netPerformance ?? 0,
    totalReturnPercent:
      Math.round((performanceData?.netPerformancePercentage ?? 0) * 100 * 100) / 100,
    totalInvestment: performanceData?.totalInvestment ?? 0
  };

  return attachVerification({
    concentration,
    allocation: { byAssetClass: assetClassMap },
    performance,
    holdingsCount: holdingEntries.length
  });
}
