import { PortfolioService } from '@ghostfolio/api/app/portfolio/portfolio.service';

import { Injectable } from '@nestjs/common';
import { traceable } from 'langsmith/traceable';

import { type ChatResponse, type ToolCallInfo } from '../agent.types';
import { AgentError, ErrorType } from '../errors/agent-error';
import { SessionMemoryService } from '../memory/session-memory.service';
import { type AgentToolExecutionMetric } from '../observability/observability.types';
import {
  complianceCheck,
  type ComplianceCheckOutput
} from '../tools/compliance-checker.tool';
import { marketDataFetch } from '../tools/market-data.tool';
import { portfolioRiskAnalysis } from '../tools/portfolio-analysis.tool';
import { scenarioAnalysis } from '../tools/scenario-analysis.tool';

const ESG_KEYWORDS = [
  'esg',
  'compliance',
  'compliant',
  'ethical',
  'sustainable',
  'fossil fuel',
  'weapons',
  'defense',
  'tobacco',
  'gambling',
  'controversial',
  'labor',
  'violation',
  'offender',
  'impact',
  'flagged',
  'score change',
  'sin stock',
  'green invest',
  'socially responsible'
];

const PORTFOLIO_KEYWORDS = [
  'portfolio',
  'concentration',
  'allocation',
  'diversif',
  'exposure',
  'exposed',
  'volatility',
  'risk',
  'sector',
  'sharpe',
  'benchmark',
  'correlation',
  'hedge',
  'position',
  'positions',
  'holdings',
  'asset class',
  'hhi',
  'herfindahl',
  'performed',
  'performance',
  'return',
  'invested'
];

const RISK_INTENT_KEYWORDS = [
  'risk',
  'risky',
  'volatility',
  'hedge',
  'position',
  'positions',
  'sector',
  'correlation',
  'sharpe',
  'benchmark',
  'concentration',
  'diversif',
  'hhi',
  'herfindahl',
  'allocation',
  'performance',
  'return',
  'high risk',
  'medium risk',
  'low risk'
];

const SCENARIO_KEYWORDS = [
  'basis points',
  'basis point',
  'bps',
  'breakeven',
  'drawdown',
  'expected shortfall',
  'market correction',
  'rate cut',
  'rate hike',
  'rate sensitivity',
  'scenario',
  'shortfall',
  'stress test',
  'value at risk',
  'var',
  'what if'
];

const COMMON_SYMBOL_FALSE_POSITIVES = new Set([
  'ADD',
  'A',
  'ABOUT',
  'ALL',
  'ABOVE',
  'AN',
  'AND',
  'ARE',
  'AS',
  'AT',
  'BE',
  'BUT',
  'BY',
  'CAN',
  'DATA',
  'DO',
  'ESG',
  'FOR',
  'GET',
  'GIVE',
  'GOT',
  'HAD',
  'HAS',
  'HE',
  'HOW',
  'I',
  'IF',
  'IN',
  'IS',
  'IT',
  'MARKET',
  'ME',
  'MY',
  'NO',
  'NOT',
  'OF',
  'ON',
  'OR',
  'PRICE',
  'QUOTE',
  'SHOW',
  'SO',
  'STOCK',
  'TELL',
  'THE',
  'TO',
  'UP',
  'VAR',
  'WAS',
  'WE',
  'WHAT'
]);

type ContinuationIntent = 'combined' | 'compliance' | 'portfolio' | 'scenario';

const CONTINUATION_PROMPTS: Record<ContinuationIntent, string> = {
  combined:
    'Show my overall portfolio risk level with rebalancing suggestions, and run ESG analysis with impact ranking plus score change if all flagged offenders are removed.',
  compliance:
    'Which flagged holdings have the biggest ESG impact, and what would my score be if all flagged offenders were removed?',
  portfolio:
    'What is my overall portfolio risk level, and what rebalancing suggestions should I consider?',
  scenario:
    'Run a scenario analysis with stress-test assumptions and summarize the key action to take.'
};

export function isEsgQuestion(message: string): boolean {
  const lower = message.toLowerCase();
  return ESG_KEYWORDS.some((keyword) => lower.includes(keyword));
}

export function isPortfolioQuestion(message: string): boolean {
  const lower = message.toLowerCase();
  return PORTFOLIO_KEYWORDS.some((keyword) => lower.includes(keyword));
}

function isRiskIntentQuestion(message: string): boolean {
  const lower = message.toLowerCase();
  return RISK_INTENT_KEYWORDS.some((keyword) => lower.includes(keyword));
}

export function isScenarioQuestion(message: string): boolean {
  const lower = message.toLowerCase();
  const lexicalMatch = SCENARIO_KEYWORDS.filter((keyword) => keyword !== 'var').some(
    (keyword) => lower.includes(keyword)
  );

  if (lexicalMatch) {
    return true;
  }

  return /\bvar\b|\bvalue at risk\b/i.test(message);
}

function roundTwo(value: number): number {
  return Math.round(value * 100) / 100;
}

