jest.mock('@ghostfolio/api/app/portfolio/portfolio.service', () => ({
  PortfolioService: class MockPortfolioServiceToken {}
}));

import { AgentError, ErrorType } from '../errors/agent-error';
import { AgentGraphService } from './agent-graph.service';
import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';

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
        reasoningMs: 0,
        tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        toolExecutions: [],
        toolCalls: [
          {
            args: { symbols: ['AAPL'] },
            name: 'market_data_fetch',
            result: '{"AAPL":{"price":190}}'
          }
        ],
        toolMs: 0
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
        reasoningMs: 0,
        tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        toolExecutions: [],
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
        ],
        toolMs: 0
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
      invoke: jest.fn().mockResolvedValue({
        messages: [],
        reasoningMs: 0,
        tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        toolCalls: [],
        toolExecutions: [],
        toolMs: 0
      })
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

  it('should emit exactly one system message with summary embedded in graph context', async () => {
    const sessionMemory = {
      getConversationContext: jest.fn().mockResolvedValue({
        recentMessages: [
          { role: 'user', content: 'Hi', createdAt: Date.now() },
          {
            role: 'tool',
            content: '{"complianceScore":68}',
            createdAt: Date.now(),
            toolName: 'compliance_check',
            toolResultSummary: 'Compliance score 68'
          },
          { role: 'assistant', content: 'Done', createdAt: Date.now() }
        ],
        summary: 'User asked for risk and ESG earlier.',
        turnCount: 2
      })
    };
    const toolRegistry = {
      getLangChainTools: jest.fn().mockReturnValue([])
    };
    const service = new AgentGraphService(
      sessionMemory as any,
      toolRegistry as any
    );

    const messages = await (service as any).buildInitialMessages(
      userId,
      sessionId,
      'Follow-up'
    );

    const systemMessages = messages.filter(
      (message: unknown) => message instanceof SystemMessage
    );
    expect(systemMessages).toHaveLength(1);
    expect(String((systemMessages[0] as SystemMessage).content)).toContain(
      'Conversation summary'
    );
    expect(String((systemMessages[0] as SystemMessage).content)).toContain(
      'User asked for risk and ESG earlier.'
    );
    expect(messages.some((message) => message instanceof HumanMessage)).toBe(
      true
    );
  });

  it('should trim oversized history to stay within graph context budget', async () => {
    const veryLargeContent = 'X'.repeat(20_000);
    const sessionMemory = {
      getConversationContext: jest.fn().mockResolvedValue({
        recentMessages: [
          {
            role: 'tool',
            content: veryLargeContent,
            createdAt: Date.now(),
            toolName: 'compliance_check',
            toolResultSummary: veryLargeContent
          },
          {
            role: 'assistant',
            content: veryLargeContent,
            createdAt: Date.now()
          }
        ],
        summary: veryLargeContent,
        turnCount: 4
      })
    };
    const toolRegistry = {
      getLangChainTools: jest.fn().mockReturnValue([])
    };
    const service = new AgentGraphService(
      sessionMemory as any,
      toolRegistry as any
    );

    const messages = await (service as any).buildInitialMessages(
      userId,
      sessionId,
      'follow up'
    );
    const totalChars = messages.reduce((sum: number, message: any) => {
      const content = typeof message.content === 'string' ? message.content : '';
      return sum + content.length;
    }, 0);

    expect(totalChars).toBeLessThan(16_000);
  });

  it('should execute duplicate tool calls once per identical arg set in a single node run', async () => {
    const { service, toolRegistry } = buildService();
    const executeToolCall = jest.fn().mockResolvedValue({
      complianceScore: 88
    });
    (toolRegistry as any).executeToolCall = executeToolCall;

    const state = {
      messages: [
        new AIMessage({
          content: '',
          tool_calls: [
            {
              id: 'tool-1',
              name: 'compliance_check',
              args: { symbols: ['XOM'] }
            },
            {
              id: 'tool-2',
              name: 'compliance_check',
              args: { symbols: ['XOM'] }
            }
          ] as any
        })
      ],
      toolCalls: [],
      toolExecutions: [],
      toolMs: 0
    } as any;

    const result = await (service as any).toolNode(state, userId);

    expect(executeToolCall).toHaveBeenCalledTimes(1);
    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolExecutions).toHaveLength(2);
    expect(result.toolExecutions[1].latencyMs).toBe(0);
  });
});
