import { PortfolioService } from '@ghostfolio/api/app/portfolio/portfolio.service';

import { Injectable } from '@nestjs/common';

import { AgentError, ErrorType } from './errors/agent-error';
import { SessionMemoryService } from './memory/session-memory.service';
import { complianceCheck } from './tools/compliance-checker.tool';
import { marketDataFetch } from './tools/market-data.tool';
import { portfolioRiskAnalysis } from './tools/portfolio-analysis.tool';

interface ToolCallInfo {
  name: string;
  args: Record<string, unknown>;
  result: string;
}

export interface ChatResponse {
  response: string;
  toolCalls: ToolCallInfo[];
  sessionId: string;
  isError?: boolean;
  errorType?: string;
}

// Keywords that indicate ESG/compliance questions
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

// Keywords that indicate a portfolio risk/analysis question
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
    'fossil fuel': 'fossil_fuels',
    'oil': 'fossil_fuels',
    'gas': 'fossil_fuels',
    'coal': 'fossil_fuels',
    'energy': 'fossil_fuels',
    'weapon': 'weapons_defense',
    'defense': 'weapons_defense',
    'military': 'weapons_defense',
    'tobacco': 'tobacco',
    'smoking': 'tobacco',
    'cigarette': 'tobacco',
    'gambling': 'gambling',
    'casino': 'gambling',
    'betting': 'gambling',
    'labor': 'controversial_labor',
    'sweatshop': 'controversial_labor'
  };
  for (const [keyword, category] of Object.entries(categoryMap)) {
    if (lower.includes(keyword)) {
      return category;
    }
  }
  return undefined;
}

@Injectable()
export class AgentService {
  constructor(
    private readonly portfolioService: PortfolioService,
    private readonly sessionMemory: SessionMemoryService
  ) {}

  async chat(input: {
    message: string;
    sessionId: string;
    userId: string;
  }): Promise<ChatResponse> {
    const { message, sessionId, userId } = input;

    if (!message.trim()) {
      return {
        response: 'Please provide a message to get started.',
        toolCalls: [],
        sessionId
      };
    }

    // Route to compliance check if the question is about ESG
    if (isEsgQuestion(message)) {
      return this.handleComplianceQuestion(message, sessionId, userId);
    }

    // Route to portfolio analysis if the question is about portfolio risk
    if (isPortfolioQuestion(message)) {
      return this.handlePortfolioQuestion(message, sessionId, userId);
    }

    // Use context resolution for symbol extraction (supports follow-ups)
    const context = this.resolveContext(message, sessionId);
    const symbols = context.symbols;

    if (symbols.length === 0) {
      return {
        response:
          'I can help you with:\n' +
          '- ESG compliance check (ask about ESG, ethical investing, fossil fuels, etc.)\n' +
          '- Portfolio risk analysis (ask about concentration, allocation, or performance)\n' +
          '- Stock market data (include ticker symbols like AAPL, MSFT)\n\n' +
          'What would you like to know?',
        toolCalls: [],
        sessionId
      };
    }

    // Fetch market data with error handling
    try {
      const marketData = await marketDataFetch({ symbols });
      const toolCalls: ToolCallInfo[] = [
        {
          name: 'market_data_fetch',
          args: { symbols },
          result: JSON.stringify(marketData)
        }
      ];

      const successParts: string[] = [];
      const failedSymbols: string[] = [];
      for (const symbol of symbols) {
        const data = marketData[symbol];
        if (data.error) {
          failedSymbols.push(symbol);
        } else {
          const priceStr = data.price ? `$${data.price.toFixed(2)}` : 'N/A';
          const nameStr = data.name ? ` (${data.name})` : '';
          successParts.push(`${symbol}${nameStr}: ${priceStr}`);
        }
      }

      const parts: string[] = [...successParts];
      if (failedSymbols.length > 0) {
        const symbolList = failedSymbols.join(', ');
        if (failedSymbols.length === symbols.length) {
          // All symbols failed
          parts.push(
            `I wasn't able to retrieve market data for ${symbolList} right now. ` +
              'The data provider may be temporarily unavailable — please try again in a moment.'
          );
        } else {
          // Partial failure
          parts.push(
            `\nNote: I couldn't fetch data for ${symbolList} at this time. ` +
              'The data provider may be temporarily unavailable for these symbols.'
          );
        }
      }

      // Update session memory after successful tool call
      this.sessionMemory.updateSession(sessionId, {
        lastSymbols: symbols,
        lastTool: 'market_data',
        lastTopic: null
      });

      const allFailed =
        failedSymbols.length > 0 && failedSymbols.length === symbols.length;

      return {
        response: parts.join('\n'),
        toolCalls,
        sessionId,
        ...(allFailed && { isError: true, errorType: ErrorType.DATA })
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
      console.error(
        `[agent] ${classified.type} error:`,
        classified.userMessage
      );
      return {
        response: classified.userMessage,
        toolCalls: [],
        sessionId,
        isError: true,
        errorType: classified.type
      };
    }
  }

  private detectCategoryFilter(message: string): string | undefined {
    return detectCategoryFilter(message);
  }

  private async handleComplianceQuestion(
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
        response:
          'Unable to check portfolio compliance — portfolio service unavailable.',
        toolCalls: [],
        sessionId,
        isError: true,
        errorType: ErrorType.SERVICE
      };
    }

