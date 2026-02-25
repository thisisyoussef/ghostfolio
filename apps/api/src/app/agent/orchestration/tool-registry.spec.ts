jest.mock('@ghostfolio/api/app/portfolio/portfolio.service', () => ({
  PortfolioService: class MockPortfolioServiceToken {}
}));

jest.mock('../tools/market-data.tool', () => ({
  marketDataFetch: jest.fn()
}));

import { AgentError, ErrorType } from '../errors/agent-error';
import { marketDataFetch } from '../tools/market-data.tool';
import { AgentToolRegistry } from './tool-registry';

const mockedMarketDataFetch = marketDataFetch as jest.MockedFunction<
  typeof marketDataFetch
>;

describe('AgentToolRegistry', () => {
  const userId = 'user-1';

  function buildRegistry() {
    return new AgentToolRegistry({} as any);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockedMarketDataFetch.mockResolvedValue({});
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
});
