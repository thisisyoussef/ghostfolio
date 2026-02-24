import { PortfolioService } from '@ghostfolio/api/app/portfolio/portfolio.service';

import { Injectable } from '@nestjs/common';

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

function isEsgQuestion(message: string): boolean {
  const lower = message.toLowerCase();
  return ESG_KEYWORDS.some((keyword) => lower.includes(keyword));
}

function isPortfolioQuestion(message: string): boolean {
  const lower = message.toLowerCase();
  return PORTFOLIO_KEYWORDS.some((keyword) => lower.includes(keyword));
}

@Injectable()
export class AgentService {
  constructor(
    private readonly portfolioService: PortfolioService
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

    // Extract ticker symbols from the message (basic pattern matching)
    const symbols = this.extractSymbols(message);

    if (symbols.length === 0) {
      return {
        response:
          'I can help you with:\n' +
          '• ESG compliance check (ask about ESG, ethical investing, fossil fuels, etc.)\n' +
          '• Portfolio risk analysis (ask about concentration, allocation, or performance)\n' +
          '• Stock market data (include ticker symbols like AAPL, MSFT)\n\n' +
          'What would you like to know?',
        toolCalls: [],
        sessionId
      };
    }

    // Fetch market data
    const marketData = await marketDataFetch({ symbols });
    const toolCalls: ToolCallInfo[] = [
      {
        name: 'market_data_fetch',
        args: { symbols },
        result: JSON.stringify(marketData)
      }
    ];

    // Build response text
    const parts: string[] = [];
    for (const symbol of symbols) {
      const data = marketData[symbol];
      if (data.error) {
        parts.push(`${symbol}: ${data.error}`);
      } else {
        const priceStr = data.price ? `$${data.price.toFixed(2)}` : 'N/A';
        const nameStr = data.name ? ` (${data.name})` : '';
        parts.push(`${symbol}${nameStr}: ${priceStr}`);
      }
    }

    return {
      response: parts.join('\n'),
      toolCalls,
      sessionId
    };
  }

  private detectCategoryFilter(message: string): string | undefined {
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
        sessionId
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
      ? ` (filtered: ${filterCategory.replace('_', ' ')})`
      : '';

    parts.push(`🌱 **ESG Compliance Report${filterLabel}**`);
    parts.push(`• Compliance Score: **${result.complianceScore}%**`);
    parts.push(`• Holdings checked: ${result.totalChecked}`);
    parts.push(
      `• Source: ESG Violations Dataset v${result.datasetVersion} (${result.datasetLastUpdated})`
    );

    if (result.violations.length > 0) {
      parts.push('');
      parts.push('⚠️ **Violations Found:**');
      for (const v of result.violations) {
        const cats = v.categories.join(', ').replace(/_/g, ' ');
        parts.push(
          `• **${v.symbol}** (${v.name}) — ${cats} [${v.severity}]: ${v.reason}`
        );
      }
    } else {
      parts.push('');
      parts.push('✅ No ESG violations found in your portfolio.');
    }

    if (result.cleanHoldings.length > 0 && result.violations.length > 0) {
      parts.push('');
      parts.push('✅ **Clean Holdings:**');
      for (const h of result.cleanHoldings) {
        parts.push(`• ${h.symbol} (${h.name})`);
      }
    }

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
        sessionId
      };
    }

    // Build human-readable response
    const parts: string[] = [];

    // Concentration section
    const c = result.concentration;
    parts.push('📊 **Portfolio Concentration**');
    parts.push(`• Top holding: ${c.topHoldingSymbol} (${c.topHoldingPercent}%)`);
    parts.push(`• HHI (Herfindahl Index): ${c.herfindahlIndex.toFixed(4)}`);
    parts.push(`• Diversification: ${c.diversificationLevel}`);

    if (c.topHoldings.length > 1) {
      parts.push('• Top holdings:');
      for (const h of c.topHoldings) {
        parts.push(`  - ${h.symbol} (${h.name}): ${h.percentage}%`);
      }
    }

    // Allocation section
    parts.push('');
    parts.push('📈 **Asset Allocation**');
    for (const [assetClass, pct] of Object.entries(result.allocation.byAssetClass)) {
      parts.push(`• ${assetClass}: ${pct}%`);
    }

    // Performance section
    const p = result.performance;
    parts.push('');
    parts.push('💰 **Performance Summary**');
    parts.push(`• Current value: $${p.currentValue.toLocaleString()}`);
    parts.push(`• Total invested: $${p.totalInvestment.toLocaleString()}`);
    parts.push(`• Total return: $${p.totalReturn.toLocaleString()} (${p.totalReturnPercent}%)`);

    parts.push('');
    parts.push(`Total holdings: ${result.holdingsCount}`);

    return {
      response: parts.join('\n'),
      toolCalls,
      sessionId
    };
  }

  private extractSymbols(message: string): string[] {
    const symbolPattern = /\b([A-Z]{1,5})\b/g;
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
