/**
 * Layer 3: ESG Compliance Behavioral Tests
 *
 * Tests the full AgentService routing + compliance tool + formatting pipeline.
 * Uses REAL AgentService, REAL complianceCheck(), REAL esg-violations.json.
 *
 * Only boundary substitutions:
 *   - TestPortfolioService / FailingPortfolioService (database boundary, real classes)
 *   - global.fetch (network boundary, only for market data routing test)
 */

// Mock module import chain only (redis-cache TS errors), not behavior
jest.mock('@ghostfolio/api/app/portfolio/portfolio.service', () => ({
  PortfolioService: class MockPortfolioServiceToken {}
}));

import { PortfolioService } from '@ghostfolio/api/app/portfolio/portfolio.service';

import { AgentService, ChatResponse } from '../agent.service';
import { SessionMemoryService } from '../memory/session-memory.service';
import {
  TestPortfolioService,
  FailingPortfolioService,
  makeTestHoldings
} from '../testing/test-portfolio.service';

// Load real ESG dataset for validation
// eslint-disable-next-line @typescript-eslint/no-var-requires
const esgDataset = require('../data/esg-violations.json');

const TEST_USER = 'behavioral-test-user';
const TEST_SESSION = 'behavioral-session';

describe('ESG Compliance — Behavioral Tests (Layer 3)', () => {
  let service: AgentService;

  function buildService(portfolioService: any): AgentService {
    return new AgentService(
      portfolioService as PortfolioService,
      new SessionMemoryService()
    );
  }

  beforeEach(() => {
    process.env.ENABLE_FEATURE_AGENT_LANGGRAPH = 'false';
    service = buildService(new TestPortfolioService(makeTestHoldings()));
  });

  // Test 1: Route "Is my portfolio ESG compliant?" → compliance_check
  it('should route ESG compliance question to compliance_check tool', async () => {
    const result: ChatResponse = await service.chat({
      message: 'Is my portfolio ESG compliant?',
      sessionId: TEST_SESSION,
      userId: TEST_USER
    });

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe('compliance_check');
    expect(result.response).toContain('ESG Compliance Report');
    expect(result.response).toContain('Compliance Score');
  });

  // Test 2: Route "fossil fuel exposure" → compliance_check with fossil_fuels filter
  it('should detect fossil fuel filter and return only fossil_fuels violations', async () => {
    const result = await service.chat({
      message: 'What is my fossil fuel exposure?',
      sessionId: TEST_SESSION,
      userId: TEST_USER
    });

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe('compliance_check');
    const toolArgs = result.toolCalls[0].args;
    expect(toolArgs.filterCategory).toBe('fossil_fuels');

    const toolResult = JSON.parse(result.toolCalls[0].result);
    for (const v of toolResult.violations) {
      expect(v.categories).toContain('fossil_fuels');
    }
  });

  // Test 3: Every violation symbol in result exists in esg-violations.json
  it('should only report violations that exist in the real ESG dataset', async () => {
    const result = await service.chat({
      message: 'Check my ESG compliance',
      sessionId: TEST_SESSION,
      userId: TEST_USER
    });

    const toolResult = JSON.parse(result.toolCalls[0].result);
    const datasetSymbols = new Set(
      esgDataset.violations.map((v: any) => v.symbol.toUpperCase())
    );

    for (const violation of toolResult.violations) {
      expect(datasetSymbols.has(violation.symbol.toUpperCase())).toBe(true);
    }
  });

  // Test 4: Route "what about weapons?" → compliance_check
  it('should route weapons question to compliance_check', async () => {
    const result = await service.chat({
      message: 'Do I have any weapons stocks in my ESG portfolio?',
      sessionId: TEST_SESSION,
      userId: TEST_USER
    });

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe('compliance_check');
    const toolArgs = result.toolCalls[0].args;
    expect(toolArgs.filterCategory).toBe('weapons_defense');
  });

  // Test 5: portfolioService.getDetails throws → error message response (not exception)
  it('should return error message when portfolio service throws', async () => {
    const failingService = buildService(new FailingPortfolioService());

    const result = await failingService.chat({
      message: 'Is my portfolio ESG compliant?',
      sessionId: TEST_SESSION,
      userId: TEST_USER
    });

    expect(result.response).toMatch(/unavailable/i);
    expect(result.toolCalls).toHaveLength(0);
    // Must not throw — verified by reaching this line
  });

  // Test 6: Each call preserves its sessionId in response
  it('should preserve sessionId in every response', async () => {
    const uniqueSession = `session-${Date.now()}-${Math.random()}`;

    const result = await service.chat({
      message: 'ESG compliance check please',
      sessionId: uniqueSession,
      userId: TEST_USER
    });

    expect(result.sessionId).toBe(uniqueSession);
  });

  // Test 7: "What is AAPL price?" does NOT route to compliance_check
  it('should NOT route market data question to compliance_check', async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        chart: {
          result: [
            { meta: { regularMarketPrice: 195.0, shortName: 'Apple Inc.' } }
          ]
        }
      })
    });

    try {
      const result = await service.chat({
        message: 'What is AAPL price?',
        sessionId: TEST_SESSION,
        userId: TEST_USER
      });

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('market_data_fetch');
      expect(result.toolCalls[0].name).not.toBe('compliance_check');
    } finally {
      global.fetch = originalFetch;
    }
  });

  // Test 8: Response text includes dataset version from esg-violations.json
  it('should include dataset version in response text', async () => {
    const result = await service.chat({
      message: 'Run ESG compliance check',
      sessionId: TEST_SESSION,
      userId: TEST_USER
    });

    expect(result.response).toContain(`v${esgDataset.version}`);
    expect(result.response).toContain(esgDataset.lastUpdated);
  });
});
