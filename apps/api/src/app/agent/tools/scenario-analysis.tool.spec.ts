import { scenarioAnalysis } from './scenario-analysis.tool';

const TEST_USER_ID = 'test-user-id';

function makeMockPortfolioService(holdings: Record<string, any> = {}) {
  return {
    getDetails: jest.fn().mockResolvedValue({
      holdings,
      hasErrors: false
    }),
    getPerformance: jest.fn().mockResolvedValue({
      hasErrors: false,
      performance: {
        currentValueInBaseCurrency: 100000,
        netPerformance: 8000,
        netPerformancePercentage: 0.08,
        totalInvestment: 92000
      }
    })
  };
}

describe('scenarioAnalysis', () => {
  it('should return stress metrics for expected-shortfall prompt', async () => {
    const holdings = {
      AAPL: {
        allocationInPercentage: 0.45,
        assetClass: 'EQUITY',
        name: 'Apple Inc.',
        valueInBaseCurrency: 45000
      },
      BND: {
        allocationInPercentage: 0.35,
        assetClass: 'DEBT',
        name: 'Vanguard Total Bond Market',
        valueInBaseCurrency: 35000
      },
      MSFT: {
        allocationInPercentage: 0.2,
        assetClass: 'EQUITY',
        name: 'Microsoft Corporation',
        valueInBaseCurrency: 20000
      }
    };

    const result = await scenarioAnalysis(
      {
        message: 'Calculate expected shortfall if markets drop 20% tomorrow.'
      },
      makeMockPortfolioService(holdings),
      TEST_USER_ID
    );

    expect(result.error).toBeUndefined();
    expect(result.scenarioType).toBe('market_stress');
    expect(result.assumptions.marketDropPercent).toBe(20);
    expect(result.estimates.expectedShortfallAmount).toBeGreaterThan(0);
    expect(result.verification?.checks.outputSchema.passed).toBe(true);
  });

  it('should return up/down rate impacts for basis-point sensitivity prompt', async () => {
    const holdings = {
      BND: {
        allocationInPercentage: 0.6,
        assetClass: 'DEBT',
        name: 'Vanguard Total Bond Market',
        valueInBaseCurrency: 60000
      },
      AAPL: {
        allocationInPercentage: 0.4,
        assetClass: 'EQUITY',
        name: 'Apple Inc.',
        valueInBaseCurrency: 40000
      }
    };

    const result = await scenarioAnalysis(
      {
        message:
          'Breakeven if rates go up another 50 basis points versus down 25 basis points?'
      },
      makeMockPortfolioService(holdings),
      TEST_USER_ID
    );

    expect(result.error).toBeUndefined();
    expect(result.scenarioType).toBe('breakeven');
    expect(result.assumptions.rateUpBps).toBe(50);
    expect(result.assumptions.rateDownBps).toBe(25);
    expect(result.estimates.rateUpImpactPercent).toBeLessThan(0);
    expect(result.estimates.rateDownImpactPercent).toBeGreaterThan(0);
  });

  it('should return user-friendly error when user id is missing', async () => {
    const result = await scenarioAnalysis(
      { message: 'stress test my portfolio' },
      makeMockPortfolioService({}),
      ''
    );

    expect(result.error).toContain('authenticated user');
    expect(result.verification?.confidenceLevel).toBe('low');
  });
});
