import { portfolioRiskAnalysis } from './portfolio-analysis.tool';

// Mock PortfolioService
function makeMockPortfolioService(holdings: Record<string, any> = {}) {
  return {
    getDetails: jest.fn().mockResolvedValue({
      holdings,
      hasErrors: false
    }),
    getPerformance: jest.fn().mockResolvedValue({
      hasErrors: false,
      performance: {
        currentNetWorth: 100000,
        currentValueInBaseCurrency: 95000,
        netPerformance: 5000,
        netPerformancePercentage: 0.05,
        totalInvestment: 90000
      }
    })
  };
}

// Mock PrismaService
function makeMockPrismaService(userId: string = 'test-user-id') {
  return {
    user: {
      findFirst: jest.fn().mockResolvedValue({ id: userId })
    }
  };
}

describe('portfolioRiskAnalysis', () => {
  describe('concentration calculation', () => {
    it('should calculate 100% concentration and HHI=1.0 for single holding', async () => {
      const holdings = {
        AAPL: {
          allocationInPercentage: 1.0,
          assetClass: 'EQUITY',
          name: 'Apple Inc.',
          symbol: 'AAPL',
          valueInBaseCurrency: 10000,
          netPerformancePercent: 0.1,
          sectors: [{ name: 'Technology', weight: 1.0 }]
        }
      };

      const mockPortfolioService = makeMockPortfolioService(holdings);
      const mockPrismaService = makeMockPrismaService();

      const result = await portfolioRiskAnalysis(
        {},
        mockPortfolioService as any,
        mockPrismaService as any
      );

      expect(result.concentration.topHoldingSymbol).toBe('AAPL');
      expect(result.concentration.topHoldingPercent).toBe(100);
      expect(result.concentration.herfindahlIndex).toBeCloseTo(1.0, 2);
    });

    it('should calculate HHI ≈ 0.33 for three equal holdings', async () => {
      const holdings = {
        AAPL: {
          allocationInPercentage: 1 / 3,
          assetClass: 'EQUITY',
          name: 'Apple Inc.',
          symbol: 'AAPL',
          valueInBaseCurrency: 10000,
          netPerformancePercent: 0.05,
          sectors: [{ name: 'Technology', weight: 1.0 }]
        },
        MSFT: {
          allocationInPercentage: 1 / 3,
          assetClass: 'EQUITY',
          name: 'Microsoft Corp.',
          symbol: 'MSFT',
          valueInBaseCurrency: 10000,
          netPerformancePercent: 0.08,
          sectors: [{ name: 'Technology', weight: 1.0 }]
        },
        GOOGL: {
          allocationInPercentage: 1 / 3,
          assetClass: 'EQUITY',
          name: 'Alphabet Inc.',
          symbol: 'GOOGL',
          valueInBaseCurrency: 10000,
          netPerformancePercent: 0.03,
          sectors: [{ name: 'Technology', weight: 1.0 }]
        }
      };

      const mockPortfolioService = makeMockPortfolioService(holdings);
      const mockPrismaService = makeMockPrismaService();

      const result = await portfolioRiskAnalysis(
        {},
        mockPortfolioService as any,
        mockPrismaService as any
      );

      // HHI = 3 * (1/3)^2 = 3 * 1/9 = 1/3 ≈ 0.333
      expect(result.concentration.herfindahlIndex).toBeCloseTo(0.333, 2);
    });

    it('should return top 5 holdings sorted by allocation', async () => {
      const holdings = {
        AAPL: {
          allocationInPercentage: 0.4,
          assetClass: 'EQUITY',
          name: 'Apple',
          symbol: 'AAPL',
          valueInBaseCurrency: 40000,
          netPerformancePercent: 0.1,
          sectors: []
        },
        MSFT: {
          allocationInPercentage: 0.25,
          assetClass: 'EQUITY',
          name: 'Microsoft',
          symbol: 'MSFT',
          valueInBaseCurrency: 25000,
          netPerformancePercent: 0.08,
          sectors: []
        },
        GOOGL: {
          allocationInPercentage: 0.15,
          assetClass: 'EQUITY',
          name: 'Alphabet',
          symbol: 'GOOGL',
          valueInBaseCurrency: 15000,
          netPerformancePercent: 0.05,
          sectors: []
        },
        BND: {
          allocationInPercentage: 0.12,
          assetClass: 'DEBT',
          name: 'Vanguard Bond',
          symbol: 'BND',
          valueInBaseCurrency: 12000,
          netPerformancePercent: 0.02,
          sectors: []
        },
        VWO: {
          allocationInPercentage: 0.05,
          assetClass: 'EQUITY',
          name: 'Vanguard EM',
          symbol: 'VWO',
          valueInBaseCurrency: 5000,
          netPerformancePercent: -0.01,
          sectors: []
        },
        XOM: {
          allocationInPercentage: 0.03,
          assetClass: 'EQUITY',
          name: 'Exxon Mobil',
          symbol: 'XOM',
          valueInBaseCurrency: 3000,
          netPerformancePercent: 0.06,
          sectors: []
        }
      };

      const mockPortfolioService = makeMockPortfolioService(holdings);
      const mockPrismaService = makeMockPrismaService();

      const result = await portfolioRiskAnalysis(
        {},
        mockPortfolioService as any,
        mockPrismaService as any
      );

      expect(result.concentration.topHoldings).toHaveLength(5);
      expect(result.concentration.topHoldings[0].symbol).toBe('AAPL');
      expect(result.concentration.topHoldings[0].percentage).toBe(40);
      expect(result.concentration.topHoldings[1].symbol).toBe('MSFT');
    });
  });

  describe('allocation breakdown', () => {
    it('should group holdings by asset class correctly', async () => {
      const holdings = {
        AAPL: {
          allocationInPercentage: 0.5,
          assetClass: 'EQUITY',
          name: 'Apple',
          symbol: 'AAPL',
          valueInBaseCurrency: 50000,
          netPerformancePercent: 0.1,
          sectors: [{ name: 'Technology', weight: 1.0 }]
        },
        BND: {
          allocationInPercentage: 0.3,
          assetClass: 'DEBT',
          name: 'Vanguard Bond',
          symbol: 'BND',
          valueInBaseCurrency: 30000,
          netPerformancePercent: 0.02,
          sectors: []
        },
        BTC: {
          allocationInPercentage: 0.2,
          assetClass: 'COMMODITY',
          name: 'Bitcoin',
          symbol: 'BTC',
          valueInBaseCurrency: 20000,
          netPerformancePercent: 0.5,
          sectors: []
        }
      };

      const mockPortfolioService = makeMockPortfolioService(holdings);
      const mockPrismaService = makeMockPrismaService();

      const result = await portfolioRiskAnalysis(
        {},
        mockPortfolioService as any,
        mockPrismaService as any
      );

      expect(result.allocation.byAssetClass).toEqual({
        EQUITY: 50,
        DEBT: 30,
        COMMODITY: 20
      });
    });

    it('should handle holdings with missing asset class', async () => {
      const holdings = {
        AAPL: {
          allocationInPercentage: 0.7,
          assetClass: 'EQUITY',
          name: 'Apple',
          symbol: 'AAPL',
          valueInBaseCurrency: 70000,
          netPerformancePercent: 0.1,
          sectors: []
        },
        UNKNOWN: {
          allocationInPercentage: 0.3,
          assetClass: undefined,
          name: 'Unknown Asset',
          symbol: 'UNKNOWN',
          valueInBaseCurrency: 30000,
          netPerformancePercent: 0.0,
          sectors: []
        }
      };

      const mockPortfolioService = makeMockPortfolioService(holdings);
      const mockPrismaService = makeMockPrismaService();

      const result = await portfolioRiskAnalysis(
        {},
        mockPortfolioService as any,
        mockPrismaService as any
      );

      expect(result.allocation.byAssetClass).toEqual({
        EQUITY: 70,
        UNKNOWN: 30
      });
    });
  });

  describe('performance summary', () => {
    it('should include performance metrics from portfolio service', async () => {
      const holdings = {
        AAPL: {
          allocationInPercentage: 1.0,
          assetClass: 'EQUITY',
          name: 'Apple',
          symbol: 'AAPL',
          valueInBaseCurrency: 10000,
          netPerformancePercent: 0.1,
          sectors: []
        }
      };

      const mockPortfolioService = makeMockPortfolioService(holdings);
      const mockPrismaService = makeMockPrismaService();

      const result = await portfolioRiskAnalysis(
        {},
        mockPortfolioService as any,
        mockPrismaService as any
      );

      expect(result.performance).toBeDefined();
      expect(result.performance.currentValue).toBe(95000);
      expect(result.performance.totalReturn).toBe(5000);
      expect(result.performance.totalReturnPercent).toBeCloseTo(5, 1);
    });
  });

  describe('error handling', () => {
    it('should handle empty portfolio gracefully', async () => {
      const mockPortfolioService = makeMockPortfolioService({});
      const mockPrismaService = makeMockPrismaService();

      const result = await portfolioRiskAnalysis(
        {},
        mockPortfolioService as any,
        mockPrismaService as any
      );

      expect(result.error).toBeDefined();
      expect(result.error).toContain('No holdings');
    });

    it('should handle missing user gracefully', async () => {
      const mockPortfolioService = makeMockPortfolioService({});
      const mockPrismaService = {
        user: {
          findFirst: jest.fn().mockResolvedValue(null)
        }
      };

      const result = await portfolioRiskAnalysis(
        {},
        mockPortfolioService as any,
        mockPrismaService as any
      );

      expect(result.error).toBeDefined();
      expect(result.error).toContain('user');
    });

    it('should handle portfolio service error gracefully', async () => {
      const mockPortfolioService = {
        getDetails: jest
          .fn()
          .mockRejectedValue(new Error('Database connection failed')),
        getPerformance: jest.fn()
      };
      const mockPrismaService = makeMockPrismaService();

      const result = await portfolioRiskAnalysis(
        {},
        mockPortfolioService as any,
        mockPrismaService as any
      );

      expect(result.error).toBeDefined();
      expect(result.error).toContain('Unable to access portfolio data');
    });
  });

  describe('service calls', () => {
    it('should call portfolioService.getDetails with correct parameters', async () => {
      const holdings = {
        AAPL: {
          allocationInPercentage: 1.0,
          assetClass: 'EQUITY',
          name: 'Apple',
          symbol: 'AAPL',
          valueInBaseCurrency: 10000,
          netPerformancePercent: 0.1,
          sectors: []
        }
      };

      const mockPortfolioService = makeMockPortfolioService(holdings);
      const mockPrismaService = makeMockPrismaService('test-user-123');

      await portfolioRiskAnalysis(
        {},
        mockPortfolioService as any,
        mockPrismaService as any
      );

      expect(mockPortfolioService.getDetails).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'test-user-123',
          withSummary: true
        })
      );
    });
  });
});