    // Convert holdings to the format expected by complianceCheck
    const holdingInputs = Object.entries(holdings).map(
      ([symbol, data]: [string, any]) => ({
        symbol,
        name: data.name || symbol,
        valueInBaseCurrency: data.valueInBaseCurrency || 0
      })
    );

    if (holdingInputs.length === 0) {
      return {
        response: 'No holdings found in portfolio — nothing to check.',
        toolCalls: [],
        sessionId
      };
    }

    // Detect category filter from the message
    const filterCategory = this.detectCategoryFilter(message);

    const result = await complianceCheck({
      holdings: holdingInputs,
      filterCategory
    });

    const toolCalls: ToolCallInfo[] = [
      {
        name: 'compliance_check',
        args: { filterCategory: filterCategory || 'all' },
        result: JSON.stringify(result)
      }
    ];

    // Build human-readable response
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
      for (const v of result.violations) {
        const cats = v.categories.join(', ').replace(/_/g, ' ');
        parts.push(
          `- **${v.name}** — ${cats} [${v.severity}]: ${v.reason}`
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
      for (const h of result.cleanHoldings) {
        parts.push(`- ${h.name}`);
      }
    }

    // Update session memory after successful compliance check
    this.sessionMemory.updateSession(sessionId, {
      lastSymbols: [],
      lastTool: 'compliance',
      lastTopic: filterCategory || 'esg'
    });

    return {
      response: parts.join('\n'),
      toolCalls,
      sessionId
    };
  }

