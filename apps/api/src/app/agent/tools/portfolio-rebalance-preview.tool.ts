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

const DEFAULT_TARGET_MAX_HOLDING_PCT = 20;
const MIN_TARGET_MAX_HOLDING_PCT = 5;
const MAX_TARGET_MAX_HOLDING_PCT = 35;
const MAX_TOP_HOLDINGS = 5;

export interface PortfolioRebalancePreviewInput {
  targetMaxHoldingPct?: number;
  excludeSymbols?: string[];
}

export interface PortfolioRebalanceHolding {
  symbol: string;
  name: string;
  currentPercent: number;
  currentValue: number;
}

export interface PortfolioRebalanceTrade {
  action: 'BUY' | 'SELL';
  symbol: string;
  name: string;
  fromPercent: number;
  toPercent: number;
  tradePercent: number;
  estimatedValue: number;
  rationale: string;
}

export interface PortfolioRebalancePreviewOutput {
  currentTopHoldings: PortfolioRebalanceHolding[];
  suggestedTrades: PortfolioRebalanceTrade[];
  projectedConcentration: {
    currentHerfindahlIndex: number;
    currentTopHoldingPct: number;
    projectedHerfindahlIndex: number;
    projectedTopHoldingPct: number;
    concentrationReductionPct: number;
  };
  assumptions: {
    targetMaxHoldingPct: number;
    excludedSymbols: string[];
    methodology: string;
    rebalanceMode: 'read_only_preview';
    portfolioValue: number;
    syntheticSleeveCount: number;
  };
  sourceAttribution?: VerificationSourceAttribution;
  verification?: VerificationSummary;
  error?: string;
}

interface HoldingSnapshot {
  symbol: string;
  name: string;
  currentPercent: number;
  currentValue: number;
}

