import { BadRequestException } from '@nestjs/common';

import { AgentObservabilityService } from './agent-observability.service';

describe('AgentObservabilityService', () => {
  let service: AgentObservabilityService;

  beforeEach(() => {
    service = new AgentObservabilityService();
  });

  it('should aggregate request metrics with latency, tokens, tools and errors', async () => {
    await service.recordChatOutcome({
      errorType: 'tool',
      isError: true,
      latency: {
        reasoningMs: 120,
        toolMs: 880,
        totalMs: 1000
      },
      orchestrator: 'langgraph',
      requestId: 'req-1',
      sessionId: 'session-1',
      timestamp: new Date().toISOString(),
      tokenUsage: {
        inputTokens: 250,
        outputTokens: 90,
        totalTokens: 340
      },
      toolExecutions: [
        {
          errorType: 'tool',
          latencyMs: 880,
          name: 'market_data_fetch',
          success: false
        }
      ],
      toolStats: {
        failure: 1,
        success: 0,
        total: 1
      }
    });

    const snapshot = await service.getMetricsSnapshot();

    expect(snapshot.totals.requests).toBe(1);
    expect(snapshot.totals.error).toBe(1);
    expect(snapshot.totals.success).toBe(0);
    expect(snapshot.errors.tool).toBe(1);
    expect(snapshot.tools.market_data_fetch.failure).toBe(1);
    expect(snapshot.tools.market_data_fetch.success).toBe(0);
    expect(snapshot.tokens.input).toBe(250);
    expect(snapshot.tokens.output).toBe(90);
    expect(snapshot.tokens.total).toBe(340);
    expect(snapshot.tokens.requestsWithUsage).toBe(1);
    expect(snapshot.latencyMs.avg.totalMs).toBe(1000);
  });

  it('should reject invalid feedback payloads', async () => {
    await expect(
      service.submitFeedback('user-1', {
        rating: 'neutral' as 'up',
        requestId: 'req-1',
        sessionId: 'session-1'
      })
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.submitFeedback('user-1', {
        rating: 'up',
        requestId: '',
        sessionId: 'session-1'
      })
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.submitFeedback('user-1', {
        note: 'x'.repeat(501),
        rating: 'down',
        requestId: 'req-1',
        sessionId: 'session-1'
      })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('should store and return feedback entries newest first', async () => {
    const first = await service.submitFeedback('user-1', {
      note: 'Solid response',
      rating: 'up',
      requestId: 'req-1',
      sessionId: 'session-1'
    });
    const second = await service.submitFeedback('user-1', {
      rating: 'down',
      requestId: 'req-2',
      sessionId: 'session-1'
    });

    const list = await service.listFeedback('user-1');
    const feedbackMetrics = await service.getMetricsSnapshot();

    expect(list).toHaveLength(2);
    expect(list[0].id).toBe(second.id);
    expect(list[1].id).toBe(first.id);
    expect(list[1].note).toBe('Solid response');
    expect(feedbackMetrics.feedback.total).toBe(2);
    expect(feedbackMetrics.feedback.up).toBe(1);
    expect(feedbackMetrics.feedback.down).toBe(1);
  });
});
