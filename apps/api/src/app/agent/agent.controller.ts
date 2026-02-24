import { Body, Controller, Post } from '@nestjs/common';

import { AgentService } from './agent.service';

interface ChatRequestDto {
  message: string;
  session_id: string;
}

interface ToolCallDto {
  name: string;
  args: Record<string, unknown>;
  result: string;
}

interface ChatResponseDto {
  response: string;
  tool_calls: ToolCallDto[];
  session_id: string;
}

@Controller('agent')
export class AgentController {
  constructor(private readonly agentService: AgentService) {}

  @Post('chat')
  async chat(@Body() body: ChatRequestDto): Promise<ChatResponseDto> {
    const result = await this.agentService.chat({
      message: body.message,
      sessionId: body.session_id
    });

    return {
      response: result.response,
      tool_calls: result.toolCalls,
      session_id: result.sessionId
    };
  }
}