function parseEsgIntent(message: string): {
  asksImpactRanking: boolean;
  asksRemovalScenario: boolean;
  asksRemoveAll: boolean;
  asksRemoveWorst: boolean;
} {
  const lower = message.toLowerCase();
  const asksImpactRanking =
    /(biggest|largest|worst|highest|most)/.test(lower) &&
    /(impact|offender|violation|flagged|negative)/.test(lower);
  const asksRemovalScenario =
    /(remove|removed|sell|sold|without|exclude)/.test(lower) &&
    /(offender|violation|flagged|score|them|all)/.test(lower);
  const asksRemoveAll =
    asksRemovalScenario &&
    /(all(\s+three)?\s+(violations|offenders)|all of them|them all|all flagged)/.test(
      lower
    );
  const asksRemoveWorst =
    asksRemovalScenario && /(worst|biggest|largest|top)/.test(lower);

  return {
    asksImpactRanking,
    asksRemovalScenario,
    asksRemoveAll,
    asksRemoveWorst
  };
}

export function detectCategoryFilter(message: string): string | undefined {
  const lower = message.toLowerCase();
  const categoryMap: Record<string, string> = {
    betting: 'gambling',
    casino: 'gambling',
    cigarette: 'tobacco',
    'fossil fuel': 'fossil_fuels',
    coal: 'fossil_fuels',
    defense: 'weapons_defense',
    energy: 'fossil_fuels',
    gambling: 'gambling',
    gas: 'fossil_fuels',
    labor: 'controversial_labor',
    military: 'weapons_defense',
    oil: 'fossil_fuels',
    smoking: 'tobacco',
    sweatshop: 'controversial_labor',
    tobacco: 'tobacco',
    weapon: 'weapons_defense'
  };

  for (const [keyword, category] of Object.entries(categoryMap)) {
    if (lower.includes(keyword)) {
      return category;
    }
  }

  return undefined;
}

@Injectable()
export class DeterministicAgentService {
  public constructor(
    private readonly portfolioService: PortfolioService,
    private readonly sessionMemory: SessionMemoryService
  ) {}

  public async chat(input: {
    message: string;
    requestId?: string;
    sessionId: string;
    userId: string;
  }): Promise<ChatResponse> {
    const startedAt = Date.now();
    const response = await this.chatImpl(input);

    const totalMs = Math.max(0, Date.now() - startedAt);
    const hasToolCalls = response.toolCalls.length > 0;
    const toolExecutions = this.deriveToolExecutions(response.toolCalls);

    return {
      ...response,
      telemetry: {
        latency: {
          reasoningMs: hasToolCalls ? 0 : totalMs,
          toolMs: hasToolCalls ? totalMs : 0
        },
        toolExecutions
      }
    };
  }

  private async chatImpl(input: {
    message: string;
    requestId?: string;
    sessionId: string;
    userId: string;
  }): Promise<ChatResponse> {
    const { message, sessionId, userId } = input;

    if (!message.trim()) {
      return {
        response: 'Please provide a message to get started.',
        sessionId,
        toolCalls: []
      };
    }

    const isEsg = isEsgQuestion(message);
    const isPortfolio = isPortfolioQuestion(message);
    const isScenario = isScenarioQuestion(message);

    if (isEsg && isScenario) {
      return this.handleCombinedScenarioAndComplianceQuestion(
        message,
        sessionId,
        userId,
        input.requestId
      );
    }

    if (isEsg && isRiskIntentQuestion(message)) {
      return this.handleCombinedRiskAndComplianceQuestion(
        message,
        sessionId,
        userId,
        input.requestId
      );
    }

    if (isEsg) {
      return this.handleComplianceQuestion(
        message,
        sessionId,
        userId,
        input.requestId
      );
    }

    if (isScenario) {
      return this.handleScenarioQuestion(
        message,
        sessionId,
        userId,
        input.requestId
      );
    }

    if (isPortfolio) {
      return this.handlePortfolioQuestion(
        message,
        sessionId,
        userId,
        input.requestId
      );
    }

    const continuationIntent = await this.resolveContinuationIntent(
      message,
      sessionId,
      userId
    );

    if (continuationIntent) {
      const continuationMessage = CONTINUATION_PROMPTS[continuationIntent];

      if (continuationIntent === 'combined') {
        return this.handleCombinedRiskAndComplianceQuestion(
          continuationMessage,
          sessionId,
          userId,
          input.requestId
        );
      }

      if (continuationIntent === 'compliance') {
        return this.handleComplianceQuestion(
          continuationMessage,
          sessionId,
          userId,
          input.requestId
        );
      }

      if (continuationIntent === 'scenario') {
        return this.handleScenarioQuestion(
          continuationMessage,
          sessionId,
          userId,
          input.requestId
        );
      }

      return this.handlePortfolioQuestion(
        continuationMessage,
        sessionId,
        userId,
        input.requestId
      );
    }

    const context = await this.resolveContext(message, sessionId, userId);
    const symbols = context.symbols;

    if (symbols.length === 0) {
      return {
        response:
          'I can help you with:\n' +
          '- ESG compliance check (ask about ESG, ethical investing, fossil fuels, etc.)\n' +
          '- Portfolio risk analysis (ask about concentration, allocation, or performance)\n' +
          '- Scenario analysis (ask about stress tests, shortfall, or rate sensitivity)\n' +
          '- Stock market data (include ticker symbols like AAPL, MSFT)\n\n' +
          'What would you like to know?',
        sessionId,
        toolCalls: []
      };
    }

    return this.handleMarketDataQuestion(symbols, sessionId, input.requestId);
  }

