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
  error?: string;
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
 * @param prismaService - PrismaService to look up the user
 */
export async function portfolioRiskAnalysis(
  input: PortfolioAnalysisInput,
  portfolioService: any,
  prismaService: any
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

  // Find the first user (MVP: no auth on agent endpoint)
  let userId: string;
  try {
    const user = await prismaService.user.findFirst();
    if (!user) {
      return { ...emptyResult, error: 'No user found — unable to access portfolio data.' };
    }
    userId = user.id;
  } catch {
    return { ...emptyResult, error: 'Unable to access portfolio data. Please try again later.' };
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
    return { ...emptyResult, error: 'Unable to access portfolio data. Please try again later.' };
  }

  const holdingEntries = Object.entries(holdings);
  if (holdingEntries.length === 0) {
    return { ...emptyResult, error: 'No holdings found in portfolio.' };
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
      symbol: h.symbol,
      name: h.name,
      percentage: Math.round(h.allocation * 100 * 100) / 100
    }));

  const concentration = {
    topHoldingSymbol: holdingsList[0]?.symbol || '',
    topHoldingPercent: Math.round((holdingsList[0]?.allocation || 0) * 100 * 100) / 100,
    herfindahlIndex: Math.round(hhi * 10000) / 10000,
    topHoldings,
    diversificationLevel: classifyDiversification(hhi)
  };

  // --- Allocation by asset class ---
  const assetClassMap: Record<string, number> = {};
  for (const [, data] of holdingEntries) {
    const assetClass = (data as any).assetClass || 'UNKNOWN';
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

  return {
    concentration,
    allocation: { byAssetClass: assetClassMap },
    performance,
    holdingsCount: holdingEntries.length
  };
}
