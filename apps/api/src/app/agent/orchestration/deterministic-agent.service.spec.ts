// Mock import chain only (redis-cache TS errors), not business behavior
jest.mock('@ghostfolio/api/app/portfolio/portfolio.service', () => ({
  PortfolioService: class MockPortfolioServiceToken {}
}));

jest.mock('../tools/market-data.tool', () => ({
  marketDataFetch: jest.fn()
}));

import { PortfolioService } from '@ghostfolio/api/app/portfolio/portfolio.service';

import { SessionMemoryService } from '../memory/session-memory.service';
import {
  TestPortfolioService,
  makeTestHoldings
} from '../testing/test-portfolio.service';
import { marketDataFetch } from '../tools/market-data.tool';
import { DeterministicAgentService } from './deterministic-agent.service';

const mockedMarketDataFetch = marketDataFetch as jest.MockedFunction<
  typeof marketDataFetch
>;

describe('DeterministicAgentService', () => {
  const TEST_USER = 'user-1';
  const TEST_SESSION = 'session-1';

  let service: DeterministicAgentService;

  beforeEach(() => {
    jest.clearAllMocks();

    service = new DeterministicAgentService(
      new TestPortfolioService(makeTestHoldings()) as unknown as PortfolioService,
      new SessionMemoryService()
    );
  });

  it('should route market query to market_data_fetch', async () => {
    mockedMarketDataFetch.mockResolvedValue({
      AAPL: { name: 'Apple Inc.', price: 190.25, symbol: 'AAPL' }
    });

    const response = await service.chat({
      message: 'Price of AAPL',
      sessionId: TEST_SESSION,
      userId: TEST_USER
    });

    expect(response.toolCalls).toHaveLength(1);
    expect(response.toolCalls[0].name).toBe('market_data_fetch');
    expect(response.response).toContain('AAPL');
  });

  it('should route portfolio query to portfolio_risk_analysis', async () => {
    const response = await service.chat({
      message: 'Show my portfolio risk',
      sessionId: TEST_SESSION,
      userId: TEST_USER
    });

    expect(response.toolCalls).toHaveLength(1);
    expect(response.toolCalls[0].name).toBe('portfolio_risk_analysis');
  });

  it('should route ESG query to compliance_check', async () => {
    const response = await service.chat({
      message: 'Is my portfolio ESG compliant?',
      sessionId: TEST_SESSION,
      userId: TEST_USER
    });

    expect(response.toolCalls).toHaveLength(1);
    expect(response.toolCalls[0].name).toBe('compliance_check');
    expect(response.response).toContain('ESG Compliance Report');
  });

  it('should return help text for out-of-scope question', async () => {
    const response = await service.chat({
      message: 'write me a poem',
      sessionId: TEST_SESSION,
      userId: TEST_USER
    });

    expect(response.toolCalls).toHaveLength(0);
    expect(response.response).toContain('I can help you with');
  });
});
