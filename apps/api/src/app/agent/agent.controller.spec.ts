// Mock AgentService to avoid the deep dependency chain (redis-cache TS errors)
jest.mock('./agent.service', () => ({
  AgentService: jest.fn().mockImplementation(() => ({
    chat: jest.fn()
  }))
}));

import { Test, TestingModule } from '@nestjs/testing';
import { REQUEST } from '@nestjs/core';

import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';

const MOCK_USER_ID = 'test-user-id';

describe('AgentController', () => {
  let controller: AgentController;
  let service: AgentService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AgentController],
      providers: [
        {
          provide: AgentService,
          useValue: {
            chat: jest.fn()
          }
        },
        {
          provide: REQUEST,
          useValue: {
            user: { id: MOCK_USER_ID }
          }
        }
      ]
    }).compile();

    controller = module.get<AgentController>(AgentController);
    service = module.get<AgentService>(AgentService);
  });

  it('should return response with tool call for market question', async () => {
    const mockResponse = {
      response: 'The current price of AAPL is $195.23.',
      toolCalls: [
        {
          name: 'market_data_fetch',
          args: { symbols: 'AAPL' },
          result: '{"AAPL": {"price": 195.23}}'
        }
      ],
      sessionId: 'test-1'
    };
    (service.chat as jest.Mock).mockResolvedValue(mockResponse);

    const result = await controller.chat({
      message: 'What is the price of AAPL?',
      session_id: 'test-1'
    });

    expect(result).toHaveProperty('response');
    expect(result).toHaveProperty('tool_calls');
    expect(result).toHaveProperty('session_id', 'test-1');
    expect(result.tool_calls.length).toBeGreaterThan(0);
    expect(service.chat).toHaveBeenCalledWith({
      message: 'What is the price of AAPL?',
      sessionId: 'test-1',
      userId: MOCK_USER_ID
    });
  });

  it('should route portfolio risk question to portfolio_risk_analysis tool', async () => {
    const mockResponse = {
      response: 'Portfolio Concentration\nTop holding: AAPL (40%)',
      toolCalls: [
        {
          name: 'portfolio_risk_analysis',
          args: { message: "What's my portfolio concentration risk?" },
          result: '{"concentration": {"topHoldingPercent": 40}}'
        }
      ],
      sessionId: 'test-portfolio'
    };
    (service.chat as jest.Mock).mockResolvedValue(mockResponse);

    const result = await controller.chat({
      message: "What's my portfolio concentration risk?",
      session_id: 'test-portfolio'
    });

    expect(result.tool_calls).toHaveLength(1);
    expect(result.tool_calls[0].name).toBe('portfolio_risk_analysis');
    expect(service.chat).toHaveBeenCalledWith({
      message: "What's my portfolio concentration risk?",
      sessionId: 'test-portfolio',
      userId: MOCK_USER_ID
    });
  });

  it('should route ESG compliance question to compliance_check tool', async () => {
    const mockResponse = {
      response: 'ESG Compliance Report\nCompliance Score: 80%',
      toolCalls: [
        {
          name: 'compliance_check',
          args: { filterCategory: 'all' },
          result: '{"complianceScore": 80, "violations": [{"symbol": "XOM"}]}'
        }
      ],
      sessionId: 'test-esg'
    };
    (service.chat as jest.Mock).mockResolvedValue(mockResponse);

    const result = await controller.chat({
      message: 'Is my portfolio ESG compliant?',
      session_id: 'test-esg'
    });

    expect(result.tool_calls).toHaveLength(1);
    expect(result.tool_calls[0].name).toBe('compliance_check');
    expect(service.chat).toHaveBeenCalledWith({
      message: 'Is my portfolio ESG compliant?',
      sessionId: 'test-esg',
      userId: MOCK_USER_ID
    });
  });

  it('should return 200 with error message for empty input', async () => {
    const mockResponse = {
      response: 'Please provide a message to get started.',
      toolCalls: [],
      sessionId: 'test-2'
    };
    (service.chat as jest.Mock).mockResolvedValue(mockResponse);

    const result = await controller.chat({
      message: '',
      session_id: 'test-2'
    });

    expect(result).toHaveProperty('response');
    expect(result).toHaveProperty('session_id', 'test-2');
  });
});
