import { CommonModule } from '@angular/common';
import {
  CUSTOM_ELEMENTS_SCHEMA,
  Component,
  Input,
  OnChanges
} from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatTooltipModule } from '@angular/material/tooltip';

interface ToolCall {
  name: string;
  args: Record<string, unknown>;
  result: string;
}

type VerificationStatus = 'pass' | 'warning' | 'fail';
type ConfidenceLevel = 'high' | 'medium' | 'low';

interface VerificationCheck {
  passed: boolean;
  reason?: string;
  details?: Record<string, unknown>;
}

interface VerificationSource {
  tool: string;
  claim: string;
  source: string;
  timestamp: string;
}

interface VerificationSummary {
  status: VerificationStatus;
  confidenceScore: number;
  confidenceLevel: ConfidenceLevel;
  checks: Record<string, VerificationCheck>;
  sources: VerificationSource[];
  generatedAt: string;
}

interface SourceAttributionRecord {
  source: string;
  timestamp: string;
}

interface SourceAttribution {
  primary: SourceAttributionRecord;
  backup?: SourceAttributionRecord;
}

interface MarketDataResult {
  symbol: string;
  name?: string;
  price?: number;
  change?: number;
  changePercent?: number;
  open?: number;
  high?: number;
  low?: number;
  volume?: number;
  fiftyTwoWeekLow?: number;
  fiftyTwoWeekHigh?: number;
  currency?: string;
  backupPrice?: number;
  backupSource?: string;
  priceDiscrepancyPct?: number;
  error?: string;
  discrepancyWarning?: string;
  sourceAttribution?: SourceAttribution;
  verification?: VerificationSummary;
}

interface PortfolioHolding {
  name: string;
  symbol?: string;
  allocationInPercentage: number;
}

interface PortfolioPerformanceSummary {
  currentValue?: number;
  totalReturn?: number;
  totalReturnPercent?: number;
  totalInvestment?: number;
}

interface PortfolioAllocationEntry {
  assetClass: string;
  percentage: number;
}

interface PortfolioRiskResult {
  error?: string;
  hhi?: number;
  diversificationLevel?: string;
  topHoldingSymbol?: string;
  topHoldingPercent?: number;
  topHoldings: PortfolioHolding[];
  allocationByAssetClass: PortfolioAllocationEntry[];
  performance: PortfolioPerformanceSummary;
  holdingsCount?: number;
  totalValue?: number;
  currency?: string;
  sourceAttribution?: SourceAttribution;
  verification?: VerificationSummary;
}

interface EsgViolation {
  holding: string;
  categories: string[];
  severity: string;
  description: string;
}

interface EsgResult {
  error?: string;
  complianceScore?: number;
  totalChecked?: number;
  cleanCount?: number;
  compliantCount?: number;
  flaggedCount?: number;
  violations: EsgViolation[];
  datasetVersion?: string;
  datasetLastUpdated?: string;
  requestedSymbols?: string[];
  matchedSymbols?: string[];
  unmatchedSymbols?: string[];
  summary?: string;
  sourceAttribution?: SourceAttribution;
  verification?: VerificationSummary;
}