  private async handleMarketDataQuestion(
    symbols: string[],
    sessionId: string,
    requestId?: string
  ): Promise<ChatResponse> {
    const traceableMarketData = traceable(
      async (params: { symbols: string[] }): Promise<ChatResponse> => {
        return this.marketDataImpl(params.symbols, sessionId);
      },
      {
        metadata: {
          orchestrator: 'deterministic',
          request_id: requestId || 'unknown'
        },
        name: 'market_data_fetch',
        run_type: 'tool'
      }
    );

    return traceableMarketData({ symbols });
  }

  private async handleCombinedRiskAndComplianceQuestion(
    message: string,
    sessionId: string,
    userId: string,
    requestId?: string
  ): Promise<ChatResponse> {
    const [portfolioResult, complianceResult] = await Promise.all([
      this.handlePortfolioQuestion(message, sessionId, userId, requestId),
      this.handleComplianceQuestion(message, sessionId, userId, requestId)
    ]);

    const sections: string[] = [
      '### 🔎 Combined Portfolio Risk + ESG Review',
      '',
      portfolioResult.response,
      '',
      complianceResult.response
    ];
    const toolCalls = [
      ...portfolioResult.toolCalls,
      ...complianceResult.toolCalls
    ];
    const hasError = Boolean(portfolioResult.isError || complianceResult.isError);

    if (portfolioResult.isError) {
      sections.push(
        '',
        '⚠️ Portfolio risk analysis was partially unavailable for this run.'
      );
    }

    if (complianceResult.isError) {
      sections.push(
        '',
        '⚠️ ESG compliance analysis was partially unavailable for this run.'
      );
    }

    return {
      ...(hasError
        ? {
            errorType:
              portfolioResult.errorType ||
              complianceResult.errorType ||
              ErrorType.SERVICE,
            isError: true
          }
        : {}),
      response: sections.join('\n'),
      sessionId,
      toolCalls
    };
  }

  private async handleCombinedScenarioAndComplianceQuestion(
    message: string,
    sessionId: string,
    userId: string,
    requestId?: string
  ): Promise<ChatResponse> {
    const [scenarioResult, complianceResult] = await Promise.all([
      this.handleScenarioQuestion(message, sessionId, userId, requestId),
      this.handleComplianceQuestion(message, sessionId, userId, requestId)
    ]);

    const sections: string[] = [
      '### 🔎 Combined Scenario + ESG Review',
      '',
      scenarioResult.response,
      '',
      complianceResult.response
    ];
    const toolCalls = [...scenarioResult.toolCalls, ...complianceResult.toolCalls];
    const hasError = Boolean(scenarioResult.isError || complianceResult.isError);

    if (scenarioResult.isError) {
      sections.push('', '⚠️ Scenario analysis was partially unavailable for this run.');
    }

    if (complianceResult.isError) {
      sections.push(
        '',
        '⚠️ ESG compliance analysis was partially unavailable for this run.'
      );
    }

    return {
      ...(hasError
        ? {
            errorType:
              scenarioResult.errorType ||
              complianceResult.errorType ||
              ErrorType.SERVICE,
            isError: true
          }
        : {}),
      response: sections.join('\n'),
      sessionId,
      toolCalls
    };
  }

  private async handleScenarioQuestion(
    message: string,
    sessionId: string,
    userId: string,
    requestId?: string
  ): Promise<ChatResponse> {
    const traceableScenario = traceable(
      async (params: {
        message: string;
        sessionId: string;
        userId: string;
      }): Promise<ChatResponse> => {
        return this.scenarioImpl(params.message, params.sessionId, params.userId);
      },
      {
        metadata: {
          orchestrator: 'deterministic',
          request_id: requestId || 'unknown'
        },
        name: 'scenario_analysis',
        run_type: 'tool'
      }
    );

    return traceableScenario({ message, sessionId, userId });
  }

