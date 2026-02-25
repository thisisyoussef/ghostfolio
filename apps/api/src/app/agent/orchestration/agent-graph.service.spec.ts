jest.mock('@ghostfolio/api/app/portfolio/portfolio.service', () => ({
  PortfolioService: class MockPortfolioServiceToken {}
}));

import { AgentError, ErrorType } from '../errors/agent-error';
import { AgentGraphService } from './agent-graph.service';

describe('AgentGraphService', () => {
  const userId = 'user-1';
  const sessionId = 'session-1';

  function buildService() {
    const sessionMemory = {
      getConversationContext: jest.fn().mockResolvedValue({
        recentMessages: [],
        summary: '',
        turnCount: 0
      })
    };

    const toolRegistry = {
      getLangChainTools: jest.fn().mockReturnValue([])
    };

    return {
      service: new AgentGraphService(sessionMemory as any, toolRegistry as any),
      sessionMemory,
      toolRegistry
    };
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should return a single-tool flow response from graph output', async () => {
    const { service } = buildService();

    jest.spyOn(service as any, 'buildModel').mockReturnValue({});
    jest.spyOn(service as any, 'buildInitialMessages').mockResolvedValue([]);
    jest.spyOn(service as any, 'extractFinalResponse').mockReturnValue('AAPL is $190');
    jest.spyOn(service as any, 'buildGraph').mockReturnValue({
      invoke: jest.fn().mockResolvedValue({
        messages: [],
        toolCalls: [
          {
            args: { symbols: ['AAPL'] },
            name: 'market_data_fetch',
            result: '{"AAPL":{"price":190}}'
          }
        ]
      })
    });

    const response = await service.chat({
      message: 'What is AAPL price?',
      sessionId,
      userId
    });

    expect(response.response).toBe('AAPL is $190');
    expect(response.toolCalls).toHaveLength(1);
    expect(response.toolCalls[0].name).toBe('market_data_fetch');
  });

  it('should preserve two-tool loop outputs in one turn', async () => {
    const { service } = buildService();

    jest.spyOn(service as any, 'buildModel').mockReturnValue({});
    jest.spyOn(service as any, 'buildInitialMessages').mockResolvedValue([]);
    jest
      .spyOn(service as any, 'extractFinalResponse')
      .mockReturnValue('Risk reviewed and ESG checked.');
    jest.spyOn(service as any, 'buildGraph').mockReturnValue({
      invoke: jest.fn().mockResolvedValue({
        messages: [],
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
      })
    });

    const response = await service.chat({
      message: 'How risky am I and is it ESG compliant?',
      sessionId,
      userId
    });

    expect(response.toolCalls).toHaveLength(2);
    expect(response.toolCalls[0].name).toBe('portfolio_risk_analysis');
    expect(response.toolCalls[1].name).toBe('compliance_check');
  });

  it('should return graph max-step fallback response when extracted response is fallback text', async () => {
    const { service } = buildService();

    jest.spyOn(service as any, 'buildModel').mockReturnValue({});
    jest.spyOn(service as any, 'buildInitialMessages').mockResolvedValue([]);
    jest
      .spyOn(service as any, 'extractFinalResponse')
      .mockReturnValue(
        'I reached the tool execution step limit before finalizing the answer. Please narrow the question and try again.'
      );
    jest.spyOn(service as any, 'buildGraph').mockReturnValue({
      invoke: jest.fn().mockResolvedValue({ messages: [], toolCalls: [] })
    });

    const response = await service.chat({
      message: 'Do a complex multi-step analysis',
      sessionId,
      userId
    });

    expect(response.response).toContain('step limit');
  });

  it('should propagate model timeout as model-classified error', async () => {
    const { service } = buildService();

    jest.spyOn(service as any, 'buildModel').mockReturnValue({});
    jest.spyOn(service as any, 'buildInitialMessages').mockResolvedValue([]);
    jest.spyOn(service as any, 'buildGraph').mockReturnValue({
      invoke: jest.fn().mockRejectedValue(
        new AgentError(ErrorType.MODEL, 'Model timed out after 12000ms.', true)
      )
    });

    await expect(
      service.chat({
        message: 'analyze risk',
        sessionId,
        userId
      })
    ).rejects.toMatchObject({
      type: ErrorType.MODEL,
      userMessage: 'Model timed out after 12000ms.'
    });
  });
});
