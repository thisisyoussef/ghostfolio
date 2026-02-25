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
import { portfolioRiskAnalysis } from './portfolio-analysis.tool';

export interface ScenarioAnalysisInput {
  message?: string;
  marketDropPercent?: number;
  rateDownBps?: number;
  rateUpBps?: number;
}

export interface ScenarioAnalysisOutput {
  scenarioType: 'breakeven' | 'market_stress' | 'rate_sensitivity' | 'stress';
  assumptions: {
    marketDropPercent?: number;
    rateDownBps?: number;
    rateUpBps?: number;
    syntheticBeta: number;
    syntheticDuration: number;
    volatilityProxyPercent: number;
  };
  estimates: {
    expectedShortfallAmount: number;
    expectedStressMovePercent: number;
    rateDownImpactPercent?: number;
    rateUpImpactPercent?: number;
    var95Percent: number;
  };
  context: {
    bondWeightPercent: number;
    currentValue: number;
    equityWeightPercent: number;
    herfindahlIndex: number;
    topHoldingPercent: number;
  };
  sourceAttribution?: VerificationSourceAttribution;
  verification?: VerificationSummary;
  error?: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundTwo(value: number): number {
  return Math.round(value * 100) / 100;
}

function parseRateBps(
  message: string,
  direction: 'down' | 'up'
): number | undefined {
  const lower = message.toLowerCase();

  const direct =
    direction === 'up'
      ? /(?:up|rise|increase|hike)[^\d]{0,24}(\d{1,4})\s*(?:bps|basis points?)/i
      : /(?:down|fall|decrease|cut)[^\d]{0,24}(\d{1,4})\s*(?:bps|basis points?)/i;

  const firstMatch = lower.match(direct);
  if (firstMatch?.[1]) {
    return Number(firstMatch[1]);
  }

  return undefined;
}

function parseMarketDropPercent(message: string): number | undefined {
  const lower = message.toLowerCase();

  const patternA =
    /(\d+(?:\.\d+)?)\s*%\s*(?:market\s*)?(?:drop|decline|correction|fall|down)/i;
  const patternB =
    /(?:drop|decline|correction|fall|down)\s*(?:of|by)?\s*(\d+(?:\.\d+)?)\s*%/i;

  const match = lower.match(patternA) || lower.match(patternB);

  if (!match?.[1]) {
    return undefined;
  }

  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) {
    return undefined;
  }

  return value;
}

function detectScenarioType(
  message: string
): 'breakeven' | 'market_stress' | 'rate_sensitivity' | 'stress' {
  const lower = message.toLowerCase();

  if (/(breakeven|break-even)/.test(lower)) {
    return 'breakeven';
  }

  if (/(bps|basis points|rate hike|rate cut|rate[s]? (up|down))/i.test(lower)) {
    return 'rate_sensitivity';
  }

  if (/(shortfall|stress test|market correction|drop \d+%|decline \d+%)/i.test(lower)) {
    return 'market_stress';
  }

  return 'stress';
}

function safePercentByKey(
  map: Record<string, number>,
  patterns: RegExp[]
): number {
  let total = 0;

  for (const [key, value] of Object.entries(map)) {
    if (patterns.some((pattern) => pattern.test(key))) {
      total += Number.isFinite(value) ? value : 0;
    }
  }

  return roundTwo(total);
}

function buildEmptyOutput(error: string): ScenarioAnalysisOutput {
  return {
    scenarioType: 'stress',
    assumptions: {
      syntheticBeta: 1,
      syntheticDuration: 3,
      volatilityProxyPercent: 15
    },
    estimates: {
      expectedShortfallAmount: 0,
      expectedStressMovePercent: 0,
      var95Percent: 0
    },
    context: {
      bondWeightPercent: 0,
      currentValue: 0,
      equityWeightPercent: 0,
      herfindahlIndex: 0,
      topHoldingPercent: 0
    },
    error
  };
}

function hasValidOutput(output: ScenarioAnalysisOutput): boolean {
  return (
    typeof output.scenarioType === 'string' &&
    typeof output.assumptions.syntheticBeta === 'number' &&
    typeof output.assumptions.syntheticDuration === 'number' &&
    typeof output.assumptions.volatilityProxyPercent === 'number' &&
    typeof output.estimates.expectedShortfallAmount === 'number' &&
    typeof output.estimates.expectedStressMovePercent === 'number' &&
    typeof output.estimates.var95Percent === 'number' &&
    typeof output.context.currentValue === 'number'
  );
}

