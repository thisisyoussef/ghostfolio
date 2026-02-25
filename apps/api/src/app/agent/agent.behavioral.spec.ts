/**
 * Layer 3: Agent Behavioral Tests
 *
 * Tests the agent's routing logic, response quality, and behavioral guarantees
 * WITHOUT hitting external APIs. Market data tool is mocked at the network boundary.
 * Portfolio service uses TestPortfolioService (real class, in-memory data).
 */

// Mock PortfolioService module to break deep import chain (redis-cache TS errors)
jest.mock('@ghostfolio/api/app/portfolio/portfolio.service', () => ({
  PortfolioService: class MockPortfolioServiceToken {}
}));

// Mock market data fetch to avoid real HTTP calls
jest.mock('./tools/market-data.tool', () => ({
  marketDataFetch: jest.fn()
}));

import { AgentService } from './agent.service';
import { PortfolioService } from '@ghostfolio/api/app/portfolio/portfolio.service';
import { marketDataFetch } from './tools/market-data.tool';
import { SessionMemoryService } from './memory/session-memory.service';
import {
  TestPortfolioService,
  FailingPortfolioService,
  makeTestHoldings
} from './testing/test-portfolio.service';

const mockedMarketDataFetch = marketDataFetch as jest.MockedFunction<
  typeof marketDataFetch
>;

describe('AgentService — Behavioral Tests (Layer 3)', () => {
  let service: AgentService;
  const TEST_USER_ID = 'behavioral-test-user';
  const TEST_SESSION = 'behavioral-session';

  beforeEach(() => {
    jest.clearAllMocks();
    const testPortfolioService = new TestPortfolioService(makeTestHoldings());
    service = new AgentService(
      testPortfolioService as unknown as PortfolioService,
      new SessionMemoryService()
    );
  });

  // === Tool Routing Accuracy ===

  it('should route "price of AAPL" to market_data_fetch, not portfolio_risk_analysis', async () => {
    mockedMarketDataFetch.mockResolvedValue({
      AAPL: { symbol: 'AAPL', name: 'Apple Inc.', price: 195.23 }
    });

    const result = await service.chat({
      message: 'What is the price of AAPL?',
      sessionId: TEST_SESSION,
      userId: TEST_USER_ID
    });

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe('market_data_fetch');
    expect(mockedMarketDataFetch).toHaveBeenCalledWith({
      symbols: ['AAPL']
    });
  });

  it('should route "portfolio risk" to portfolio_risk_analysis, not market_data_fetch', async () => {
    const result = await service.chat({
      message: "What's my portfolio risk?",
      sessionId: TEST_SESSION,
      userId: TEST_USER_ID
    });

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe('portfolio_risk_analysis');
    expect(mockedMarketDataFetch).not.toHaveBeenCalled();
  });

  it('should route ESG question to compliance_check, not other tools', async () => {
    const result = await service.chat({
      message: 'Is my portfolio ESG compliant?',
      sessionId: TEST_SESSION,
      userId: TEST_USER_ID
    });

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe('compliance_check');
    expect(mockedMarketDataFetch).not.toHaveBeenCalled();
  });

  // === Ambiguous Query Handling ===

  it('should extract ticker symbols from ambiguous queries', async () => {
    mockedMarketDataFetch.mockResolvedValue({
      TSLA: { symbol: 'TSLA', name: 'Tesla Inc.', price: 250.0 }
    });

    const result = await service.chat({
      message: 'Tell me about TSLA',
      sessionId: TEST_SESSION,
      userId: TEST_USER_ID
    });

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe('market_data_fetch');
  });

  // === Hallucination Guard ===

  it('should include actual tool data in response, not fabricated values', async () => {
    mockedMarketDataFetch.mockResolvedValue({
      AAPL: {
        symbol: 'AAPL',
        name: 'Apple Inc.',
        price: 195.23
      }
    });

    const result = await service.chat({
      message: 'Price of AAPL',
      sessionId: TEST_SESSION,
      userId: TEST_USER_ID
    });

    // Response must contain the actual price from the tool, not a made-up number
    expect(result.response).toMatch(/195\.23/);
    // Verify the tool result is stored in tool_calls for traceability
    const toolResult = JSON.parse(result.toolCalls[0].result);
    expect(toolResult.AAPL.price).toBe(195.23);
  });

  // === Graceful Degradation ===

  it('should return user-friendly message when portfolio service fails', async () => {
    const failService = new AgentService(
      new FailingPortfolioService() as unknown as PortfolioService,
      new SessionMemoryService()
    );

    const result = await failService.chat({
      message: 'Is my portfolio ESG compliant?',
      sessionId: TEST_SESSION,
      userId: TEST_USER_ID
    });

    expect(result.response).toMatch(/unable|unavailable|error/i);
    // Should not contain stack traces or technical details
    expect(result.response).not.toMatch(/at\s+\w+\s+\(/);
  });

  // === Refusal Behavior ===

  it('should not invoke any tool for out-of-scope requests', async () => {
    const result = await service.chat({
      message: 'Write me a poem about investing',
      sessionId: TEST_SESSION,
      userId: TEST_USER_ID
    });

    // Should provide help text, not invoke a tool
    expect(result.toolCalls).toHaveLength(0);
    expect(result.response).toMatch(/help|can help|stock|market|portfolio/i);
  });

  // === Empty/Invalid Input Handling ===

  it('should handle empty message without crashing', async () => {
    const result = await service.chat({
      message: '',
      sessionId: TEST_SESSION,
      userId: TEST_USER_ID
    });

    expect(result.response).toBeDefined();
    expect(result.response.length).toBeGreaterThan(0);
    expect(result.toolCalls).toHaveLength(0);
  });

  // === Session ID Passthrough ===

  it('should preserve session_id across the request lifecycle', async () => {
    mockedMarketDataFetch.mockResolvedValue({
      MSFT: { symbol: 'MSFT', name: 'Microsoft', price: 420.0 }
    });

    const uniqueSession = `session-${Date.now()}`;
    const result = await service.chat({
      message: 'Price of MSFT',
      sessionId: uniqueSession,
      userId: TEST_USER_ID
    });

    expect(result.sessionId).toBe(uniqueSession);
  });

  // === Invalid Symbol Handling (gs-004) ===

  it('should route long invalid symbols like XYZNOTREAL to market_data_fetch instead of fallback', async () => {
    mockedMarketDataFetch.mockResolvedValue({
      XYZNOTREAL: {
        symbol: 'XYZNOTREAL',
        error: 'No data returned for XYZNOTREAL'
      }
    });

    const result = await service.chat({
      message: 'Get me the price of XYZNOTREAL',
      sessionId: TEST_SESSION,
      userId: TEST_USER_ID
    });

    // Tool must be called (not dropped by regex)
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe('market_data_fetch');
    expect(mockedMarketDataFetch).toHaveBeenCalledWith({
      symbols: ['XYZNOTREAL']
    });

    // Response must mention the symbol
    expect(result.response).toContain('XYZNOTREAL');

    // Response must NOT be the generic fallback
    expect(result.response).not.toContain('I can help you with');
  });

  // === ESG Category Filter Detection ===

  it('should detect category filter in compliance questions', async () => {
    const result = await service.chat({
      message: 'Do I hold any fossil fuel companies?',
      sessionId: TEST_SESSION,
      userId: TEST_USER_ID
    });

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe('compliance_check');
    // Should filter to fossil_fuels category
    const toolArgs = result.toolCalls[0].args;
    expect(toolArgs.filterCategory).toBe('fossil_fuels');
  });
});
