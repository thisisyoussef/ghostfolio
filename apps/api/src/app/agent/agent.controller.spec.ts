// Mock the PortfolioService MODULE to break the deep import chain
// (redis-cache TS errors). This does NOT mock behavior — we provide
// real TestPortfolioService instances via NestJS DI below.
jest.mock('@ghostfolio/api/app/portfolio/portfolio.service', () => ({
  PortfolioService: class MockPortfolioServiceToken {}
}));

import { PortfolioService } from '@ghostfolio/api/app/portfolio/portfolio.service';
import { Test, TestingModule } from '@nestjs/testing';
import { REQUEST } from '@nestjs/core';

import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';
import { SessionMemoryService } from './memory/session-memory.service';
import {
  TestPortfolioService,
  FailingPortfolioService,
  makeTestHoldings
} from './testing/test-portfolio.service';

const TEST_USER_ID = 'test-user-id';

/**
 * Integration tests for AgentController.
 * Uses REAL AgentService with TestPortfolioService — real class, in-memory data.
 * jest.mock above is only to break the TS import chain (redis-cache),
 * NOT to mock behavior. All routing, compliance checking, and formatting
 * execute as real code.
 *
 * Substitutions (all at real boundaries):
 *   - TestPortfolioService: real class, in-memory holdings (database boundary)
 *   - REQUEST provider: HTTP framework boundary
 *   - global.fetch: network boundary (Yahoo Finance, market data tests only)
 */