  private async scenarioImpl(
    message: string,
    sessionId: string,
    userId: string
  ): Promise<ChatResponse> {
    try {
      const result = await scenarioAnalysis(
        { message },
        this.portfolioService,
        userId
      );

      const toolCalls: ToolCallInfo[] = [
        {
          args: { message },
          name: 'scenario_analysis',
          result: JSON.stringify(result)
        }
      ];

      if (result.error) {
        return {
          errorType: ErrorType.SERVICE,
          isError: true,
          response: result.error,
          sessionId,
          toolCalls
        };
      }

      const parts: string[] = [
        '### 📉 Scenario Analysis',
        '',
        `- **Scenario type:** ${result.scenarioType.replace(/_/g, ' ')}`,
        `- **Estimated stress move:** ${result.estimates.expectedStressMovePercent}%`,
        `- **Estimated shortfall:** $${result.estimates.expectedShortfallAmount.toLocaleString(undefined, {
          maximumFractionDigits: 2,
          minimumFractionDigits: 2
        })}`,
        `- **Estimated VaR (95%):** ${result.estimates.var95Percent}%`,
        '',
        '### 🧩 Assumptions',
        '',
        `- **Synthetic beta:** ${result.assumptions.syntheticBeta}`,
        `- **Synthetic duration:** ${result.assumptions.syntheticDuration}`,
        `- **Volatility proxy:** ${result.assumptions.volatilityProxyPercent}%`
      ];

      if (typeof result.assumptions.marketDropPercent === 'number') {
        parts.push(
          `- **Market drop input:** ${result.assumptions.marketDropPercent}%`
        );
      }

      if (typeof result.assumptions.rateUpBps === 'number') {
        parts.push(`- **Rates up input:** ${result.assumptions.rateUpBps} bps`);
      }

      if (typeof result.assumptions.rateDownBps === 'number') {
        parts.push(`- **Rates down input:** ${result.assumptions.rateDownBps} bps`);
      }

      if (typeof result.estimates.rateUpImpactPercent === 'number') {
        parts.push(
          `- **Estimated impact if rates rise:** ${result.estimates.rateUpImpactPercent}%`
        );
      }

      if (typeof result.estimates.rateDownImpactPercent === 'number') {
        parts.push(
          `- **Estimated impact if rates fall:** +${Math.abs(result.estimates.rateDownImpactPercent)}%`
        );
      }

      parts.push('', '### 📌 Portfolio Context', '');
      parts.push(`- **Current value:** $${result.context.currentValue.toLocaleString()}`);
      parts.push(`- **Top holding weight:** ${result.context.topHoldingPercent}%`);
      parts.push(`- **HHI:** ${result.context.herfindahlIndex}`);
      parts.push(`- **Equity weight:** ${result.context.equityWeightPercent}%`);
      parts.push(`- **Bond weight:** ${result.context.bondWeightPercent}%`);

      return {
        response: parts.join('\n'),
        sessionId,
        toolCalls
      };
    } catch (err) {
      const classified =
        err instanceof AgentError
          ? err
          : new AgentError(
              ErrorType.SERVICE,
              'Unable to run scenario analysis. Please try again later.',
              true,
              err instanceof Error ? err : undefined
            );

      return {
        errorType: classified.type,
        isError: true,
        response: classified.userMessage,
        sessionId,
        toolCalls: []
      };
    }
  }

  private async marketDataImpl(
    symbols: string[],
    sessionId: string
  ): Promise<ChatResponse> {
    try {
      const marketData = await marketDataFetch({ symbols });
      const toolCalls: ToolCallInfo[] = [
        {
          args: { symbols },
          name: 'market_data_fetch',
          result: JSON.stringify(marketData)
        }
      ];

      const successParts: string[] = [];
      const failedSymbols: string[] = [];

      for (const symbol of symbols) {
        const data = marketData[symbol];

        if (data?.error) {
          failedSymbols.push(symbol);
          continue;
        }

        const priceStr = data?.price ? `$${data.price.toFixed(2)}` : 'N/A';
        const nameStr = data?.name ? ` (${data.name})` : '';
        successParts.push(`${symbol}${nameStr}: ${priceStr}`);
      }

      const parts: string[] = [...successParts];

      if (failedSymbols.length > 0) {
        const symbolList = failedSymbols.join(', ');

        if (failedSymbols.length === symbols.length) {
          parts.push(
            `I wasn't able to retrieve market data for ${symbolList} right now. ` +
              'The data provider may be temporarily unavailable — please try again in a moment.'
          );
        } else {
          parts.push(
            `\nNote: I couldn't fetch data for ${symbolList} at this time. ` +
              'The data provider may be temporarily unavailable for these symbols.'
          );
        }
      }

      const allFailed =
        failedSymbols.length > 0 && failedSymbols.length === symbols.length;

      return {
        ...(allFailed && { errorType: ErrorType.DATA, isError: true }),
        response: parts.join('\n'),
        sessionId,
        toolCalls
      };
    } catch (err) {
      const classified =
        err instanceof AgentError
          ? err
          : new AgentError(
              ErrorType.DATA,
              'Failed to fetch market data. Please try again later.',
              true,
              err instanceof Error ? err : undefined
            );

      console.error(`[agent] ${classified.type} error:`, classified.userMessage);

      return {
        errorType: classified.type,
        isError: true,
        response: classified.userMessage,
        sessionId,
        toolCalls: []
      };
    }
  }

  private async handleComplianceQuestion(
    message: string,
    sessionId: string,
    userId: string,
    requestId?: string
  ): Promise<ChatResponse> {
    const traceableCompliance = traceable(
      async (params: {
        message: string;
        sessionId: string;
        userId: string;
      }): Promise<ChatResponse> => {
        return this.complianceImpl(params.message, params.sessionId, params.userId);
      },
      {
        metadata: {
          orchestrator: 'deterministic',
          request_id: requestId || 'unknown'
        },
        name: 'compliance_check',
        run_type: 'tool'
      }
    );

    return traceableCompliance({ message, sessionId, userId });
  }