  private async handlePortfolioQuestion(
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
          name: 'portfolio_risk_analysis',
          args: { message },
          result: JSON.stringify(result)
        }
      ];

      if (result.error) {
        return {
          response: result.error,
          toolCalls,
          sessionId,
          isError: true,
          errorType: ErrorType.SERVICE
        };
      }

      // Build human-readable response
      const parts: string[] = [];
      const fmt = (n: number) =>
        n.toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        });

      // Concentration section
      const c = result.concentration;
      parts.push('### 📊 Portfolio Risk Overview');
      parts.push('');
      parts.push(
        `- **Top holding:** ${c.topHoldingSymbol} at ${c.topHoldingPercent}%`
      );
      parts.push(`- **Diversification:** ${c.diversificationLevel}`);

      if (c.topHoldings.length > 1) {
        parts.push('');
        parts.push('**Top Holdings**');
        parts.push('');
        for (const h of c.topHoldings) {
          const label =
            h.symbol === h.name ? h.name : `${h.symbol} — ${h.name}`;
          parts.push(`- ${label}: **${h.percentage}%**`);
        }
      }

      // Allocation section
      parts.push('');
      parts.push('### 📈 Asset Allocation');
      parts.push('');
      for (const [assetClass, pct] of Object.entries(
        result.allocation.byAssetClass
      )) {
        parts.push(`- ${assetClass}: **${pct}%**`);
      }

      // Performance section
      const p = result.performance;
      const sign = p.totalReturn >= 0 ? '+' : '';
      parts.push('');
      parts.push('### 💰 Performance Summary');
      parts.push('');
      parts.push(`- **Current value:** $${fmt(p.currentValue)}`);
      parts.push(`- **Total invested:** $${fmt(p.totalInvestment)}`);
      parts.push(
        `- **Total return:** ${sign}$${fmt(p.totalReturn)} (${sign}${p.totalReturnPercent}%)`
      );

      parts.push('');
      parts.push(`*${result.holdingsCount} holdings analyzed*`);

      // Update session memory after successful portfolio analysis
      this.sessionMemory.updateSession(sessionId, {
        lastSymbols: [],
        lastTool: 'portfolio',
        lastTopic: 'risk_analysis'
      });

      return {
        response: parts.join('\n'),
        toolCalls,
        sessionId
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
      console.error(
        `[agent] ${classified.type} error:`,
        classified.userMessage
      );
      return {
        response: classified.userMessage,
        toolCalls: [],
        sessionId,
        isError: true,
        errorType: classified.type
      };
    }
  }

  private resolveContext(
    message: string,
    sessionId: string
  ): { symbols: string[]; tool: string | null } {
    const session = this.sessionMemory.getSession(sessionId);
    if (!session) {
      return { symbols: this.extractSymbols(message), tool: null };
    }

    // Check for follow-up patterns: "what about X?", "how about X?", "and X?"
    const followUpMatch =
      message.match(/(?:what|how)\s+about\s+([A-Z]{1,5})\b/i) ||
      message.match(/\band\s+([A-Z]{1,5})\b/i);

    if (followUpMatch) {
      const newSymbol = followUpMatch[1].toUpperCase();
      return { symbols: [newSymbol], tool: session.lastTool };
    }

    // If no symbols/keywords detected, fall back to session context
    const extracted = this.extractSymbols(message);
    if (
      extracted.length === 0 &&
      !isEsgQuestion(message) &&
      !isPortfolioQuestion(message)
    ) {
      if (session.lastSymbols.length > 0) {
        return { symbols: session.lastSymbols, tool: session.lastTool };
      }
    }

    return { symbols: extracted, tool: null };
  }

  private extractSymbols(message: string): string[] {
    const symbolPattern = /\b([A-Z]{1,12})\b/g;
    const potentialSymbols = message.match(symbolPattern) || [];
    const commonWords = new Set([
      'I',
      'A',
      'THE',
      'IS',
      'IT',
      'OF',
      'AND',
      'OR',
      'TO',
      'IN',
      'FOR',
      'ON',
      'AT',
      'BY',
      'AN',
      'BE',
      'AS',
      'DO',
      'IF',
      'SO',
      'NO',
      'UP',
      'MY',
      'ME',
      'WE',
      'HE',
      'CAN',
      'HOW',
      'ARE',
      'NOT',
      'BUT',
      'ALL',
      'HAS',
      'WAS',
      'HAD',
      'GET',
      'GOT',
      'WHAT',
      'TELL',
      'SHOW',
      'GIVE',
      'ABOUT',
      'PRICE',
      'STOCK',
      'MARKET',
      'DATA',
      'QUOTE'
    ]);
    return potentialSymbols.filter(
      (s) => !commonWords.has(s) && s.length >= 2
    );
  }
}
