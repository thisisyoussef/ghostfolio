import { PortfolioService } from '@ghostfolio/api/app/portfolio/portfolio.service';

import { Injectable } from '@nestjs/common';
import { traceable } from 'langsmith/traceable';

import { type ChatResponse, type ToolCallInfo } from '../agent.types';
import { AgentError, ErrorType } from '../errors/agent-error';
import { SessionMemoryService } from '../memory/session-memory.service';
import { complianceCheck } from '../tools/compliance-checker.tool';
import { marketDataFetch } from '../tools/market-data.tool';
import { portfolioRiskAnalysis } from '../tools/portfolio-analysis.tool';

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
  'sin stock',
  'green invest',
  'socially responsible'
];

const PORTFOLIO_KEYWORDS = [
  'portfolio',
  'concentration',
  'allocation',
  'diversif',
  'risk',
  'holdings',
  'asset class',
  'hhi',
  'herfindahl',
  'performed',
  'performance',
  'return',
  'invested'
];

const COMMON_SYMBOL_FALSE_POSITIVES = new Set([
  'A',
  'ABOUT',
  'ALL',
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
  'WAS',
  'WE',
  'WHAT'
]);

export function isEsgQuestion(message: string): boolean {
  const lower = message.toLowerCase();
  return ESG_KEYWORDS.some((keyword) => lower.includes(keyword));
}

export function isPortfolioQuestion(message: string): boolean {
  const lower = message.toLowerCase();
  return PORTFOLIO_KEYWORDS.some((keyword) => lower.includes(keyword));
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

    if (isEsgQuestion(message)) {
      return this.handleComplianceQuestion(message, sessionId, userId);
    }

    if (isPortfolioQuestion(message)) {
      return this.handlePortfolioQuestion(message, sessionId, userId);
    }

    const context = await this.resolveContext(message, sessionId, userId);
    const symbols = context.symbols;

    if (symbols.length === 0) {
      return {
        response:
          'I can help you with:\n' +
          '- ESG compliance check (ask about ESG, ethical investing, fossil fuels, etc.)\n' +
          '- Portfolio risk analysis (ask about concentration, allocation, or performance)\n' +
          '- Stock market data (include ticker symbols like AAPL, MSFT)\n\n' +
          'What would you like to know?',
        sessionId,
        toolCalls: []
      };
    }

    return this.handleMarketDataQuestion(symbols, sessionId);
  }

  private async handleMarketDataQuestion(
    symbols: string[],
    sessionId: string
  ): Promise<ChatResponse> {
    const traceableMarketData = traceable(
      async (params: { symbols: string[] }): Promise<ChatResponse> => {
        return this.marketDataImpl(params.symbols, sessionId);
      },
      { name: 'market_data_fetch', run_type: 'tool' }
    );

    return traceableMarketData({ symbols });
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
    userId: string
  ): Promise<ChatResponse> {
    const traceableCompliance = traceable(
      async (params: {
        message: string;
        sessionId: string;
        userId: string;
      }): Promise<ChatResponse> => {
        return this.complianceImpl(params.message, params.sessionId, params.userId);
      },
      { name: 'compliance_check', run_type: 'tool' }
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

    const result = await complianceCheck({
      filterCategory,
      holdings: holdingInputs
    });

    const toolCalls: ToolCallInfo[] = [
      {
        args: { filterCategory: filterCategory || 'all' },
        name: 'compliance_check',
        result: JSON.stringify(result)
      }
    ];

    const parts: string[] = [];
    const filterLabel = filterCategory
      ? ` (${filterCategory.replace(/_/g, ' ')})`
      : '';

    parts.push(`### 🌱 ESG Compliance Report${filterLabel}`);
    parts.push('');
    parts.push(`- **Compliance Score:** ${result.complianceScore}%`);
    parts.push(`- **Holdings checked:** ${result.totalChecked}`);
    parts.push(
      `- **Source:** ESG Violations Dataset v${result.datasetVersion} (${result.datasetLastUpdated})`
    );

    if (result.violations.length > 0) {
      parts.push('');
      parts.push('### ⚠️ Violations Found');
      parts.push('');

      for (const violation of result.violations) {
        const categories = violation.categories.join(', ').replace(/_/g, ' ');
        parts.push(
          `- **${violation.name}** — ${categories} [${violation.severity}]: ${violation.reason}`
        );
      }
    } else {
      parts.push('');
      parts.push('✅ No ESG violations found in your portfolio.');
    }

    if (result.cleanHoldings.length > 0 && result.violations.length > 0) {
      parts.push('');
      parts.push('### ✅ Clean Holdings');
      parts.push('');

      for (const holding of result.cleanHoldings) {
        parts.push(`- ${holding.name}`);
      }
    }

    return {
      response: parts.join('\n'),
      sessionId,
      toolCalls
    };
  }

  private async handlePortfolioQuestion(
    message: string,
    sessionId: string,
    userId: string
  ): Promise<ChatResponse> {
    const traceablePortfolio = traceable(
      async (params: {
        message: string;
        sessionId: string;
        userId: string;
      }): Promise<ChatResponse> => {
        return this.portfolioImpl(params.message, params.sessionId, params.userId);
      },
      { name: 'portfolio_risk_analysis', run_type: 'tool' }
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
      !isPortfolioQuestion(message)
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

    return potentialSymbols.filter(
      (symbol) =>
        !COMMON_SYMBOL_FALSE_POSITIVES.has(symbol) && symbol.length >= 2
    );
  }
}