  private async complianceImpl(
    message: string,
    sessionId: string,
    userId: string
  ): Promise<ChatResponse> {
    let holdings: Record<string, any>;

    try {
      const details = await this.portfolioService.getDetails({
        dateRange: 'max' as any,
        filters: [],
        impersonationId: undefined,
        userId,
        withSummary: false
      });

      holdings = details.holdings || {};
    } catch {
      return {
        errorType: ErrorType.SERVICE,
        isError: true,
        response:
          'Unable to check portfolio compliance — portfolio service unavailable.',
        sessionId,
        toolCalls: []
      };
    }

    const holdingInputs = Object.entries(holdings).map(
      ([symbol, data]: [string, any]) => ({
        name: data.name || symbol,
        symbol,
        valueInBaseCurrency: data.valueInBaseCurrency || 0
      })
    );

    if (holdingInputs.length === 0) {
      return {
        response: 'No holdings found in portfolio — nothing to check.',
        sessionId,
        toolCalls: []
      };
    }

    const filterCategory = detectCategoryFilter(message);
    const requestedSymbols = this.extractExplicitHoldingSymbols(message);
    const scopedHoldings =
      requestedSymbols.length > 0
        ? holdingInputs.filter((holding) => {
            const symbol = String(holding.symbol || '').toUpperCase();
            const name = String(holding.name || '').toUpperCase();

            return (
              requestedSymbols.includes(symbol) || requestedSymbols.includes(name)
            );
          })
        : holdingInputs;

    const result = await complianceCheck({
      filterCategory,
      holdings: scopedHoldings,
      ...(requestedSymbols.length > 0 ? { requestedSymbols } : {})
    });

    const toolCalls: ToolCallInfo[] = [
      {
        args: {
          filterCategory: filterCategory || 'all',
          ...(requestedSymbols.length > 0 ? { symbols: requestedSymbols } : {})
        },
        name: 'compliance_check',
        result: JSON.stringify(result)
      }
    ];

    const parts = this.buildComplianceResponseParts(
      message,
      scopedHoldings,
      result,
      filterCategory,
      requestedSymbols
    );

    return {
      response: parts.join('\n'),
      sessionId,
      toolCalls
    };
  }

  private async handlePortfolioQuestion(
    message: string,
    sessionId: string,
    userId: string,
    requestId?: string
  ): Promise<ChatResponse> {
    const traceablePortfolio = traceable(
      async (params: {
        message: string;
        sessionId: string;
        userId: string;
      }): Promise<ChatResponse> => {
        return this.portfolioImpl(params.message, params.sessionId, params.userId);
      },
      {
        metadata: {
          orchestrator: 'deterministic',
          request_id: requestId || 'unknown'
        },
        name: 'portfolio_risk_analysis',
        run_type: 'tool'
      }
    );

    return traceablePortfolio({ message, sessionId, userId });
  }

