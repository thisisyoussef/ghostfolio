import { HasPermissionGuard } from '@ghostfolio/api/guards/has-permission.guard';
import { ConfigurationService } from '@ghostfolio/api/services/configuration/configuration.service';
import { PropertyService } from '@ghostfolio/api/services/property/property.service';
import { PROPERTY_DEMO_USER_ID } from '@ghostfolio/common/config';
import type { RequestWithUser } from '@ghostfolio/common/types';

import {
  Body,
  Controller,
  Get,
  Inject,
  Post,
  Query,
  ServiceUnavailableException,
  UnauthorizedException,
  UseGuards
} from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';

import { AgentService } from './agent.service';
import { AgentChatAuthGuard } from './guards/agent-chat-auth.guard';
import { AgentObservabilityService } from './observability/agent-observability.service';
import {
  type AgentFeedbackRecord,
  type AgentMetricsSnapshot,
  type AgentRequestObservability,
  type FeedbackRating
} from './observability/observability.types';
import { type VerificationSummary } from './verification/verification.types';

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
  request_id?: string;
  observability?: AgentRequestObservability;
  verification?: VerificationSummary;
  is_error?: boolean;
  error_type?: string;
}

interface FeedbackRequestDto {
  request_id: string;
  session_id: string;
  rating: FeedbackRating;
  note?: string;
}

interface FeedbackResponseDto {
  id: string;
  request_id: string;
  session_id: string;
  rating: FeedbackRating;
  note?: string;
  created_at: string;
}

@Controller('agent')
export class AgentController {
  constructor(
    private readonly agentService: AgentService,
    private readonly configurationService: ConfigurationService,
    private readonly observabilityService: AgentObservabilityService,
    private readonly propertyService: PropertyService,
    @Inject(REQUEST) private readonly request: RequestWithUser
  ) {}

  @Post('chat')
  @UseGuards(AgentChatAuthGuard, HasPermissionGuard)
  async chat(@Body() body: ChatRequestDto): Promise<ChatResponseDto> {
    const userId = await this.resolveUserId();

    const result = await this.agentService.chat({
      message: body.message,
      sessionId: body.session_id,
      userId
    });

    const dto: ChatResponseDto = {
      ...(result.observability ? { observability: result.observability } : {}),
      ...(result.requestId ? { request_id: result.requestId } : {}),
      response: result.response,
      tool_calls: result.toolCalls,
      session_id: result.sessionId,
      ...(result.verification ? { verification: result.verification } : {})
    };

    if (result.isError) {
      dto.is_error = true;
      dto.error_type = result.errorType;
    }

    return dto;
  }

  @Get('metrics')
  @UseGuards(AuthGuard('jwt'), HasPermissionGuard)
  async metrics(): Promise<AgentMetricsSnapshot> {
    return this.observabilityService.getMetricsSnapshot();
  }

  @Get('feedback')
  @UseGuards(AuthGuard('jwt'), HasPermissionGuard)
  async listFeedback(
    @Query('request_id') requestId?: string,
    @Query('session_id') sessionId?: string,
    @Query('limit') limit?: string
  ): Promise<FeedbackResponseDto[]> {
    const parsedLimit =
      typeof limit === 'string' && limit.trim().length > 0
        ? Number(limit)
        : undefined;
    const records = await this.observabilityService.listFeedback(
      this.request.user.id,
      {
        ...(requestId ? { requestId } : {}),
        ...(sessionId ? { sessionId } : {}),
        ...(Number.isFinite(parsedLimit) ? { limit: parsedLimit } : {})
      }
    );

    return records.map((record) => this.toFeedbackDto(record));
  }

  @Post('feedback')
  @UseGuards(AuthGuard('jwt'), HasPermissionGuard)
  async feedback(@Body() body: FeedbackRequestDto): Promise<FeedbackResponseDto> {
    const record = await this.observabilityService.submitFeedback(
      this.request.user.id,
      {
        note: body.note,
        rating: body.rating,
        requestId: body.request_id,
        sessionId: body.session_id
      }
    );

    return this.toFeedbackDto(record);
  }

  private toFeedbackDto(record: AgentFeedbackRecord): FeedbackResponseDto {
    return {
      created_at: record.createdAt,
      id: record.id,
      ...(record.note ? { note: record.note } : {}),
      rating: record.rating,
      request_id: record.requestId,
      session_id: record.sessionId
    };
  }

  private async resolveUserId(): Promise<string> {
    const authenticatedUserId = this.request.user?.id;

    if (authenticatedUserId) {
      return authenticatedUserId;
    }

    if (!this.configurationService.get('ENABLE_FEATURE_AGENT_CHAT_DEMO_MODE')) {
      throw new UnauthorizedException();
    }

    const demoUserId = await this.propertyService.getByKey<string>(
      PROPERTY_DEMO_USER_ID
    );

    if (!demoUserId) {
      throw new ServiceUnavailableException(
        'Demo account is not configured for agent chat.'
      );
    }

    return demoUserId;
  }
}
