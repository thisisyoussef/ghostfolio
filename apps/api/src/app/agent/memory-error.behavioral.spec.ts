jest.mock('@ghostfolio/api/app/portfolio/portfolio.service', () => ({
  PortfolioService: class MockPortfolioServiceToken {}
}));

import { PortfolioService } from '@ghostfolio/api/app/portfolio/portfolio.service';
import { Test } from '@nestjs/testing';
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

describe('Agent Memory & Error Behavior (Layer 3)', () => {
  let controller: AgentController;

  async function buildController(portfolioService: any) {
    const module = await Test.createTestingModule({
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
    controller = await buildController(
      new TestPortfolioService(makeTestHoldings())
    );
  });

  it('should remember context from turn 1 when answering turn 2', async () => {
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
      await controller.chat({ message: 'Price of AAPL', session_id: 'beh-1' });
      const r2 = await controller.chat({
        message: 'How about MSFT?',
        session_id: 'beh-1'
      });
      expect(r2.tool_calls.length).toBeGreaterThan(0);
      expect(r2.tool_calls[0].name).toBe('market_data_fetch');
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('should handle "what about MSFT?" after asking about AAPL (follow-up pattern)', async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        chart: {
          result: [
            { meta: { regularMarketPrice: 400, shortName: 'Microsoft' } }
          ]
        }
      })
    });

    try {
      await controller.chat({
        message: 'What is the price of AAPL?',
        session_id: 'beh-2'
      });
      const r2 = await controller.chat({
        message: 'What about MSFT?',
        session_id: 'beh-2'
      });
      const toolResult = JSON.parse(r2.tool_calls[0].result);
      expect(toolResult).toHaveProperty('MSFT');
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('should not hallucinate previous conversation — new session has no history', async () => {
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
      await controller.chat({ message: 'Price of AAPL', session_id: 'beh-3a' });
      const r = await controller.chat({
        message: 'How about it?',
        session_id: 'beh-3b'
      });
      expect(r.tool_calls).toHaveLength(0);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('should handle tool failure mid-conversation → explain error, maintain history', async () => {
    const originalFetch = global.fetch;
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          chart: {
            result: [{ meta: { regularMarketPrice: 150, shortName: 'Test' } }]
          }
        })
      })
      .mockRejectedValueOnce(new Error('Network timeout'));

    try {
      const r1 = await controller.chat({
        message: 'Price of AAPL',
        session_id: 'beh-4'
      });
      expect(r1.tool_calls).toHaveLength(1);

      const r2 = await controller.chat({
        message: 'How about MSFT?',
        session_id: 'beh-4'
      });
      expect(r2.response).toBeTruthy();
      expect(r2.session_id).toBe('beh-4');
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('should not leak session A data into session B responses', async () => {
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
        session_id: 'isolated-A'
      });
      await controller.chat({
        message: 'Price of TSLA',
        session_id: 'isolated-B'
      });
      const r = await controller.chat({
        message: 'How about MSFT?',
        session_id: 'isolated-A'
      });
      expect(r.tool_calls[0].name).toBe('market_data_fetch');
      const toolResult = JSON.parse(r.tool_calls[0].result);
      expect(toolResult).not.toHaveProperty('TSLA');
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('should recover gracefully from service unavailable → user-friendly message', async () => {
    const failController = await buildController(new FailingPortfolioService());
    const result = await failController.chat({
      message: "What's my portfolio risk?",
      session_id: 'beh-6'
    });

    expect(result.response).toBeTruthy();
    expect(result.response).not.toMatch(/at\s+\w+\s+\(/);
    expect(result.session_id).toBe('beh-6');
  });

  it('should handle concurrent messages to same session without data corruption', async () => {
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
      const results = await Promise.all([
        controller.chat({ message: 'Price of AAPL', session_id: 'concurrent' }),
        controller.chat({ message: 'Price of MSFT', session_id: 'concurrent' })
      ]);
      expect(results[0].response).toBeTruthy();
      expect(results[1].response).toBeTruthy();
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('should classify errors correctly: service error for portfolio failure', async () => {
    const failController = await buildController(new FailingPortfolioService());
    const result = await failController.chat({
      message: 'Show my portfolio allocation',
      session_id: 'beh-8'
    });

    expect(result.is_error).toBe(true);
    expect(result.error_type).toBe('service');
  });
});
