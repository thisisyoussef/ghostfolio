jest.mock('@ghostfolio/api/app/portfolio/portfolio.service', () => ({
  PortfolioService: class MockPortfolioServiceToken {}
}));

jest.mock('../tools/market-data.tool', () => ({
  marketDataFetch: jest.fn()
}));

jest.mock('../tools/portfolio-rebalance-preview.tool', () => ({
  portfolioRebalancePreview: jest.fn()
}));

import { AgentError, ErrorType } from '../errors/agent-error';
import { marketDataFetch } from '../tools/market-data.tool';
import { portfolioRebalancePreview } from '../tools/portfolio-rebalance-preview.tool';
import { AgentToolRegistry } from './tool-registry';

const mockedMarketDataFetch = marketDataFetch as jest.MockedFunction<
  typeof marketDataFetch
>;
const mockedPortfolioRebalancePreview =
  portfolioRebalancePreview as jest.MockedFunction<
    typeof portfolioRebalancePreview
  >;

describe('AgentToolRegistry', () => {
  const userId = 'user-1';

  function buildRegistry() {
    return new AgentToolRegistry({} as any);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockedMarketDataFetch.mockResolvedValue({});
    mockedPortfolioRebalancePreview.mockResolvedValue({
      assumptions: {
        excludedSymbols: [],
        methodology: 'test',
        portfolioValue: 10000,
        rebalanceMode: 'read_only_preview',
        syntheticSleeveCount: 1,
        targetMaxHoldingPct: 20
      },
      currentTopHoldings: [],
      projectedConcentration: {
        concentrationReductionPct: 0,
        currentHerfindahlIndex: 0.3,
        currentTopHoldingPct: 50,
        projectedHerfindahlIndex: 0.2,
        projectedTopHoldingPct: 20
      },
      suggestedTrades: []
    });
  });

  it('filters natural-language uppercase tokens before market_data_fetch', async () => {
    const registry = buildRegistry();

    await registry.executeToolCall(
      'market_data_fetch',
      { symbols: ['should', 'AAPL', 'msft', 'both'] },
      { userId }
    );

    expect(mockedMarketDataFetch).toHaveBeenCalledTimes(1);
    expect(mockedMarketDataFetch).toHaveBeenCalledWith({
      symbols: ['AAPL', 'MSFT']
    });
  });

  it('throws user-actionable tool error when no valid symbols remain', async () => {
    const registry = buildRegistry();

    await expect(
      registry.executeToolCall(
        'market_data_fetch',
        { symbols: ['should', 'both', 'yes'] },
        { userId }
      )
    ).rejects.toMatchObject<Partial<AgentError>>({
      type: ErrorType.TOOL,
      recoverable: true
    });

    expect(mockedMarketDataFetch).not.toHaveBeenCalled();
  });

  it('applies default target and normalized exclusions for portfolio_rebalance_preview', async () => {
    const registry = buildRegistry();

    await registry.executeToolCall(
      'portfolio_rebalance_preview',
      { excludeSymbols: ['xom', 'both', 'MSFT'] },
      { userId }
    );

    expect(mockedPortfolioRebalancePreview).toHaveBeenCalledTimes(1);
    expect(mockedPortfolioRebalancePreview).toHaveBeenCalledWith(
      {
        excludeSymbols: ['XOM', 'MSFT'],
        targetMaxHoldingPct: 20
      },
      expect.anything(),
      userId
    );
  });

  it('rejects out-of-range targetMaxHoldingPct for portfolio_rebalance_preview', async () => {
    const registry = buildRegistry();

    await expect(
      registry.executeToolCall(
        'portfolio_rebalance_preview',
        { targetMaxHoldingPct: 40 },
        { userId }
      )
    ).rejects.toThrow();

    expect(mockedPortfolioRebalancePreview).not.toHaveBeenCalled();
  });
});