  private async portfolioImpl(
    message: string,
    sessionId: string,
    userId: string
  ): Promise<ChatResponse> {
    try {
      const result = await portfolioRiskAnalysis(
        {},
        this.portfolioService,
        userId
      );

      const toolCalls: ToolCallInfo[] = [
        {
          args: { message },
          name: 'portfolio_risk_analysis',
          result: JSON.stringify(result)
        }
      ];

      if (result.error) {
        return {
          errorType: ErrorType.SERVICE,
          isError: true,
          response: result.error,
          sessionId,
          toolCalls
        };
      }

      const parts: string[] = [];
      const formatNumber = (value: number) => {
        return value.toLocaleString(undefined, {
          maximumFractionDigits: 2,
          minimumFractionDigits: 2
        });
      };

      const concentration = result.concentration;
      parts.push('### 📊 Portfolio Risk Overview');
      parts.push('');
      parts.push(
        `- **Top holding:** ${concentration.topHoldingSymbol} at ${concentration.topHoldingPercent}%`
      );
      parts.push(`- **Diversification:** ${concentration.diversificationLevel}`);
      parts.push(
        `- **Overall risk level:** ${this.classifyRiskLevel(
          concentration.herfindahlIndex,
          concentration.topHoldingPercent
        )}`
      );

      if (concentration.topHoldings.length > 1) {
        parts.push('');
        parts.push('**Top Holdings**');
        parts.push('');

        for (const holding of concentration.topHoldings) {
          const label =
            holding.symbol === holding.name
              ? holding.name
              : `${holding.symbol} — ${holding.name}`;

          parts.push(`- ${label}: **${holding.percentage}%**`);
        }
      }

      parts.push('');
      parts.push('### 📈 Asset Allocation');
      parts.push('');

      for (const [assetClass, percentage] of Object.entries(
        result.allocation.byAssetClass
      )) {
        parts.push(`- ${assetClass}: **${percentage}%**`);
      }

      const performance = result.performance;
      const sign = performance.totalReturn >= 0 ? '+' : '';
      parts.push('');
      parts.push('### 💰 Performance Summary');
      parts.push('');
      parts.push(`- **Current value:** $${formatNumber(performance.currentValue)}`);
      parts.push(`- **Total invested:** $${formatNumber(performance.totalInvestment)}`);
      parts.push(
        `- **Total return:** ${sign}$${formatNumber(performance.totalReturn)} (${sign}${performance.totalReturnPercent}%)`
      );
      parts.push('');
      parts.push(`*${result.holdingsCount} holdings analyzed*`);

      const unsupportedRequests = this.detectUnsupportedPortfolioRequests(message);
      if (unsupportedRequests.length > 0) {
        parts.push('');
        parts.push('### ⚠️ Capability Note');
        parts.push('');
        parts.push(
          `- I cannot directly compute **${unsupportedRequests.join(
            ', '
          )}** from the current portfolio tool output.`
        );
        parts.push(
          '- Closest available analysis: concentration, diversification, asset-class allocation, and realized performance from your live portfolio snapshot.'
        );
      }

      if (this.shouldIncludeRebalancingGuidance(message)) {
        const topHolding = concentration.topHoldings[0];
        const secondHolding = concentration.topHoldings[1];

        parts.push('');
        parts.push('### 🧭 Rebalancing Suggestions');
        parts.push('');

        if (topHolding) {
          parts.push(
            `- Consider trimming **${topHolding.symbol}** closer to 15% to reduce single-position concentration risk.`
          );
        }

        if (topHolding && secondHolding) {
          const combinedTopTwo = roundTwo(
            topHolding.percentage + secondHolding.percentage
          );
          parts.push(
            `- Keep your top 2 holdings near or below ~35% combined (currently about ${combinedTopTwo}%).`
          );
        }

        parts.push(
          '- Reallocate gradual reductions into broader diversified funds to smooth concentration risk.'
        );
        parts.push(
          '- If ESG alignment matters, prioritize reducing high-severity offenders first before adding new exposure.'
        );
      }

      return {
        response: parts.join('\n'),
        sessionId,
        toolCalls
      };
    } catch (err) {
      const classified =
        err instanceof AgentError
          ? err
          : new AgentError(
              ErrorType.SERVICE,
              'Unable to access portfolio data. Please try again later.',
              true,
              err instanceof Error ? err : undefined
            );

      console.error(`[agent] ${classified.type} error:`, classified.userMessage);

      return {
        errorType: classified.type,
        isError: true,
        response: classified.userMessage,
        sessionId,
        toolCalls: []
      };
    }
  }

  private async resolveContext(
    message: string,
    sessionId: string,
    userId: string
  ): Promise<{ symbols: string[]; tool: string | null }> {
    const recentContext = await this.sessionMemory.getLatestMarketContext(
      userId,
      sessionId
    );

    const followUpMatch =
      message.match(/(?:what|how)\s+about\s+([A-Z]{1,12})\b/i) ||
      message.match(/\band\s+([A-Z]{1,12})\b/i);

    if (followUpMatch) {
      const newSymbol = followUpMatch[1].toUpperCase();
      if (
        recentContext.hasHistory &&
        !COMMON_SYMBOL_FALSE_POSITIVES.has(newSymbol)
      ) {
        return { symbols: [newSymbol], tool: recentContext.lastTool };
      }
    }

    const extracted = this.extractSymbols(message);

    if (
      extracted.length === 0 &&
      !isEsgQuestion(message) &&
      !isPortfolioQuestion(message) &&
      !isScenarioQuestion(message)
    ) {
      if (recentContext.hasHistory && recentContext.lastSymbols.length > 0) {
        return {
          symbols: recentContext.lastSymbols,
          tool: recentContext.lastTool
        };
      }
    }

    return { symbols: extracted, tool: null };
  }

  private extractSymbols(message: string): string[] {
    const symbolPattern = /\b([A-Z]{1,12})\b/g;
    const potentialSymbols: string[] = message.match(symbolPattern) || [];

    return Array.from(
      new Set(
        potentialSymbols.filter(
          (symbol) =>
            !COMMON_SYMBOL_FALSE_POSITIVES.has(symbol) && symbol.length >= 2
        )
      )
    );
  }

  private extractExplicitHoldingSymbols(message: string): string[] {
    const directMatches = this.extractSymbols(message).filter((symbol) => {
      return symbol.length <= 5;
    });

    const byPrefix = Array.from(
      message.matchAll(/\b(?:ticker|symbol|holdings?)\s*[:\-]?\s*([A-Z]{2,5})\b/gi)
    ).map((match) => String(match[1] || '').toUpperCase());

    return Array.from(new Set([...directMatches, ...byPrefix])).filter((symbol) => {
      return !COMMON_SYMBOL_FALSE_POSITIVES.has(symbol);
    });
  }

