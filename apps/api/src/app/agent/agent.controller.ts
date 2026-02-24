import { HasPermissionGuard } from '@ghostfolio/api/guards/has-permission.guard';
import type { RequestWithUser } from '@ghostfolio/common/types';

import {
  Body,
  Controller,
  Inject,
  Post,
  UseGuards
} from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';

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
  constructor(
    private readonly agentService: AgentService,
    @Inject(REQUEST) private readonly request: RequestWithUser
  ) {}

  @Post('chat')
  @UseGuards(AuthGuard('jwt'), HasPermissionGuard)
  async chat(@Body() body: ChatRequestDto): Promise<ChatResponseDto> {
    const result = await this.agentService.chat({
      message: body.message,
      sessionId: body.session_id,
      userId: this.request.user.id
    });

    return {
      response: result.response,
      tool_calls: result.toolCalls,
      session_id: result.sessionId
    };
  }
}
