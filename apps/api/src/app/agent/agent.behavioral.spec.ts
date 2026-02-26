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
import { AgentError, ErrorType } from './errors/agent-error';
import { PortfolioService } from '@ghostfolio/api/app/portfolio/portfolio.service';
import { marketDataFetch } from './tools/market-data.tool';
import { SessionMemoryService } from './memory/session-memory.service';
import { AgentObservabilityService } from './observability/agent-observability.service';
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
    process.env.ENABLE_FEATURE_AGENT_LANGGRAPH = 'false';
    const testPortfolioService = new TestPortfolioService(makeTestHoldings());
    service = new AgentService(
      testPortfolioService as unknown as PortfolioService,
      new SessionMemoryService()
    );
  });

  afterEach(() => {
    process.env.ENABLE_FEATURE_AGENT_LANGGRAPH = 'false';
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

  it('should route explicit rebalance prompts to portfolio_rebalance_preview', async () => {
    const result = await service.chat({
      message:
        'Rebalance my portfolio with a max holding cap of 20% and exclude XOM.',
      sessionId: TEST_SESSION,
      userId: TEST_USER_ID
    });

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe('portfolio_rebalance_preview');
    expect(result.response).toContain('Portfolio Rebalance Preview');
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

  it('should append verification and sources sections for tool-backed responses', async () => {
    const result = await service.chat({
      message: 'Is my portfolio ESG compliant?',
      sessionId: TEST_SESSION,
      userId: TEST_USER_ID
    });

    expect(result.response).toContain('### Verification');
    expect(result.response).toContain('### Sources');
    expect(result.verification).toBeDefined();
    expect(result.verification?.confidenceScore).toBeGreaterThanOrEqual(0);
  });

  it('should increment tool failure counters for failed market tool payloads', async () => {
    const observability = new AgentObservabilityService();
    const serviceWithObservability = new AgentService(
      new TestPortfolioService(makeTestHoldings()) as unknown as PortfolioService,
      new SessionMemoryService(),
      undefined,
      observability
    );

    mockedMarketDataFetch.mockResolvedValue({
      AAPL: {
        error: 'No data returned for AAPL',
        symbol: 'AAPL'
      }
    });

    await serviceWithObservability.chat({
      message: 'Price of AAPL',
      sessionId: TEST_SESSION,
      userId: TEST_USER_ID
    });

    const metrics = await observability.getMetricsSnapshot();
    expect(metrics.tools.market_data_fetch.failure).toBeGreaterThanOrEqual(1);
    expect(metrics.errors.data).toBeGreaterThanOrEqual(1);
  });

  it('should surface discrepancy warning with downgraded confidence in verification summary', async () => {
    mockedMarketDataFetch.mockResolvedValue({
      AAPL: {
        symbol: 'AAPL',
        price: 100,
        sourceAttribution: {
          primary: {
            source: 'Yahoo Finance (chart v8)',
            timestamp: new Date().toISOString()
          },
          backup: {
            source: 'Stooq',
            timestamp: new Date().toISOString()
          }
        },
        verification: {
          status: 'warning',
          confidenceScore: 65,
          confidenceLevel: 'low',
          checks: {
            crossSourcePrice: {
              passed: false,
              reason: 'Discrepancy exceeds threshold.'
            },
            outputSchema: { passed: true },
            sourceAttribution: { passed: true }
          },
          sources: [
            {
              tool: 'market_data_fetch',
              claim: 'price quote for AAPL',
              source: 'Yahoo Finance (chart v8)',
              timestamp: new Date().toISOString()
            }
          ],
          generatedAt: new Date().toISOString()
        }
      }
    } as any);

    const result = await service.chat({
      message: 'Price of AAPL',
      sessionId: TEST_SESSION,
      userId: TEST_USER_ID
    });

    expect(result.verification?.status).toBe('warning');
    expect(result.verification?.confidenceLevel).toBe('low');
    expect(result.response).toContain('WARNING');
  });

  it('should return controlled data error if tool result JSON cannot be verified', async () => {
    process.env.ENABLE_FEATURE_AGENT_LANGGRAPH = 'true';

    const invalidToolService = new AgentService(
      new TestPortfolioService(makeTestHoldings()) as unknown as PortfolioService,
      new SessionMemoryService()
    );

    const graphChat = jest.fn().mockResolvedValue({
      response: 'Invalid tool payload run.',
      sessionId: TEST_SESSION,
      toolCalls: [
        {
          name: 'market_data_fetch',
          args: { symbols: ['AAPL'] },
          result: '{not-json'
        }
      ]
    });

    (invalidToolService as any).graphAgent = { chat: graphChat };

    const result = await invalidToolService.chat({
      message: 'Price of AAPL',
      sessionId: TEST_SESSION,
      userId: TEST_USER_ID
    });

    expect(result.isError).toBe(true);
    expect(result.errorType).toBe('data');
    expect(result.response).toContain('could not safely verify');
    expect(result.response).not.toMatch(/at\s+\w+\s+\(/);
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

    // Response must mention the symbol in a user-friendly way
    expect(result.response).toContain('XYZNOTREAL');
    // Should use natural language, not raw error strings
    expect(result.response).not.toMatch(/Failed to fetch data for/);

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

  it('should answer combined risk + ESG request in deterministic mode with two tool calls', async () => {
    const result = await service.chat({
      message: 'How risky am I and is it ESG compliant?',
      sessionId: TEST_SESSION,
      userId: TEST_USER_ID
    });

    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls[0].name).toBe('portfolio_risk_analysis');
    expect(result.toolCalls[1].name).toBe('compliance_check');
    expect(result.response).toContain('Combined Portfolio Risk + ESG Review');
  });

  it('should keep ESG follow-up context for hypothetical remove-all question', async () => {
    await service.chat({
      message: 'Is my portfolio ESG compliant?',
      sessionId: TEST_SESSION,
      userId: TEST_USER_ID
    });

    const result = await service.chat({
      message:
        'Given all three violations are rated high, what would my score be if all of them were removed?',
      sessionId: TEST_SESSION,
      userId: TEST_USER_ID
    });

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe('compliance_check');
    expect(result.response).toContain('Hypothetical Scenario');
  });

  it('should route expected shortfall prompts to scenario_analysis in deterministic mode', async () => {
    const result = await service.chat({
      message: 'Calculate expected shortfall for a 20% market drop',
      sessionId: TEST_SESSION,
      userId: TEST_USER_ID
    });

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe('scenario_analysis');
    expect(result.response).not.toContain('I can help you with');
    expect(result.response).toContain('Scenario Analysis');
  });

  it('should not misroute "add bonds" hypotheticals to market_data_fetch', async () => {
    const result = await service.chat({
      message: 'What if I reduce tech by 15% and add bonds?',
      sessionId: TEST_SESSION,
      userId: TEST_USER_ID
    });

    expect(result.toolCalls.map((toolCall) => toolCall.name)).toEqual([
      'scenario_analysis'
    ]);
    expect(mockedMarketDataFetch).not.toHaveBeenCalled();
  });

  it('should include explicit capability note for unsupported portfolio metrics', async () => {
    const result = await service.chat({
      message:
        "What's my portfolio correlation with the S&P 500 and Sharpe ratio?",
      sessionId: TEST_SESSION,
      userId: TEST_USER_ID
    });

    expect(result.toolCalls.map((toolCall) => toolCall.name)).toEqual([
      'portfolio_risk_analysis'
    ]);
    expect(result.response).toContain('Capability Note');
    expect(result.response).toContain('cannot directly compute');
  });

  it('should support multi-step tool chain in one turn when graph mode is enabled', async () => {
    process.env.ENABLE_FEATURE_AGENT_LANGGRAPH = 'true';

    const multiStepService = new AgentService(
      new TestPortfolioService(makeTestHoldings()) as unknown as PortfolioService,
      new SessionMemoryService()
    );

    const graphChat = jest
      .fn()
      .mockResolvedValue({
        response: 'Risk and ESG review completed.',
        sessionId: TEST_SESSION,
        toolCalls: [
          {
            args: {},
            name: 'portfolio_risk_analysis',
            result: '{"concentration":{}}'
          },
          {
            args: { filterCategory: 'fossil_fuels' },
            name: 'compliance_check',
            result: '{"complianceScore":95}'
          }
        ]
      });

    (multiStepService as any).graphAgent = { chat: graphChat };

    const result = await multiStepService.chat({
      message: 'How risky am I and is it ESG compliant?',
      sessionId: TEST_SESSION,
      userId: TEST_USER_ID
    });

    expect(graphChat).toHaveBeenCalled();
    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls[0].name).toBe('portfolio_risk_analysis');
    expect(result.toolCalls[1].name).toBe('compliance_check');
  });

  it('should run deterministic second pass when graph returns help menu for in-scope prompt', async () => {
    process.env.ENABLE_FEATURE_AGENT_LANGGRAPH = 'true';

    const secondPassService = new AgentService(
      new TestPortfolioService(makeTestHoldings()) as unknown as PortfolioService,
      new SessionMemoryService()
    );

    const graphChat = jest.fn().mockResolvedValue({
      response:
        'I can help you with:\n- Portfolio risk analysis\n- ESG compliance',
      sessionId: TEST_SESSION,
      toolCalls: []
    });
    const deterministicChat = jest.fn().mockResolvedValue({
      response: 'Deterministic in-scope recovery.',
      sessionId: TEST_SESSION,
      toolCalls: [
        {
          args: { message: 'Oil prices just spiked. How exposed am I?' },
          name: 'portfolio_risk_analysis',
          result: '{"concentration":{}}'
        }
      ]
    });

    (secondPassService as any).graphAgent = { chat: graphChat };
    (secondPassService as any).deterministicAgent = {
      chat: deterministicChat
    };

    const result = await secondPassService.chat({
      message: 'Oil prices just spiked. How exposed am I?',
      sessionId: TEST_SESSION,
      userId: TEST_USER_ID
    });

    expect(graphChat).toHaveBeenCalled();
    expect(deterministicChat).toHaveBeenCalled();
    expect(result.toolCalls.map((toolCall) => toolCall.name)).toEqual([
      'portfolio_risk_analysis'
    ]);
    expect(result.response).toContain('Deterministic in-scope recovery.');
    expect(result.response).not.toContain('deterministic fallback mode');
  });

  it('should retain context across five turns in same session', async () => {
    mockedMarketDataFetch.mockImplementation(
      async ({ symbols }: { symbols: string[] }) => {
        return symbols.reduce<Record<string, any>>(
          (acc, symbol) => ({
          ...acc,
          [symbol]: { name: symbol, price: 100, symbol }
          }),
          {}
        );
      }
    );

    await service.chat({
      message: 'Price of AAPL',
      sessionId: TEST_SESSION,
      userId: TEST_USER_ID
    });
    await service.chat({
      message: 'And MSFT?',
      sessionId: TEST_SESSION,
      userId: TEST_USER_ID
    });
    await service.chat({
      message: 'And GOOGL?',
      sessionId: TEST_SESSION,
      userId: TEST_USER_ID
    });
    await service.chat({
      message: 'And AMZN?',
      sessionId: TEST_SESSION,
      userId: TEST_USER_ID
    });

    const result = await service.chat({
      message: 'How about it?',
      sessionId: TEST_SESSION,
      userId: TEST_USER_ID
    });

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe('market_data_fetch');
    const toolResult = JSON.parse(result.toolCalls[0].result);
    expect(Object.keys(toolResult)).toContain('AMZN');
  });

  it('should fallback to deterministic path when graph model call fails', async () => {
    process.env.ENABLE_FEATURE_AGENT_LANGGRAPH = 'true';

    const fallbackService = new AgentService(
      new TestPortfolioService(makeTestHoldings()) as unknown as PortfolioService,
      new SessionMemoryService()
    );

    const graphChat = jest
      .fn()
      .mockRejectedValue(
        new AgentError(
          ErrorType.MODEL,
          'Model timed out after 12000ms.',
          true
        )
      );
    const deterministicChat = jest.fn().mockResolvedValue({
      response: 'Deterministic fallback response.',
      sessionId: TEST_SESSION,
      toolCalls: []
    });

    (fallbackService as any).graphAgent = { chat: graphChat };
    (fallbackService as any).deterministicAgent = { chat: deterministicChat };

    const result = await fallbackService.chat({
      message: 'Analyze my portfolio risk',
      sessionId: TEST_SESSION,
      userId: TEST_USER_ID
    });

    expect(graphChat).toHaveBeenCalled();
    expect(deterministicChat).toHaveBeenCalled();
    expect(result.response).toContain('Deterministic fallback response.');
    expect(result.response).not.toContain('deterministic fallback mode');
  });

  it('should handle short "both" follow-up via deterministic fallback without resetting context', async () => {
    process.env.ENABLE_FEATURE_AGENT_LANGGRAPH = 'true';

    const fallbackMemory = new SessionMemoryService();
    const fallbackService = new AgentService(
      new TestPortfolioService(makeTestHoldings()) as unknown as PortfolioService,
      fallbackMemory
    );

    await fallbackMemory.appendMessages(TEST_USER_ID, TEST_SESSION, [
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

    const graphChat = jest
      .fn()
      .mockRejectedValue(
        new AgentError(
          ErrorType.MODEL,
          'Model timed out after 12000ms.',
          true
        )
      );

    (fallbackService as any).graphAgent = { chat: graphChat };

    const result = await fallbackService.chat({
      message: 'both',
      sessionId: TEST_SESSION,
      userId: TEST_USER_ID
    });

    expect(result.toolCalls.map((toolCall) => toolCall.name)).toEqual([
      'portfolio_risk_analysis',
      'compliance_check'
    ]);
    expect(result.response).not.toContain('I can help you with');
    expect(result.response).not.toContain('deterministic fallback mode');
  });
});