  private isShortAffirmation(message: string): boolean {
    const normalized = message
      .trim()
      .toLowerCase()
      .replace(/[^a-z\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const patterns = [
      /^(yes|yeah|yep|sure|ok|okay|please do|go ahead)$/i,
      /^(both|both please|both of the above|all of the above|do both)$/i
    ];

    return (
      normalized.length > 0 &&
      normalized.length <= 40 &&
      patterns.some((pattern) => pattern.test(normalized))
    );
  }

  private async resolveContinuationIntent(
    message: string,
    sessionId: string,
    userId: string
  ): Promise<ContinuationIntent | null> {
    if (!this.isShortAffirmation(message)) {
      return null;
    }

    const context = await this.sessionMemory.getConversationContext(
      userId,
      sessionId
    );

    if (context.recentMessages.length === 0) {
      return null;
    }

    const normalized = message.trim().toLowerCase();
    const wantsBoth =
      /\bboth\b/.test(normalized) || /all of the above/.test(normalized);

    const recentMessages = [...context.recentMessages];
    const lastAssistant = recentMessages
      .slice()
      .reverse()
      .find((entry) => entry.role === 'assistant');
    const lastUser = recentMessages
      .slice()
      .reverse()
      .find((entry) => entry.role === 'user');
    const continuationContextText = [
      lastAssistant?.content || '',
      lastUser?.content || ''
    ]
      .join('\n')
      .toLowerCase();
    const assistantText = (lastAssistant?.content || '').toLowerCase();

    const assistantMentionsEsg =
      /(esg|offender|compliance|score)/.test(continuationContextText);
    const assistantMentionsRisk =
      /(risk|rebalanc|portfolio|concentration|exposure|volatility|hedge)/.test(
        continuationContextText
      );
    const assistantMentionsScenario =
      /(scenario|stress|shortfall|drawdown|basis points?|bps|rate|duration|var|value at risk)/.test(
        continuationContextText
      );
    const assistantAskedChoice =
      /(did you mean|both of the above|all of the above|would you like|choose|clarification|are you asking)/.test(
        continuationContextText
      );
    const assistantOfferedFollowUp =
      /\b(should i|would you like|do you want|shall i|proceed|next step|go ahead)\b/.test(
        assistantText
      ) || assistantText.includes('?');

    if (assistantAskedChoice && assistantMentionsEsg && assistantMentionsRisk) {
      if (wantsBoth || this.isShortAffirmation(message)) {
        return 'combined';
      }
    }

    const recentUserMessages = recentMessages
      .filter((entry) => entry.role === 'user')
      .slice(-3)
      .map((entry) => entry.content.toLowerCase());

    if (
      recentUserMessages.some((entry) => {
        return isEsgQuestion(entry) && isRiskIntentQuestion(entry);
      })
    ) {
      return 'combined';
    }

    if (assistantMentionsEsg && wantsBoth) {
      return assistantMentionsRisk ? 'combined' : 'compliance';
    }

    if (assistantMentionsRisk && wantsBoth) {
      return 'combined';
    }

    if (assistantOfferedFollowUp && assistantMentionsScenario) {
      return 'scenario';
    }

    if (assistantOfferedFollowUp && assistantMentionsEsg && assistantMentionsRisk) {
      return 'combined';
    }

    if (assistantOfferedFollowUp && assistantMentionsEsg) {
      return 'compliance';
    }

    if (assistantOfferedFollowUp && assistantMentionsRisk) {
      return 'portfolio';
    }

    return null;
  }

  private deriveToolExecutions(
    toolCalls: ToolCallInfo[]
  ): AgentToolExecutionMetric[] {
    return toolCalls.map((toolCall) => {
      let parsed: unknown;
      let parseFailed = false;

      try {
        parsed = JSON.parse(toolCall.result);
      } catch {
        parseFailed = true;
      }

      const payloadFailed = parseFailed
        ? true
        : this.isToolCallFailurePayload(parsed);

      return {
        errorType: payloadFailed ? ErrorType.TOOL : undefined,
        latencyMs: 0,
        name: toolCall.name,
        success: !payloadFailed
      };
    });
  }

  private isToolCallFailurePayload(payload: unknown): boolean {
    if (!payload || typeof payload !== 'object') {
      return false;
    }

    if ('error' in (payload as Record<string, unknown>)) {
      const error = (payload as Record<string, unknown>).error;
      if (typeof error === 'string' && error.trim().length > 0) {
        return true;
      }
    }

    const values = Object.values(payload as Record<string, unknown>);
    if (values.length === 0) {
      return false;
    }

    const everyValueErrored = values.every((value) => {
      if (!value || typeof value !== 'object') {
        return false;
      }

      const error = (value as Record<string, unknown>).error;
      return typeof error === 'string' && error.trim().length > 0;
    });

    return everyValueErrored;
  }

  private detectUnsupportedPortfolioRequests(message: string): string[] {
    const lower = message.toLowerCase();
    const requested: string[] = [];

    if (/(sharpe|sortino)/.test(lower)) {
      requested.push('Sharpe/Sortino ratio');
    }

    if (/(correlation|benchmark|s&p|sp500|\bbeta\b)/.test(lower)) {
      requested.push('benchmark correlation/beta');
    }

    if (
      /(expected return|projected return|forecast|forward return|recovery timeline|recover.*return)/.test(
        lower
      )
    ) {
      requested.push('forward return projection');
    }

    if (/(sector allocation|sector breakdown|sector exposure)/.test(lower)) {
      requested.push('sector-level allocation');
    }

    return Array.from(new Set(requested));
  }

  private shouldIncludeRebalancingGuidance(message: string): boolean {
    const lower = message.toLowerCase();

    return /(rebalanc|redistribut|rebalance|suggestion|optimi[sz]e)/.test(lower);
  }

  private buildComplianceResponseParts(
    message: string,
    holdingInputs: {
      symbol: string;
      name: string;
      valueInBaseCurrency: number;
    }[],
    result: ComplianceCheckOutput,
    filterCategory?: string,
    requestedSymbols: string[] = []
  ): string[] {
    const parts: string[] = [];
    const filterLabel = filterCategory
      ? ` (${filterCategory.replace(/_/g, ' ')})`
      : '';
    const intent = parseEsgIntent(message);
    const hasViolations = result.violations.length > 0;
    const ranking = [...result.violations].sort(
      (left, right) => right.valueInBaseCurrency - left.valueInBaseCurrency
    );
    const totalValue = holdingInputs.reduce((sum, holding) => {
      return sum + holding.valueInBaseCurrency;
    }, 0);
    const violatedValue = ranking.reduce((sum, violation) => {
      return sum + violation.valueInBaseCurrency;
    }, 0);

    parts.push(`### 🌱 ESG Compliance Report${filterLabel}`);
    parts.push('');
    parts.push(`- **Compliance Score:** ${result.complianceScore}%`);
    parts.push(`- **Holdings checked:** ${result.totalChecked}`);
    parts.push(
      `- **Source:** ESG Violations Dataset v${result.datasetVersion} (${result.datasetLastUpdated})`
    );

    if (requestedSymbols.length > 0) {
      const matched = result.matchedSymbols || [];
      const unmatched = result.unmatchedSymbols || [];

      parts.push(
        `- **Requested holdings:** ${requestedSymbols.join(', ')}`
      );
      parts.push(
        `- **Matched in portfolio:** ${matched.length > 0 ? matched.join(', ') : 'none'}`
      );

      if (unmatched.length > 0) {
        parts.push(`- **Not found:** ${unmatched.join(', ')}`);
      }
    }

    if (!hasViolations) {
      parts.push('');
      parts.push('✅ No ESG violations found in your portfolio.');
      return parts;
    }

    if (intent.asksImpactRanking) {
      const topViolation = ranking[0];
      const impactPoints =
        totalValue <= 0
          ? 0
          : roundTwo((topViolation.valueInBaseCurrency / totalValue) * 100);

      parts.push('');
      parts.push('### 📉 ESG Impact Ranking');
      parts.push('');
      parts.push(
        `- **Biggest negative impact:** ${topViolation.name} (about ${impactPoints} score points).`
      );
      parts.push('');

      for (const [index, violation] of ranking.entries()) {
        const portfolioShare =
          totalValue <= 0
            ? 0
            : roundTwo((violation.valueInBaseCurrency / totalValue) * 100);
        parts.push(
          `${index + 1}. ${violation.name} — ${portfolioShare}% of portfolio value`
        );
      }
    }

    if (intent.asksRemovalScenario) {
      const removedSet = intent.asksRemoveAll
        ? ranking
        : intent.asksRemoveWorst
          ? ranking.slice(0, 1)
          : [];
      const removedValue = removedSet.reduce((sum, violation) => {
        return sum + violation.valueInBaseCurrency;
      }, 0);
      const nextViolatedValue = Math.max(0, violatedValue - removedValue);
      const hypotheticalScore =
        totalValue <= 0
          ? 100
          : roundTwo(((totalValue - nextViolatedValue) / totalValue) * 100);
      const delta = roundTwo(hypotheticalScore - result.complianceScore);

      parts.push('');
      parts.push('### 🧮 Hypothetical Scenario');
      parts.push('');

      if (removedSet.length === 0) {
        parts.push(
          '- I can recalculate scenarios for removing the worst offender or all flagged offenders.'
        );
      } else {
        const removedNames = removedSet.map((violation) => violation.name).join(', ');
        parts.push(
          `- If removed (${removedNames}), your estimated compliance score would be **${hypotheticalScore}%** (${delta >= 0 ? '+' : ''}${delta} points).`
        );
      }
    }

    if (!intent.asksImpactRanking && !intent.asksRemovalScenario) {
      parts.push('');
      parts.push('### ⚠️ Violations Found');
      parts.push('');

      for (const violation of ranking) {
        const categories = violation.categories.join(', ').replace(/_/g, ' ');
        parts.push(
          `- **${violation.name}** — ${categories} [${violation.severity}]: ${violation.reason}`
        );
      }

      if (result.cleanHoldings.length > 0) {
        parts.push('');
        parts.push('### ✅ Clean Holdings');
        parts.push('');

        for (const holding of result.cleanHoldings) {
          parts.push(`- ${holding.name}`);
        }
      }
    }

    return parts;
  }

  private classifyRiskLevel(
    herfindahlIndex: number,
    topHoldingPercent: number
  ): 'High' | 'Low' | 'Medium' {
    if (herfindahlIndex >= 0.35 || topHoldingPercent >= 35) {
      return 'High';
    }

    if (herfindahlIndex >= 0.2 || topHoldingPercent >= 20) {
      return 'Medium';
    }

    return 'Low';
  }
}
