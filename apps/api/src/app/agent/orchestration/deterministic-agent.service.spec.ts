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
  let sessionMemory: SessionMemoryService;

  beforeEach(() => {
    jest.clearAllMocks();
    sessionMemory = new SessionMemoryService();

    service = new DeterministicAgentService(
      new TestPortfolioService(makeTestHoldings()) as unknown as PortfolioService,
      sessionMemory
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

  it('should run both portfolio and ESG tools for combined question', async () => {
    const response = await service.chat({
      message: 'How risky am I and is it ESG compliant?',
      sessionId: TEST_SESSION,
      userId: TEST_USER
    });

    expect(response.toolCalls).toHaveLength(2);
    expect(response.toolCalls.map((toolCall) => toolCall.name)).toEqual([
      'portfolio_risk_analysis',
      'compliance_check'
    ]);
    expect(response.response).toContain('Combined Portfolio Risk + ESG Review');
  });

  it('should rank ESG offenders when user asks for biggest impact', async () => {
    const response = await service.chat({
      message:
        'Which of my flagged holdings has the biggest negative impact on my ESG score?',
      sessionId: TEST_SESSION,
      userId: TEST_USER
    });

    expect(response.toolCalls).toHaveLength(1);
    expect(response.toolCalls[0].name).toBe('compliance_check');
    expect(response.response).toContain('ESG Impact Ranking');
    expect(response.response).toContain('Biggest negative impact');
  });

  it('should estimate ESG score change for remove-all hypothetical', async () => {
    const response = await service.chat({
      message:
        'Given all three violations are rated high, what would my score be if all of them were removed?',
      sessionId: TEST_SESSION,
      userId: TEST_USER
    });

    expect(response.toolCalls).toHaveLength(1);
    expect(response.toolCalls[0].name).toBe('compliance_check');
    expect(response.response).toContain('Hypothetical Scenario');
    expect(response.response).toContain('estimated compliance score would be');
  });

  it('should route stress-test prompts to scenario_analysis', async () => {
    const response = await service.chat({
      message: 'Calculate expected shortfall if markets drop 20% tomorrow',
      sessionId: TEST_SESSION,
      userId: TEST_USER
    });

    expect(response.toolCalls).toHaveLength(1);
    expect(response.toolCalls[0].name).toBe('scenario_analysis');
    expect(response.response).toContain('Scenario Analysis');
    expect(response.response).toContain('Estimated shortfall');
  });

  it('should avoid market_data_fetch misrouting for "add bonds" hypothetical phrasing', async () => {
    const response = await service.chat({
      message: 'What if I reduce tech exposure by 15% and add bonds?',
      sessionId: TEST_SESSION,
      userId: TEST_USER
    });

    expect(response.toolCalls).toHaveLength(1);
    expect(response.toolCalls[0].name).toBe('scenario_analysis');
    expect(response.toolCalls.map((toolCall) => toolCall.name)).not.toContain(
      'market_data_fetch'
    );
  });

  it('should scope compliance to explicit requested holdings symbols', async () => {
    const response = await service.chat({
      message: 'ESG score for ABC and DEF specifically',
      sessionId: TEST_SESSION,
      userId: TEST_USER
    });

    expect(response.toolCalls).toHaveLength(1);
    expect(response.toolCalls[0].name).toBe('compliance_check');
    expect(response.toolCalls[0].args).toMatchObject({
      symbols: ['ABC', 'DEF']
    });
    expect(response.response).toContain('Requested holdings:** ABC, DEF');
    expect(response.response).toContain('Matched in portfolio:** none');
  });

  it('should resolve short "both" follow-up using recent clarification context', async () => {
    await sessionMemory.appendMessages(TEST_USER, TEST_SESSION, [
      {
        content: 'How risky am I and is it ESG compliant?',
        createdAt: Date.now() - 2_000,
        role: 'user'
      },
      {
        content:
          'I need a quick clarification — did you mean ESG impact, rebalancing suggestions, or both of the above?',
        createdAt: Date.now() - 1_000,
        role: 'assistant'
      }
    ]);

    const response = await service.chat({
      message: 'both',
      sessionId: TEST_SESSION,
      userId: TEST_USER
    });

    expect(response.toolCalls.map((toolCall) => toolCall.name)).toEqual([
      'portfolio_risk_analysis',
      'compliance_check'
    ]);
    expect(response.response).not.toContain('I can help you with');
    expect(response.response).toContain('Rebalancing Suggestions');
  });

  it('should resolve "All of the above." follow-up with punctuation', async () => {
    await sessionMemory.appendMessages(TEST_USER, TEST_SESSION, [
      {
        content:
          'I need a quick clarification — did you mean risk analysis, ESG impact, or all of the above?',
        createdAt: Date.now() - 2_000,
        role: 'assistant'
      }
    ]);

    const response = await service.chat({
      message: 'All of the above.',
      sessionId: TEST_SESSION,
      userId: TEST_USER
    });

    expect(response.toolCalls.map((toolCall) => toolCall.name)).toEqual([
      'portfolio_risk_analysis',
      'compliance_check'
    ]);
    expect(response.response).not.toContain('I can help you with');
  });

  it('should route exposure-style risk prompts to portfolio_risk_analysis', async () => {
    const response = await service.chat({
      message: 'Oil prices just spiked. How exposed am I?',
      sessionId: TEST_SESSION,
      userId: TEST_USER
    });

    expect(response.toolCalls).toHaveLength(1);
    expect(response.toolCalls[0].name).toBe('portfolio_risk_analysis');
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