@Component({
  imports: [CommonModule, MatCardModule, MatTooltipModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  selector: 'gf-tool-result-card',
  styleUrls: ['./tool-result-card.scss'],
  templateUrl: './tool-result-card.html'
})
export class GfToolResultCardComponent implements OnChanges {
  @Input() toolCall!: ToolCall;

  public toolType: 'market-data' | 'portfolio' | 'esg' | 'unknown' = 'unknown';
  public marketData: MarketDataResult[] = [];
  public portfolioData: PortfolioRiskResult | null = null;
  public esgData: EsgResult | null = null;
  public parseError = false;
  public unrecognizedPayload = false;
  public fallbackMessage = '';

  public ngOnChanges() {
    this.parseToolResult();
  }

  public get52WeekPercent(stock: MarketDataResult): number {
    if (
      stock.fiftyTwoWeekLow === undefined ||
      stock.fiftyTwoWeekHigh === undefined ||
      stock.price === undefined
    ) {
      return 50;
    }
    const range = stock.fiftyTwoWeekHigh - stock.fiftyTwoWeekLow;
    if (range === 0) {
      return 50;
    }
    return Math.max(
      0,
      Math.min(100, ((stock.price - stock.fiftyTwoWeekLow) / range) * 100)
    );
  }

  public hasPortfolioPerformanceSummary(): boolean {
    const performance = this.portfolioData?.performance;

    if (!performance) {
      return false;
    }

    return [
      performance.currentValue,
      performance.totalReturn,
      performance.totalReturnPercent,
      performance.totalInvestment
    ].some((value) => value !== undefined);
  }

  public hasToolFallbackState(): boolean {
    return this.parseError || this.toolType === 'unknown' || this.unrecognizedPayload;
  }

  public formatNumber(value: number | undefined, decimals = 2): string {
    if (value === undefined || value === null) {
      return '—';
    }

    return value.toLocaleString(undefined, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  }

  public formatVolume(volume: number | undefined): string {
    if (volume === undefined || volume === null) {
      return '—';
    }

    if (volume >= 1_000_000_000) {
      return `${(volume / 1_000_000_000).toFixed(1)}B`;
    }

    if (volume >= 1_000_000) {
      return `${(volume / 1_000_000).toFixed(1)}M`;
    }

    if (volume >= 1_000) {
      return `${(volume / 1_000).toFixed(1)}K`;
    }

    return volume.toString();
  }

  public formatTimestamp(value: string | undefined): string {
    if (!value) {
      return '—';
    }

    const timestamp = new Date(value);

    if (Number.isNaN(timestamp.getTime())) {
      return value;
    }

    return timestamp.toLocaleString();
  }

  public formatCategory(category: string): string {
    return category
      .replace(/_/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  public formatCategories(categories: string[]): string {
    return categories.map((category) => this.formatCategory(category)).join(', ');
  }

  public getSeverityClass(severity: string): string {
    switch (severity?.toLowerCase()) {
      case 'high':
        return 'severity-high';
      case 'medium':
        return 'severity-medium';
      case 'low':
        return 'severity-low';
      default:
        return 'severity-medium';
    }
  }

  public getVerificationClass(status?: VerificationStatus): string {
    switch (status) {
      case 'pass':
        return 'status-pass';
      case 'warning':
        return 'status-warning';
      case 'fail':
        return 'status-fail';
      default:
        return 'status-warning';
    }
  }

  public getDiversificationClass(): string {
    const level = this.portfolioData?.diversificationLevel?.toLowerCase() || '';

    if (level.includes('well')) {
      return 'well-diversified';
    }

    if (level.includes('moderate')) {
      return 'moderate';
    }

    if (level.includes('concentrated')) {
      return 'concentrated';
    }

    return '';
  }

  private parseToolResult() {
    this.parseError = false;
    this.unrecognizedPayload = false;
    this.fallbackMessage = '';
    this.toolType = 'unknown';
    this.marketData = [];
    this.portfolioData = null;
    this.esgData = null;

    try {
      const parsed = JSON.parse(this.toolCall.result);

      switch (this.toolCall.name) {
        case 'marketDataFetch':
        case 'market_data_fetch':
          this.toolType = 'market-data';
          this.marketData = this.parseMarketData(parsed);

          if (this.marketData.length === 0) {
            this.unrecognizedPayload = true;
            this.fallbackMessage =
              'Market data payload was empty or in an unsupported format.';
          }

          break;
        case 'portfolioRiskAnalysis':
        case 'portfolio_risk_analysis':
          this.toolType = 'portfolio';
          this.portfolioData = this.parsePortfolioData(parsed);

          if (!this.portfolioData) {
            this.unrecognizedPayload = true;
            this.fallbackMessage =
              'Portfolio payload was empty or in an unsupported format.';
          }

          break;
        case 'complianceCheck':
        case 'compliance_check':
          this.toolType = 'esg';
          this.esgData = this.parseEsgData(parsed);

          if (!this.esgData) {
            this.unrecognizedPayload = true;
            this.fallbackMessage =
              'Compliance payload was empty or in an unsupported format.';
          }

          break;
        default:
          this.toolType = 'unknown';
          this.fallbackMessage = `No dedicated renderer for tool "${this.toolCall.name}".`;
      }
    } catch {
      this.parseError = true;
      this.toolType = 'unknown';
      this.fallbackMessage = 'Tool output could not be parsed as valid JSON.';
    }
  }

  private parseMarketData(data: unknown): MarketDataResult[] {
    return this.normalizeMarketDataStocks(data).map(({ stock, symbolHint }) => {
      const symbol =
        this.firstString(stock.symbol, stock.ticker, symbolHint) || '—';
      const verification = this.parseVerificationSummary(stock.verification);
      const crossSourcePriceCheck = verification?.checks?.crossSourcePrice;
      const discrepancyWarning =
        crossSourcePriceCheck && !crossSourcePriceCheck.passed
          ? crossSourcePriceCheck.reason
          : undefined;

      return {
        symbol,
        name: this.firstString(
          stock.name,
          stock.shortName,
          stock.longName,
          stock.displayName
        ) || '',
        price: this.firstNumber(
          stock.price,
          stock.regularMarketPrice,
          stock.currentPrice,
          stock.lastPrice,
          stock.close
        ),
        change: this.firstNumber(stock.change, stock.regularMarketChange),
        changePercent: this.firstNumber(
          stock.changePercent,
          stock.regularMarketChangePercent
        ),
        open: this.firstNumber(stock.open, stock.regularMarketOpen),
        high: this.firstNumber(
          stock.high,
          stock.regularMarketDayHigh,
          stock.dayHigh
        ),
        low: this.firstNumber(stock.low, stock.regularMarketDayLow, stock.dayLow),
        volume: this.firstNumber(stock.volume, stock.regularMarketVolume),
        fiftyTwoWeekLow: this.firstNumber(stock.fiftyTwoWeekLow, stock['52WeekLow']),
        fiftyTwoWeekHigh: this.firstNumber(
          stock.fiftyTwoWeekHigh,
          stock['52WeekHigh']
        ),
        currency: this.firstString(stock.currency, stock.financialCurrency) || 'USD',
        backupPrice: this.firstNumber(stock.backupPrice),
        backupSource: this.firstString(stock.backupSource),
        priceDiscrepancyPct: this.firstNumber(stock.priceDiscrepancyPct),
        error: this.firstString(stock.error),
        discrepancyWarning,
        sourceAttribution: this.parseSourceAttribution(stock.sourceAttribution),
        verification
      };
    });
  }

  private normalizeMarketDataStocks(
    data: unknown
  ): Array<{ stock: Record<string, unknown>; symbolHint?: string }> {
    if (Array.isArray(data)) {
      return data
        .filter((stock): stock is Record<string, unknown> => this.isRecord(stock))
        .map((stock) => ({ stock }));
    }

    if (!this.isRecord(data)) {
      return [];
    }

    const collectionCandidates = [data.quotes, data.results, data.data];

    for (const candidate of collectionCandidates) {
      if (Array.isArray(candidate)) {
        return candidate
          .filter((stock): stock is Record<string, unknown> => this.isRecord(stock))
          .map((stock) => ({ stock }));
      }
    }

    const isSingleStockShape = this.isMarketStockShape(data);

    if (isSingleStockShape) {
      return [{ stock: data }];
    }

    const keyedStocks = Object.entries(data).flatMap(([symbolKey, value]) => {
      if (!this.isRecord(value) || !this.isMarketStockShape(value)) {
        return [];
      }

      return [{ stock: value, symbolHint: symbolKey }];
    });

    return keyedStocks;
  }

  private firstNumber(...values: unknown[]): number | undefined {
    for (const value of values) {
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
      }
      if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }
    }
    return undefined;
  }

  private firstString(...values: unknown[]): string | undefined {
    for (const value of values) {
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed) {
          return trimmed;
        }
      }
    }
    return undefined;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private isMarketStockShape(record: Record<string, unknown>): boolean {
    return [
      'symbol',
      'ticker',
      'price',
      'regularMarketPrice',
      'currentPrice',
      'lastPrice',
      'error',
      'verification',
      'backupPrice'
    ].some((key) => record[key] !== undefined);
  }

  private parsePortfolioData(data: unknown): PortfolioRiskResult | null {
    if (!this.isRecord(data)) {
      return null;
    }

    const concentration = this.isRecord(data.concentration) ? data.concentration : {};
    const topHoldingsRaw =
      this.toRecordArray(concentration.topHoldings) ||
      this.toRecordArray(data.topHoldings) ||
      this.toRecordArray(data.holdings) ||
      [];
    const allocationByAssetClassRaw = this.extractAllocationByAssetClass(data);
    const performance = this.parsePortfolioPerformance(data.performance, data);
    const hhi = this.firstNumber(
      concentration.herfindahlIndex,
      data.hhi,
      data.concentrationIndex
    );
    const topHoldingPercent = this.firstNumber(
      concentration.topHoldingPercent,
      data.topHoldingPercent
    );
    const result: PortfolioRiskResult = {
      error: this.firstString(data.error),
      hhi,
      diversificationLevel:
        this.firstString(
          concentration.diversificationLevel,
          data.diversificationLevel,
          data.diversification
        ) || this.hhiToLevel(hhi),
      topHoldingSymbol: this.firstString(
        concentration.topHoldingSymbol,
        data.topHoldingSymbol
      ),
      topHoldingPercent,
      topHoldings: topHoldingsRaw.map((holding) => ({
        name: this.firstString(holding.name, holding.symbol) || '—',
        symbol: this.firstString(holding.symbol),
        allocationInPercentage:
          this.firstNumber(
            holding.percentage,
            holding.allocationInPercentage,
            holding.allocation,
            holding.weight
          ) || 0
      })),
      allocationByAssetClass: allocationByAssetClassRaw,
      performance,
      holdingsCount: this.firstNumber(data.holdingsCount),
      totalValue: this.firstNumber(data.totalValue, data.netWorth, performance.currentValue),
      currency: this.firstString(data.currency) || 'USD',
      sourceAttribution: this.parseSourceAttribution(data.sourceAttribution),
      verification: this.parseVerificationSummary(data.verification)
    };

    const hasPerformance = [
      result.performance.currentValue,
      result.performance.totalReturn,
      result.performance.totalReturnPercent,
      result.performance.totalInvestment
    ].some((value) => value !== undefined);
    const hasRenderableData =
      !!result.error ||
      result.hhi !== undefined ||
      result.topHoldings.length > 0 ||
      result.allocationByAssetClass.length > 0 ||
      hasPerformance;

    return hasRenderableData ? result : null;
  }

  private extractAllocationByAssetClass(
    data: Record<string, unknown>
  ): PortfolioAllocationEntry[] {
    let byAssetClass: Record<string, unknown> | undefined;
    const allocation = this.isRecord(data.allocation) ? data.allocation : undefined;

    if (allocation && this.isRecord(allocation.byAssetClass)) {
      byAssetClass = allocation.byAssetClass;
    } else if (this.isRecord(data.allocationByAssetClass)) {
      byAssetClass = data.allocationByAssetClass;
    } else if (allocation) {
      byAssetClass = allocation;
    }

    if (!byAssetClass) {
      return [];
    }

    return Object.entries(byAssetClass)
      .map(([assetClass, value]) => ({
        assetClass,
        percentage: this.firstNumber(value) || 0
      }))
      .filter((entry) => entry.assetClass.trim().length > 0);
  }

  private parsePortfolioPerformance(
    value: unknown,
    fallbackSource: Record<string, unknown>
  ): PortfolioPerformanceSummary {
    const summary: PortfolioPerformanceSummary = {};

    if (this.isRecord(value)) {
      summary.currentValue = this.firstNumber(value.currentValue, value.value);
      summary.totalReturn = this.firstNumber(value.totalReturn, value.netPerformance);
      summary.totalReturnPercent = this.firstNumber(
        value.totalReturnPercent,
        value.netPerformancePercentage
      );
      summary.totalInvestment = this.firstNumber(value.totalInvestment);
      return summary;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        if (!this.isRecord(item)) {
          continue;
        }

        const label = this.firstString(item.label)?.toLowerCase() || '';
        const metricValue = this.firstNumber(item.value);

        if (metricValue === undefined) {
          continue;
        }

        if (label.includes('current') || label.includes('value')) {
          summary.currentValue = metricValue;
        } else if (label.includes('investment')) {
          summary.totalInvestment = metricValue;
        } else if (label.includes('percent') || label.includes('%')) {
          summary.totalReturnPercent = metricValue;
        } else if (label.includes('return')) {
          summary.totalReturn = metricValue;
        }
      }
    }

    if (summary.currentValue === undefined) {
      summary.currentValue = this.firstNumber(
        fallbackSource.totalValue,
        fallbackSource.netWorth
      );
    }

    return summary;
  }

  private parseEsgData(data: unknown): EsgResult | null {
    if (!this.isRecord(data)) {
      return null;
    }

    const violationsRaw =
      this.toRecordArray(data.violations) ||
      this.toRecordArray(data.flagged) ||
      [];
    const violations: EsgViolation[] = violationsRaw.map((violation) => {
      const categories =
        this.parseStringArray(violation.categories) ||
        this.parseStringArray(violation.category) ||
        this.parseStringArray(violation.type) || [
          this.firstString(violation.category, violation.type) || 'unknown'
        ];

      return {
        holding:
          this.firstString(violation.holding, violation.name, violation.symbol) ||
          '—',
        categories,
        severity: this.firstString(violation.severity, violation.risk) || 'medium',
        description:
          this.firstString(
            violation.description,
            violation.reason,
            violation.details
          ) || ''
      };
    });
    const totalChecked = this.firstNumber(data.totalChecked);
    const flaggedCount =
      this.firstNumber(
        data.flaggedCount,
        Array.isArray(data.flagged) ? data.flagged.length : undefined
      ) || violations.length;
    const cleanHoldingsCount = Array.isArray(data.cleanHoldings)
      ? data.cleanHoldings.length
      : undefined;
    const compliantCount = this.firstNumber(
      data.compliantCount,
      data.compliant,
      cleanHoldingsCount
    );
    const cleanCount =
      this.firstNumber(
        cleanHoldingsCount,
        compliantCount,
        totalChecked !== undefined ? totalChecked - flaggedCount : undefined
      ) || 0;
    const result: EsgResult = {
      error: this.firstString(data.error),
      complianceScore: this.firstNumber(data.complianceScore),
      totalChecked,
      cleanCount,
      compliantCount,
      flaggedCount,
      violations,
      datasetVersion: this.firstString(data.datasetVersion),
      datasetLastUpdated: this.firstString(data.datasetLastUpdated),
      requestedSymbols: this.parseStringArray(data.requestedSymbols),
      matchedSymbols: this.parseStringArray(data.matchedSymbols),
      unmatchedSymbols: this.parseStringArray(data.unmatchedSymbols),
      summary: this.firstString(data.summary),
      sourceAttribution: this.parseSourceAttribution(data.sourceAttribution),
      verification: this.parseVerificationSummary(data.verification)
    };
    const hasRenderableData =
      !!result.error ||
      result.complianceScore !== undefined ||
      result.totalChecked !== undefined ||
      result.violations.length > 0 ||
      !!result.summary;

    return hasRenderableData ? result : null;
  }

  private hhiToLevel(hhi: number | undefined): string {
    if (!hhi) {
      return 'Unknown';
    }

    if (hhi < 0.15) {
      return 'Well Diversified';
    }

    if (hhi < 0.25) {
      return 'Moderately Diversified';
    }

    return 'Concentrated';
  }

  private parseVerificationSummary(value: unknown): VerificationSummary | undefined {
    if (!this.isRecord(value)) {
      return undefined;
    }

    const rawStatus = this.firstString(value.status)?.toLowerCase();
    const status: VerificationStatus =
      rawStatus === 'pass' || rawStatus === 'warning' || rawStatus === 'fail'
        ? rawStatus
        : 'warning';
    const confidenceScore = this.firstNumber(value.confidenceScore) || 0;
    const rawConfidenceLevel = this.firstString(value.confidenceLevel)?.toLowerCase();
    const confidenceLevel: ConfidenceLevel =
      rawConfidenceLevel === 'high' ||
      rawConfidenceLevel === 'medium' ||
      rawConfidenceLevel === 'low'
        ? rawConfidenceLevel
        : confidenceScore >= 85
          ? 'high'
          : confidenceScore >= 60
            ? 'medium'
            : 'low';
    const checks = this.parseVerificationChecks(value.checks);
    const sources = this.parseVerificationSources(value.sources);
    const generatedAt = this.firstString(value.generatedAt) || '';

    const hasSignal =
      Object.keys(checks).length > 0 ||
      sources.length > 0 ||
      generatedAt.length > 0 ||
      confidenceScore > 0;

    if (!hasSignal) {
      return undefined;
    }

    return {
      status,
      confidenceLevel,
      confidenceScore,
      checks,
      sources,
      generatedAt
    };
  }

  private parseVerificationChecks(
    value: unknown
  ): Record<string, VerificationCheck> {
    if (!this.isRecord(value)) {
      return {};
    }

    const checks: Record<string, VerificationCheck> = {};

    for (const [key, rawCheck] of Object.entries(value)) {
      if (!this.isRecord(rawCheck)) {
        continue;
      }

      checks[key] = {
        passed: rawCheck.passed === true,
        reason: this.firstString(rawCheck.reason),
        details: this.isRecord(rawCheck.details) ? rawCheck.details : undefined
      };
    }

    return checks;
  }

  private parseVerificationSources(value: unknown): VerificationSource[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .filter((source): source is Record<string, unknown> => this.isRecord(source))
      .map((source) => ({
        tool: this.firstString(source.tool) || 'tool',
        claim: this.firstString(source.claim) || 'claim',
        source: this.firstString(source.source) || 'source',
        timestamp: this.firstString(source.timestamp) || ''
      }));
  }

  private parseSourceAttribution(value: unknown): SourceAttribution | undefined {
    if (!this.isRecord(value)) {
      return undefined;
    }

    const primary = this.parseSourceAttributionRecord(value.primary);

    if (!primary) {
      return undefined;
    }

    const backup = this.parseSourceAttributionRecord(value.backup);

    return {
      primary,
      ...(backup ? { backup } : {})
    };
  }

  private parseSourceAttributionRecord(
    value: unknown
  ): SourceAttributionRecord | undefined {
    if (!this.isRecord(value)) {
      return undefined;
    }

    const source = this.firstString(value.source);
    const timestamp = this.firstString(value.timestamp);

    if (!source || !timestamp) {
      return undefined;
    }

    return {
      source,
      timestamp
    };
  }

  private parseStringArray(value: unknown): string[] | undefined {
    if (Array.isArray(value)) {
      return value
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed.length > 0 ? [trimmed] : [];
    }

    return undefined;
  }

  private toRecordArray(value: unknown): Record<string, unknown>[] | undefined {
    if (!Array.isArray(value)) {
      return undefined;
    }

    return value.filter((entry): entry is Record<string, unknown> => {
      return this.isRecord(entry);
    });
  }
}
