import { Test, TestingModule } from '@nestjs/testing';

import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';

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
      sessionId: 'test-1'
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