describe('AgentController (integration)', () => {
  let controller: AgentController;

  async function buildModule(portfolioService: any) {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AgentController],
      providers: [
        AgentService,
        { provide: SessionMemoryService, useValue: new SessionMemoryService() },
        { provide: PortfolioService, useValue: portfolioService },
        { provide: REQUEST, useValue: { user: { id: TEST_USER_ID } } }
      ]
    }).compile();

    return module.get<AgentController>(AgentController);
  }

  beforeEach(async () => {
    controller = await buildModule(
      new TestPortfolioService(makeTestHoldings())
    );
  });

  // --- Existing tests (updated to use real service) ---

  it('should return response with tool call for market question', async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        chart: {
          result: [
            {
              meta: {
                regularMarketPrice: 195.23,
                shortName: 'Apple Inc.'
              }
            }
          ]
        }
      })
    });

    try {
      const result = await controller.chat({
        message: 'What is the price of AAPL?',
        session_id: 'test-1'
      });

      expect(result).toHaveProperty('response');
      expect(result).toHaveProperty('tool_calls');
      expect(result).toHaveProperty('session_id', 'test-1');
      expect(result.tool_calls.length).toBeGreaterThan(0);
      expect(result.tool_calls[0].name).toBe('market_data_fetch');
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('should route portfolio risk question to portfolio_risk_analysis tool', async () => {
    const result = await controller.chat({
      message: "What's my portfolio concentration risk?",
      session_id: 'test-portfolio'
    });

    expect(result.tool_calls).toHaveLength(1);
    expect(result.tool_calls[0].name).toBe('portfolio_risk_analysis');
    expect(result.session_id).toBe('test-portfolio');
    const toolResult = JSON.parse(result.tool_calls[0].result);
    expect(toolResult).toHaveProperty('concentration');
    expect(toolResult).toHaveProperty('allocation');
    expect(toolResult).toHaveProperty('performance');
  });

  it('should route ESG compliance question to compliance_check tool', async () => {
    const result = await controller.chat({
      message: 'Is my portfolio ESG compliant?',
      session_id: 'test-esg'
    });

    expect(result.tool_calls).toHaveLength(1);
    expect(result.tool_calls[0].name).toBe('compliance_check');
    expect(result.session_id).toBe('test-esg');
    expect(result.response).toContain('ESG Compliance Report');
  });

  it('should return 200 with help message for empty input', async () => {
    const result = await controller.chat({
      message: '',
      session_id: 'test-2'
    });

    expect(result).toHaveProperty('response');
    expect(result).toHaveProperty('session_id', 'test-2');
    expect(result.response).toContain('Please provide a message');
  });

  // --- New integration tests ---

  it('should return snake_case field names (tool_calls, session_id) in HTTP response', async () => {
    const result = await controller.chat({
      message: 'Is my portfolio ESG compliant?',
      session_id: 'test-snake-case'
    });

    expect(result).toHaveProperty('tool_calls');
    expect(result).toHaveProperty('session_id');
    expect(result).not.toHaveProperty('toolCalls');
    expect(result).not.toHaveProperty('sessionId');
  });

  it('should return 200 with error text when portfolio service is unavailable', async () => {
    const failController = await buildModule(new FailingPortfolioService());

    const result = await failController.chat({
      message: 'Is my portfolio ESG compliant?',
      session_id: 'test-fail'
    });

    expect(result.response).toContain('unavailable');
    expect(result.session_id).toBe('test-fail');
    expect(result.tool_calls).toHaveLength(0);
  });

  it('should forward ESG message with filter keywords and get filtered results', async () => {
    const result = await controller.chat({
      message: 'Check my fossil fuel exposure for ESG compliance',
      session_id: 'test-filter'
    });

    expect(result.tool_calls).toHaveLength(1);
    expect(result.tool_calls[0].name).toBe('compliance_check');
    const toolResult = JSON.parse(result.tool_calls[0].result);
    expect(toolResult.violations.length).toBeGreaterThanOrEqual(1);
    expect(
      toolResult.violations.every((v: any) =>
        v.categories.includes('fossil_fuels')
      )
    ).toBe(true);
  });

  it('should include compliance_check tool_call with result containing datasetVersion', async () => {
    const result = await controller.chat({
      message: 'Run an ESG compliance check on my portfolio',
      session_id: 'test-dataset'
    });

    expect(result.tool_calls).toHaveLength(1);
    const toolResult = JSON.parse(result.tool_calls[0].result);
    expect(toolResult).toHaveProperty('datasetVersion', '1.0');
    expect(toolResult).toHaveProperty('datasetLastUpdated');
    expect(toolResult).toHaveProperty('complianceScore');
    expect(toolResult).toHaveProperty('totalChecked');
  });

  // --- Layer 2: Memory integration tests ---

  it('should carry context: "how about MSFT?" after AAPL uses same session', async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        chart: {
          result: [{ meta: { regularMarketPrice: 150, shortName: 'Test' } }]
        }
      })
    });

    try {
      await controller.chat({
        message: 'Price of AAPL',
        session_id: 'memory-test'
      });
      const result = await controller.chat({
        message: 'How about MSFT?',
        session_id: 'memory-test'
      });

      expect(result.tool_calls).toHaveLength(1);
      expect(result.tool_calls[0].name).toBe('market_data_fetch');
      const toolResult = JSON.parse(result.tool_calls[0].result);
      expect(toolResult).toHaveProperty('MSFT');
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('should not carry context across different session_ids', async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        chart: {
          result: [{ meta: { regularMarketPrice: 150, shortName: 'Test' } }]
        }
      })
    });

    try {
      await controller.chat({
        message: 'Price of AAPL',
        session_id: 'session-A'
      });
      const result = await controller.chat({
        message: 'How about it?',
        session_id: 'session-B'
      });

      expect(result.tool_calls).toHaveLength(0);
      expect(result.response).toContain('I can help you with');
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('should include is_error and error_type when portfolio service fails', async () => {
    const failController = await buildModule(new FailingPortfolioService());
    const result = await failController.chat({
      message: "What's my portfolio risk?",
      session_id: 'error-test'
    });

    expect(result.is_error).toBe(true);
    expect(result.error_type).toBeDefined();
    expect(result.response).toBeTruthy();
  });

  it('should include session_id in error responses', async () => {
    const failController = await buildModule(new FailingPortfolioService());
    const result = await failController.chat({
      message: "What's my portfolio concentration?",
      session_id: 'err-session-echo'
    });

    expect(result.session_id).toBe('err-session-echo');
  });

  it('should not leak stack traces in any error response', async () => {
    const failController = await buildModule(new FailingPortfolioService());
    const result = await failController.chat({
      message: 'Check my portfolio allocation',
      session_id: 'no-stack'
    });

    expect(result.response).not.toMatch(/at\s+\w+\s+\(/);
    expect(result.response).not.toContain('.ts:');
  });

  // --- Layer 4: Contract tests ---

  it('should return error response matching { is_error, error_type, session_id } shape', async () => {
    const failController = await buildModule(new FailingPortfolioService());
    const result = await failController.chat({
      message: "What's my portfolio risk?",
      session_id: 'contract-error'
    });

    expect(typeof result.response).toBe('string');
    expect(typeof result.is_error).toBe('boolean');
    expect(typeof result.error_type).toBe('string');
    expect(['data', 'tool', 'model', 'service']).toContain(result.error_type);
    expect(Array.isArray(result.tool_calls)).toBe(true);
    expect(typeof result.session_id).toBe('string');
  });

  it('should omit is_error and error_type on success responses', async () => {
    const result = await controller.chat({
      message: 'Is my portfolio ESG compliant?',
      session_id: 'contract-success'
    });

    expect(result.is_error).toBeUndefined();
    expect(result.error_type).toBeUndefined();
  });

  it('should never return raw stack trace or internal error details to client', async () => {
    const failController = await buildModule(new FailingPortfolioService());
    const result = await failController.chat({
      message: 'Check ESG compliance',
      session_id: 'contract-no-stack'
    });

    expect(result.response).not.toContain('node_modules');
    expect(result.response).not.toContain('at Object.');
    expect(result.response).not.toContain('TypeError');
  });
});
