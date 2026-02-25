import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import { GfToolResultCardComponent } from './tool-result-card.component';

describe('GfToolResultCardComponent', () => {
  let fixture: ComponentFixture<GfToolResultCardComponent>;
  let component: GfToolResultCardComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GfToolResultCardComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(GfToolResultCardComponent);
    component = fixture.componentInstance;
  });

  it('renders canonical market payload with discrepancy warning and verification', () => {
    component.toolCall = {
      name: 'market_data_fetch',
      args: { symbols: ['AAPL'] },
      result: JSON.stringify({
        AAPL: {
          symbol: 'AAPL',
          name: 'Apple Inc.',
          price: 195.12,
          open: 193.21,
          high: 196.8,
          low: 192.2,
          volume: 1200456,
          fiftyTwoWeekHigh: 210,
          fiftyTwoWeekLow: 130,
          sourceAttribution: {
            primary: {
              source: 'Yahoo Finance (chart v8)',
              timestamp: '2026-02-25T03:57:28.019Z'
            },
            backup: {
              source: 'Stooq',
              timestamp: '2026-02-25T03:57:29.019Z'
            }
          },
          verification: {
            status: 'warning',
            confidenceScore: 54,
            confidenceLevel: 'low',
            checks: {
              crossSourcePrice: {
                passed: false,
                reason: 'Discrepancy 8.30% exceeds threshold 5.00%.'
              }
            },
            sources: [],
            generatedAt: '2026-02-25T03:57:28.019Z'
          }
        }
      })
    };

    component.ngOnChanges();
    fixture.detectChanges();

    expect(fixture.debugElement.query(By.css('.market-card'))).toBeTruthy();

    const text = (
      fixture.debugElement.query(By.css('.market-card')).nativeElement as HTMLElement
    ).textContent;

    expect(text).toContain('AAPL');
    expect(text).toContain('Market Data');
    expect(text).toContain('Discrepancy 8.30% exceeds threshold 5.00%.');
    expect(text).toContain('Confidence 54/100 (low)');
    expect(text).toContain('Yahoo Finance (chart v8)');
  });

  it('renders nested canonical portfolio payload', () => {
    component.toolCall = {
      name: 'portfolio_risk_analysis',
      args: {},
      result: JSON.stringify({
        concentration: {
          topHoldingSymbol: 'AAPL',
          topHoldingPercent: 42,
          herfindahlIndex: 0.31,
          topHoldings: [
            { symbol: 'AAPL', name: 'Apple Inc.', percentage: 42 },
            { symbol: 'MSFT', name: 'Microsoft Corp.', percentage: 25 }
          ],
          diversificationLevel: 'Moderately Concentrated'
        },
        allocation: {
          byAssetClass: {
            EQUITY: 70,
            DEBT: 30
          }
        },
        performance: {
          currentValue: 120000,
          totalReturn: 15000,
          totalReturnPercent: 14.2,
          totalInvestment: 105000
        },
        holdingsCount: 8,
        verification: {
          status: 'pass',
          confidenceScore: 95,
          confidenceLevel: 'high',
          checks: {
            outputSchema: { passed: true }
          },
          sources: [],
          generatedAt: '2026-02-25T03:57:28.019Z'
        }
      })
    };

    component.ngOnChanges();
    fixture.detectChanges();

    expect(fixture.debugElement.query(By.css('.portfolio-card'))).toBeTruthy();

    const text = (
      fixture.debugElement.query(By.css('.portfolio-card')).nativeElement as HTMLElement
    ).textContent;

    expect(text).toContain('Portfolio Analysis');
    expect(text).toContain('Allocation by Asset Class');
    expect(text).toContain('EQUITY');
    expect(text).toContain('70.00%');
    expect(text).toContain('Total Return');
    expect(text).toContain('Return %');
    expect(text).toContain('14.20%');
    expect(text).toContain('Confidence 95/100 (high)');
  });

  it('renders canonical compliance payload with categories and dataset metadata', () => {
    component.toolCall = {
      name: 'compliance_check',
      args: {},
      result: JSON.stringify({
        complianceScore: 68.27,
        totalChecked: 8,
        cleanHoldings: [{ symbol: 'AAPL' }, { symbol: 'MSFT' }],
        flaggedCount: 3,
        violations: [
          {
            symbol: 'XOM',
            name: 'Exxon Mobil Corporation',
            categories: ['fossil_fuels'],
            severity: 'high',
            reason: 'Major integrated oil and gas producer.'
          }
        ],
        datasetVersion: '1.0',
        datasetLastUpdated: '2025-01-15',
        requestedSymbols: ['AAPL', 'DEF'],
        matchedSymbols: ['AAPL'],
        unmatchedSymbols: ['DEF']
      })
    };

    component.ngOnChanges();
    fixture.detectChanges();

    expect(fixture.debugElement.query(By.css('.esg-card'))).toBeTruthy();

    const text = (
      fixture.debugElement.query(By.css('.esg-card')).nativeElement as HTMLElement
    ).textContent;

    expect(text).toContain('ESG Compliance');
    expect(text).toContain('Score: 68.27%');
    expect(text).toContain('fossil fuels');
    expect(text).toContain('v1.0');
    expect(text).toContain('Requested: AAPL, DEF');
    expect(text).toContain('Unmatched: DEF');
  });

  it('renders payload error state in tool card', () => {
    component.toolCall = {
      name: 'portfolio_risk_analysis',
      args: {},
      result: JSON.stringify({
        error: 'No holdings found in portfolio.'
      })
    };

    component.ngOnChanges();
    fixture.detectChanges();

    const errorText = (
      fixture.debugElement.query(By.css('.tool-error')).nativeElement as HTMLElement
    ).textContent;

    expect(errorText).toContain('No holdings found in portfolio.');
  });

  it('renders parse-failure fallback card for invalid JSON', () => {
    component.toolCall = {
      name: 'market_data_fetch',
      args: {},
      result: '{invalid json'
    };

    component.ngOnChanges();
    fixture.detectChanges();

    const fallback = fixture.debugElement.query(By.css('.fallback-card'));
    const text = (fallback.nativeElement as HTMLElement).textContent;

    expect(fallback).toBeTruthy();
    expect(text).toContain('Tool output unavailable');
    expect(text).toContain('could not be parsed as valid JSON');
  });

  it('renders unknown-tool fallback card', () => {
    component.toolCall = {
      name: 'scenario_analysis',
      args: {},
      result: JSON.stringify({})
    };

    component.ngOnChanges();
    fixture.detectChanges();

    const text = (
      fixture.debugElement.query(By.css('.fallback-card')).nativeElement as HTMLElement
    ).textContent;

    expect(text).toContain('No dedicated renderer for tool "scenario_analysis".');
  });

  it('renders unrecognized payload fallback for empty known tool payload', () => {
    component.toolCall = {
      name: 'compliance_check',
      args: {},
      result: JSON.stringify({})
    };

    component.ngOnChanges();
    fixture.detectChanges();

    const text = (
      fixture.debugElement.query(By.css('.fallback-card')).nativeElement as HTMLElement
    ).textContent;

    expect(text).toContain('Compliance payload was empty or in an unsupported format.');
  });
});
