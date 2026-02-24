/**
 * Real in-memory substitute for PortfolioService.
 * Not a mock — a real class with real logic, backed by in-memory data.
 * Reusable across all agent test layers.
 */
export class TestPortfolioService {
  constructor(private holdings: Record<string, any> = {}) {}

  async getDetails(_params: { userId: string; [key: string]: any }) {
    return { holdings: this.holdings, hasErrors: false };
  }

  async getPerformance(_params: { userId: string; [key: string]: any }) {
    return {
      hasErrors: false,
      performance: {
        currentValueInBaseCurrency: this.totalValue(),
        netPerformance: this.totalValue() * 0.05,
        netPerformancePercentage: 0.05,
        totalInvestment: this.totalValue() * 0.95
      }
    };
  }

  private totalValue(): number {
    return Object.values(this.holdings).reduce(
      (sum: number, h: any) => sum + (h.valueInBaseCurrency || 0),
      0
    );
  }
}

/**
 * A PortfolioService substitute that always throws — for testing error paths.
 * Real class, not a mock.
 */
export class FailingPortfolioService {
  async getDetails(): Promise<never> {
    throw new Error('Portfolio service unavailable');
  }

  async getPerformance(): Promise<never> {
    throw new Error('Portfolio service unavailable');
  }
}

/**
 * Factory for standard test holdings data.
 * Includes one ESG-flagged ticker (XOM) for compliance testing.
 */
export function makeTestHoldings() {
  return {
    XOM: {
      name: 'Exxon Mobil Corporation',
      allocationInPercentage: 0.2,
      assetClass: 'EQUITY',
      valueInBaseCurrency: 2000
    },
    AAPL: {
      name: 'Apple Inc.',
      allocationInPercentage: 0.5,
      assetClass: 'EQUITY',
      valueInBaseCurrency: 5000
    },
    MSFT: {
      name: 'Microsoft Corporation',
      allocationInPercentage: 0.3,
      assetClass: 'EQUITY',
      valueInBaseCurrency: 3000
    }
  };
}

/**
 * Factory for a clean-only portfolio (no ESG violations).
 */
export function makeCleanHoldings() {
  return {
    AAPL: {
      name: 'Apple Inc.',
      allocationInPercentage: 0.5,
      assetClass: 'EQUITY',
      valueInBaseCurrency: 5000
    },
    MSFT: {
      name: 'Microsoft Corporation',
      allocationInPercentage: 0.3,
      assetClass: 'EQUITY',
      valueInBaseCurrency: 3000
    },
    GOOGL: {
      name: 'Alphabet Inc.',
      allocationInPercentage: 0.2,
      assetClass: 'EQUITY',
      valueInBaseCurrency: 2000
    }
  };
}