function roundTwo(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function normalizeSymbols(symbols: string[] | undefined): string[] {
  if (!symbols) {
    return [];
  }

  return Array.from(
    new Set(
      symbols
        .map((symbol) => String(symbol || '').trim().toUpperCase())
        .filter((symbol) => symbol.length > 0)
    )
  );
}

function computeHerfindahlIndex(percentages: number[]): number {
  const hhi = percentages.reduce((sum, value) => {
    const normalized = Math.max(0, value) / 100;
    return sum + normalized * normalized;
  }, 0);

  return Math.round(hhi * 10_000) / 10_000;
}

function buildSyntheticSleeves(
  totalPercent: number,
  maxPerSleeve: number
): number[] {
  if (totalPercent <= 0) {
    return [];
  }

  const sleeveCount = Math.max(1, Math.ceil(totalPercent / maxPerSleeve));
  const average = totalPercent / sleeveCount;
  const sleeves = Array.from({ length: sleeveCount }, () => roundTwo(average));
  const roundedTotal = sleeves.reduce((sum, value) => sum + value, 0);
  const delta = roundTwo(totalPercent - roundedTotal);

  if (delta !== 0) {
    sleeves[sleeves.length - 1] = roundTwo(sleeves[sleeves.length - 1] + delta);
  }

  return sleeves;
}

function hasValidOutput(output: PortfolioRebalancePreviewOutput): boolean {
  return (
    Array.isArray(output.currentTopHoldings) &&
    Array.isArray(output.suggestedTrades) &&
    typeof output.projectedConcentration.currentHerfindahlIndex === 'number' &&
    typeof output.projectedConcentration.currentTopHoldingPct === 'number' &&
    typeof output.projectedConcentration.projectedHerfindahlIndex === 'number' &&
    typeof output.projectedConcentration.projectedTopHoldingPct === 'number' &&
    typeof output.projectedConcentration.concentrationReductionPct === 'number' &&
    typeof output.assumptions.targetMaxHoldingPct === 'number' &&
    Array.isArray(output.assumptions.excludedSymbols) &&
    typeof output.assumptions.portfolioValue === 'number'
  );
}

function buildEmptyOutput(args: {
  error: string;
  excludedSymbols: string[];
  targetMaxHoldingPct: number;
}): PortfolioRebalancePreviewOutput {
  return {
    assumptions: {
      excludedSymbols: args.excludedSymbols,
      methodology:
        'Trim holdings above the target and reallocate into diversified sleeves.',
      portfolioValue: 0,
      rebalanceMode: 'read_only_preview',
      syntheticSleeveCount: 0,
      targetMaxHoldingPct: args.targetMaxHoldingPct
    },
    currentTopHoldings: [],
    error: args.error,
    projectedConcentration: {
      concentrationReductionPct: 0,
      currentHerfindahlIndex: 0,
      currentTopHoldingPct: 0,
      projectedHerfindahlIndex: 0,
      projectedTopHoldingPct: 0
    },
    suggestedTrades: []
  };
}

function attachVerification(
  output: PortfolioRebalancePreviewOutput
): PortfolioRebalancePreviewOutput {
  const sourceAttribution = toSourceAttribution({
    primarySource: 'Ghostfolio PortfolioService + deterministic rebalance heuristic'
  });
  const outputSchemaPassed = hasValidOutput(output);
  const sourceAttributionPassed = hasValidSourceAttribution(sourceAttribution);
  const targetInRange =
    output.assumptions.targetMaxHoldingPct >= MIN_TARGET_MAX_HOLDING_PCT &&
    output.assumptions.targetMaxHoldingPct <= MAX_TARGET_MAX_HOLDING_PCT;
  const projectedTotalPercent = roundTwo(
    output.currentTopHoldings.reduce((sum, holding) => {
      return sum + (Number.isFinite(holding.currentPercent) ? holding.currentPercent : 0);
    }, 0)
  );

  const checks = {
    outputSchema: {
      passed: outputSchemaPassed,
      reason: outputSchemaPassed ? undefined : 'Rebalance preview output schema is invalid.'
    },
    sourceAttribution: {
      passed: sourceAttributionPassed,
      reason: sourceAttributionPassed
        ? undefined
        : 'Source attribution must include source and timestamp.'
    },
    targetBounds: {
      passed: targetInRange,
      reason: targetInRange
        ? undefined
        : `targetMaxHoldingPct must be between ${MIN_TARGET_MAX_HOLDING_PCT} and ${MAX_TARGET_MAX_HOLDING_PCT}.`
    },
    topHoldingsCoverage: {
      passed: projectedTotalPercent <= 100,
      reason:
        projectedTotalPercent <= 100
          ? undefined
          : 'Top holdings coverage unexpectedly exceeded 100%.'
    }
  };

  const verification = buildVerificationSummary({
    checks,
    flags: {
      hardError: !!output.error,
      outputSchemaFailed: !outputSchemaPassed,
      sourceAttributionFailed: !sourceAttributionPassed
    },
    sources: attributionToSources({
      attribution: sourceAttribution,
      primaryClaim: 'read-only concentration rebalance preview',
      tool: 'portfolio_rebalance_preview'
    })
  });

  return {
    ...output,
    sourceAttribution,
    verification
  };
}

function extractHoldings(rawHoldings: Record<string, any>): HoldingSnapshot[] {
  const entries = Object.entries(rawHoldings);
  const totalValue = entries.reduce((sum, [, value]) => {
    const holdingValue = Number(value?.valueInBaseCurrency || 0);
    return sum + (Number.isFinite(holdingValue) ? holdingValue : 0);
  }, 0);
  const hasCompleteAllocations = entries.every(([, value]) => {
    const allocation = Number(value?.allocationInPercentage);
    return Number.isFinite(allocation) && allocation >= 0;
  });

  return entries.map(([symbol, value]) => {
    const normalizedSymbol = String(symbol || '').toUpperCase();
    const allocation = Number(value?.allocationInPercentage);
    const byAllocation = hasCompleteAllocations
      ? roundTwo(allocation * 100)
      : undefined;
    const holdingValue = Number(value?.valueInBaseCurrency || 0);
    const byValue =
      totalValue > 0
        ? roundTwo((Math.max(0, holdingValue) / totalValue) * 100)
        : 0;

    return {
      currentPercent:
        typeof byAllocation === 'number' && Number.isFinite(byAllocation)
          ? byAllocation
          : byValue,
      currentValue: roundMoney(Number.isFinite(holdingValue) ? holdingValue : 0),
      name: String(value?.name || normalizedSymbol),
      symbol: normalizedSymbol
    };
  });
}

export async function portfolioRebalancePreview(
  input: PortfolioRebalancePreviewInput,
  portfolioService: any,
  userId: string
): Promise<PortfolioRebalancePreviewOutput> {
  const targetMaxHoldingPct = roundTwo(
    Number.isFinite(input.targetMaxHoldingPct as number)
      ? Number(input.targetMaxHoldingPct)
      : DEFAULT_TARGET_MAX_HOLDING_PCT
  );
  const excludedSymbols = normalizeSymbols(input.excludeSymbols);

  if (!userId) {
    return attachVerification(
      buildEmptyOutput({
        error: 'No authenticated user — unable to run rebalance preview.',
        excludedSymbols,
        targetMaxHoldingPct
      })
    );
  }

  let holdings: Record<string, any>;

  try {
    const details = await portfolioService.getDetails({
      dateRange: 'max' as any,
      filters: [],
      impersonationId: undefined,
      userId,
      withSummary: false
    });

    holdings = details?.holdings || {};
  } catch {
    return attachVerification(
      buildEmptyOutput({
        error: 'Unable to access portfolio data. Please try again later.',
        excludedSymbols,
        targetMaxHoldingPct
      })
    );
  }

  const holdingSnapshots = extractHoldings(holdings);

  if (holdingSnapshots.length === 0) {
    return attachVerification(
      buildEmptyOutput({
        error: 'No holdings found in portfolio.',
        excludedSymbols,
        targetMaxHoldingPct
      })
    );
  }

  const excludedSet = new Set(excludedSymbols);
  const sortedHoldings = [...holdingSnapshots].sort(
    (left, right) => right.currentPercent - left.currentPercent
  );
  const currentTopHoldings = sortedHoldings.slice(0, MAX_TOP_HOLDINGS).map((holding) => {
    return {
      currentPercent: roundTwo(holding.currentPercent),
      currentValue: roundMoney(holding.currentValue),
      name: holding.name,
      symbol: holding.symbol
    };
  });
  const totalPortfolioValue = roundMoney(
    holdingSnapshots.reduce((sum, holding) => sum + holding.currentValue, 0)
  );

  const projectedHoldingPercents = holdingSnapshots.map((holding) => {
    if (excludedSet.has(holding.symbol)) {
      return holding.currentPercent;
    }

    if (holding.currentPercent <= targetMaxHoldingPct) {
      return holding.currentPercent;
    }

    return roundTwo(targetMaxHoldingPct);
  });

  const suggestedTrades: PortfolioRebalanceTrade[] = [];
  let totalTrimmedPercent = 0;

  for (const [index, holding] of holdingSnapshots.entries()) {
    if (excludedSet.has(holding.symbol)) {
      continue;
    }

    const fromPercent = roundTwo(holding.currentPercent);
    const toPercent = roundTwo(projectedHoldingPercents[index]);
    const tradePercent = roundTwo(fromPercent - toPercent);

    if (tradePercent <= 0) {
      continue;
    }

    totalTrimmedPercent = roundTwo(totalTrimmedPercent + tradePercent);

    suggestedTrades.push({
      action: 'SELL',
      estimatedValue: roundMoney((totalPortfolioValue * tradePercent) / 100),
      fromPercent,
      name: holding.name,
      rationale: `Trim to target max holding ${targetMaxHoldingPct}%.`,
      symbol: holding.symbol,
      toPercent,
      tradePercent
    });
  }

  const syntheticSleeves = buildSyntheticSleeves(
    totalTrimmedPercent,
    targetMaxHoldingPct
  );

  if (totalTrimmedPercent > 0) {
    suggestedTrades.push({
      action: 'BUY',
      estimatedValue: roundMoney((totalPortfolioValue * totalTrimmedPercent) / 100),
      fromPercent: 0,
      name: 'Diversified ETF basket',
      rationale:
        'Reallocate trimmed concentration into diversified sleeves (read-only preview).',
      symbol: 'DIVERSIFIED_BASKET',
      toPercent: roundTwo(totalTrimmedPercent),
      tradePercent: roundTwo(totalTrimmedPercent)
    });
  }

  const currentPercents = holdingSnapshots.map((holding) => holding.currentPercent);
  const projectedPercents = [...projectedHoldingPercents, ...syntheticSleeves];

  const currentHhi = computeHerfindahlIndex(currentPercents);
  const projectedHhi = computeHerfindahlIndex(projectedPercents);
  const currentTopHoldingPct = roundTwo(Math.max(...currentPercents));
  const projectedTopHoldingPct = roundTwo(Math.max(...projectedPercents));
  const concentrationReductionPct =
    currentHhi > 0
      ? roundTwo(((currentHhi - projectedHhi) / currentHhi) * 100)
      : 0;

  return attachVerification({
    assumptions: {
      excludedSymbols,
      methodology:
        'Trim holdings above target max and redistribute excess to diversified sleeves.',
      portfolioValue: totalPortfolioValue,
      rebalanceMode: 'read_only_preview',
      syntheticSleeveCount: syntheticSleeves.length,
      targetMaxHoldingPct
    },
    currentTopHoldings,
    projectedConcentration: {
      concentrationReductionPct,
      currentHerfindahlIndex: currentHhi,
      currentTopHoldingPct,
      projectedHerfindahlIndex: projectedHhi,
      projectedTopHoldingPct
    },
    suggestedTrades
  });
}
