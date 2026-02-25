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
}

interface PortfolioHolding {
  name: string;
  symbol?: string;
  allocationInPercentage: number;
}

interface PortfolioPerformance {
  label: string;
  value: number;
}

interface PortfolioRiskResult {
  hhi?: number;
  diversificationLevel?: string;
  topHoldings?: PortfolioHolding[];
  performance?: PortfolioPerformance[];
  totalValue?: number;
  currency?: string;
}

interface EsgViolation {
  holding: string;
  category: string;
  severity: string;
  description: string;
}

interface EsgResult {
  compliantCount?: number;
  flaggedCount?: number;
  violations?: EsgViolation[];
  summary?: string;
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

  public ngOnChanges() {
    this.parseToolResult();
  }

  public get52WeekPercent(stock: MarketDataResult): number {
    if (!stock.fiftyTwoWeekLow || !stock.fiftyTwoWeekHigh || !stock.price) {
      return 50;
    }
    const range = stock.fiftyTwoWeekHigh - stock.fiftyTwoWeekLow;
    if (range === 0) return 50;
    return ((stock.price - stock.fiftyTwoWeekLow) / range) * 100;
  }

  public formatNumber(value: number | undefined, decimals = 2): string {
    if (value === undefined || value === null) return '—';
    return value.toLocaleString(undefined, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  }

  public formatVolume(volume: number | undefined): string {
    if (!volume) return '—';
    if (volume >= 1_000_000_000) return `${(volume / 1_000_000_000).toFixed(1)}B`;
    if (volume >= 1_000_000) return `${(volume / 1_000_000).toFixed(1)}M`;
    if (volume >= 1_000) return `${(volume / 1_000).toFixed(1)}K`;
    return volume.toString();
  }

  public getSeverityClass(severity: string): string {
    switch (severity?.toLowerCase()) {
      case 'high': return 'severity-high';
      case 'medium': return 'severity-medium';
      case 'low': return 'severity-low';
      default: return 'severity-medium';
    }
  }

  public getDiversificationClass(): string {
    const level = this.portfolioData?.diversificationLevel?.toLowerCase() || '';
    if (level.includes('well')) return 'well-diversified';
    if (level.includes('moderate')) return 'moderate';
    if (level.includes('concentrated')) return 'concentrated';
    return '';
  }

  private parseToolResult() {
    try {
      const parsed = JSON.parse(this.toolCall.result);

      switch (this.toolCall.name) {
        case 'marketDataFetch':
        case 'market_data_fetch':
          this.toolType = 'market-data';
          this.marketData = this.parseMarketData(parsed);
          break;
        case 'portfolioRiskAnalysis':
        case 'portfolio_risk_analysis':
          this.toolType = 'portfolio';
          this.portfolioData = this.parsePortfolioData(parsed);
          break;
        case 'complianceCheck':
        case 'compliance_check':
          this.toolType = 'esg';
          this.esgData = this.parseEsgData(parsed);
          break;
        default:
          this.toolType = 'unknown';
      }
    } catch {
      this.parseError = true;
      this.toolType = 'unknown';
    }
  }

  private parseMarketData(data: any): MarketDataResult[] {
    const stocks = Array.isArray(data) ? data : data?.quotes || data?.results || [data];
    return stocks.map((s: any) => ({
      symbol: s.symbol || s.ticker || '—',
      name: s.name || s.shortName || s.longName || '',
      price: s.price ?? s.regularMarketPrice ?? s.currentPrice,
      change: s.change ?? s.regularMarketChange,
      changePercent: s.changePercent ?? s.regularMarketChangePercent,
      open: s.open ?? s.regularMarketOpen,
      high: s.high ?? s.regularMarketDayHigh,
      low: s.low ?? s.regularMarketDayLow,
      volume: s.volume ?? s.regularMarketVolume,
      fiftyTwoWeekLow: s.fiftyTwoWeekLow,
      fiftyTwoWeekHigh: s.fiftyTwoWeekHigh,
      currency: s.currency || 'USD'
    }));
  }

  private parsePortfolioData(data: any): PortfolioRiskResult {
    return {
      hhi: data.hhi ?? data.concentrationIndex,
      diversificationLevel: data.diversificationLevel || data.diversification || this.hhiToLevel(data.hhi),
      topHoldings: (data.topHoldings || data.holdings || []).map((h: any) => ({
        name: h.name || h.symbol || '—',
        symbol: h.symbol,
        allocationInPercentage: h.allocationInPercentage ?? h.allocation ?? h.weight ?? 0
      })),
      performance: data.performance || [],
      totalValue: data.totalValue ?? data.netWorth,
      currency: data.currency || 'USD'
    };
  }

  private parseEsgData(data: any): EsgResult {
    const violations = data.violations || data.flagged || [];
    return {
      compliantCount: data.compliantCount ?? data.compliant ?? 0,
      flaggedCount: data.flaggedCount ?? data.flagged?.length ?? violations.length ?? 0,
      violations: violations.map((v: any) => ({
        holding: v.holding || v.name || v.symbol || '—',
        category: v.category || v.type || '—',
        severity: v.severity || v.risk || 'medium',
        description: v.description || v.reason || v.details || ''
      })),
      summary: data.summary
    };
  }

  private hhiToLevel(hhi: number | undefined): string {
    if (!hhi) return 'Unknown';
    if (hhi < 0.15) return 'Well Diversified';
    if (hhi < 0.25) return 'Moderately Diversified';
    return 'Concentrated';
  }
}