function attachVerification(
  output: ScenarioAnalysisOutput
): ScenarioAnalysisOutput {
  const sourceAttribution = toSourceAttribution({
    primarySource: 'Ghostfolio PortfolioService + deterministic scenario model'
  });

  const outputSchemaPassed = hasValidOutput(output);
  const sourceAttributionPassed = hasValidSourceAttribution(sourceAttribution);

  const checks = {
    outputSchema: {
      passed: outputSchemaPassed,
      reason: outputSchemaPassed
        ? undefined
        : 'Scenario analysis output schema is invalid.'
    },
    sourceAttribution: {
      passed: sourceAttributionPassed,
      reason: sourceAttributionPassed
        ? undefined
        : 'Source attribution must include source and timestamp.'
    },
    assumptionsBounded: {
      passed:
        output.assumptions.syntheticBeta >= 0.5 &&
        output.assumptions.syntheticBeta <= 2.5 &&
        output.assumptions.syntheticDuration >= 0.5 &&
        output.assumptions.syntheticDuration <= 10,
      reason:
        output.assumptions.syntheticBeta >= 0.5 &&
        output.assumptions.syntheticBeta <= 2.5 &&
        output.assumptions.syntheticDuration >= 0.5 &&
        output.assumptions.syntheticDuration <= 10
          ? undefined
          : 'Scenario assumptions fell outside expected bounds.'
    }
  };

  const verification = buildVerificationSummary({
    checks,
    sources: attributionToSources({
      attribution: sourceAttribution,
      tool: 'scenario_analysis',
      primaryClaim: 'scenario stress and shortfall estimates'
    }),
    flags: {
      hardError: !!output.error,
      outputSchemaFailed: !outputSchemaPassed,
      sourceAttributionFailed: !sourceAttributionPassed
    }
  });

  return {
    ...output,
    sourceAttribution,
    verification
  };
}

export async function scenarioAnalysis(
  input: ScenarioAnalysisInput,
  portfolioService: any,
  userId: string
): Promise<ScenarioAnalysisOutput> {
  if (!userId) {
    return attachVerification(
      buildEmptyOutput('No authenticated user — unable to run scenario analysis.')
    );
  }

  const portfolio = await portfolioRiskAnalysis({}, portfolioService, userId);

  if (portfolio.error) {
    return attachVerification(buildEmptyOutput(portfolio.error));
  }

  const message = String(input.message || '');
  const scenarioType = detectScenarioType(message);

  const byAssetClass = portfolio.allocation.byAssetClass || {};
  const normalizedClassMap = Object.fromEntries(
    Object.entries(byAssetClass).map(([key, value]) => [
      key.toLowerCase(),
      Number(value)
    ])
  );

  const equityWeight = safePercentByKey(normalizedClassMap, [
    /equity/,
    /stock/,
    /^other$/
  ]);
  const bondWeight = safePercentByKey(normalizedClassMap, [/debt/, /bond/, /fixed/]);

  const topHoldingPercent = portfolio.concentration.topHoldingPercent || 0;
  const hhi = portfolio.concentration.herfindahlIndex || 0;
  const currentValue = portfolio.performance.currentValue || 0;

  const syntheticBeta = clamp(0.7 + hhi * 1.2 + topHoldingPercent / 100, 0.6, 2.2);
  const syntheticDuration = clamp(1.5 + (bondWeight / 100) * 6, 1, 8);
  const volatilityProxyPercent = clamp(
    8 + hhi * 45 + topHoldingPercent * 0.15,
    6,
    40
  );

  const marketDropPercent =
    input.marketDropPercent ??
    parseMarketDropPercent(message) ??
    (/(stress|shortfall|correction|drawdown)/i.test(message) ? 20 : undefined);
  const rateUpBps = input.rateUpBps ?? parseRateBps(message, 'up');
  const rateDownBps = input.rateDownBps ?? parseRateBps(message, 'down');

  const expectedStressMovePercent = roundTwo(
    (marketDropPercent || 0) * syntheticBeta
  );
  const expectedShortfallAmount = roundMoney(
    (currentValue * expectedStressMovePercent) / 100
  );
  const var95Percent = roundTwo(volatilityProxyPercent * 1.65);

  const rateUpImpactPercent =
    typeof rateUpBps === 'number'
      ? roundTwo(-((syntheticDuration * rateUpBps) / 100))
      : undefined;
  const rateDownImpactPercent =
    typeof rateDownBps === 'number'
      ? roundTwo((syntheticDuration * rateDownBps) / 100)
      : undefined;

  return attachVerification({
    scenarioType,
    assumptions: {
      ...(marketDropPercent ? { marketDropPercent } : {}),
      ...(typeof rateDownBps === 'number' ? { rateDownBps } : {}),
      ...(typeof rateUpBps === 'number' ? { rateUpBps } : {}),
      syntheticBeta: roundTwo(syntheticBeta),
      syntheticDuration: roundTwo(syntheticDuration),
      volatilityProxyPercent: roundTwo(volatilityProxyPercent)
    },
    estimates: {
      expectedShortfallAmount,
      expectedStressMovePercent,
      ...(typeof rateDownImpactPercent === 'number'
        ? { rateDownImpactPercent }
        : {}),
      ...(typeof rateUpImpactPercent === 'number' ? { rateUpImpactPercent } : {}),
      var95Percent
    },
    context: {
      bondWeightPercent: roundTwo(bondWeight),
      currentValue: roundMoney(currentValue),
      equityWeightPercent: roundTwo(equityWeight),
      herfindahlIndex: roundTwo(hhi),
      topHoldingPercent: roundTwo(topHoldingPercent)
    }
  });
}
