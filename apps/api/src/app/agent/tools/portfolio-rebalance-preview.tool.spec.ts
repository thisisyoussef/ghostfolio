import { portfolioRebalancePreview } from './portfolio-rebalance-preview.tool';

const TEST_USER_ID = 'test-user-id';

function makeMockPortfolioService(holdings: Record<string, any> = {}) {
  return {
    getDetails: jest.fn().mockResolvedValue({
      hasErrors: false,
      holdings
    })
  };
}

describe('portfolioRebalancePreview', () => {
  it('returns deterministic rebalance trades with default 20% target', async () => {
    const holdings = {
      AAPL: {
        allocationInPercentage: 0.5,
        name: 'Apple Inc.',
        valueInBaseCurrency: 5000
      },
      MSFT: {
        allocationInPercentage: 0.3,
        name: 'Microsoft Corporation',
        valueInBaseCurrency: 3000
      },
      XOM: {
        allocationInPercentage: 0.2,
        name: 'Exxon Mobil Corporation',
        valueInBaseCurrency: 2000
      }
    };

    const result = await portfolioRebalancePreview(
      {},
      makeMockPortfolioService(holdings),
      TEST_USER_ID
    );

    expect(result.error).toBeUndefined();
    expect(result.currentTopHoldings).toHaveLength(3);
    expect(result.projectedConcentration.currentTopHoldingPct).toBe(50);
    expect(result.projectedConcentration.projectedTopHoldingPct).toBe(20);
    expect(result.projectedConcentration.projectedHerfindahlIndex).toBeLessThan(
      result.projectedConcentration.currentHerfindahlIndex
    );
    expect(result.suggestedTrades).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'SELL',
          symbol: 'AAPL',
          tradePercent: 30
        }),
        expect.objectContaining({
          action: 'SELL',
          symbol: 'MSFT',
          tradePercent: 10
        }),
        expect.objectContaining({
          action: 'BUY',
          symbol: 'DIVERSIFIED_BASKET',
          tradePercent: 40
        })
      ])
    );
    expect(result.assumptions.targetMaxHoldingPct).toBe(20);
    expect(result.assumptions.syntheticSleeveCount).toBe(2);
    expect(result.verification?.checks.outputSchema.passed).toBe(true);
  });

  it('respects excluded symbols and skips trimming those holdings', async () => {
    const holdings = {
      AAPL: {
        allocationInPercentage: 0.5,
        name: 'Apple Inc.',
        valueInBaseCurrency: 5000
      },
      MSFT: {
        allocationInPercentage: 0.3,
        name: 'Microsoft Corporation',
        valueInBaseCurrency: 3000
      },
      XOM: {
        allocationInPercentage: 0.2,
        name: 'Exxon Mobil Corporation',
        valueInBaseCurrency: 2000
      }
    };

    const result = await portfolioRebalancePreview(
      {
        excludeSymbols: ['aapl'],
        targetMaxHoldingPct: 20
      },
      makeMockPortfolioService(holdings),
      TEST_USER_ID
    );

    const sellSymbols = result.suggestedTrades
      .filter((trade) => trade.action === 'SELL')
      .map((trade) => trade.symbol);

    expect(sellSymbols).not.toContain('AAPL');
    expect(sellSymbols).toContain('MSFT');
    expect(result.assumptions.excludedSymbols).toEqual(['AAPL']);
    expect(result.projectedConcentration.projectedTopHoldingPct).toBe(50);
  });

  it('returns user-friendly error when user id is missing', async () => {
    const result = await portfolioRebalancePreview(
      {},
      makeMockPortfolioService({}),
      ''
    );

    expect(result.error).toContain('authenticated user');
    expect(result.verification?.confidenceLevel).toBe('low');
    expect(result.suggestedTrades).toHaveLength(0);
  });

  it('returns user-friendly error when portfolio has no holdings', async () => {
    const result = await portfolioRebalancePreview(
      { targetMaxHoldingPct: 25 },
      makeMockPortfolioService({}),
      TEST_USER_ID
    );

    expect(result.error).toContain('No holdings');
    expect(result.assumptions.targetMaxHoldingPct).toBe(25);
    expect(result.currentTopHoldings).toHaveLength(0);
  });
});
