import { PortfolioModule } from '@ghostfolio/api/app/portfolio/portfolio.module';
import { RedisCacheModule } from '@ghostfolio/api/app/redis-cache/redis-cache.module';
import { RedisCacheService } from '@ghostfolio/api/app/redis-cache/redis-cache.service';
import { ConfigurationModule } from '@ghostfolio/api/services/configuration/configuration.module';
import { PropertyModule } from '@ghostfolio/api/services/property/property.module';

import { Module } from '@nestjs/common';

import { AgentController } from './agent.controller';
import { AgentChatAuthGuard } from './guards/agent-chat-auth.guard';
import { AgentService } from './agent.service';
import {
  AGENT_REDIS_CACHE_SERVICE,
  SessionMemoryService
} from './memory/session-memory.service';
import { AgentObservabilityService } from './observability/agent-observability.service';
import { AgentGraphService } from './orchestration/agent-graph.service';
import { DeterministicAgentService } from './orchestration/deterministic-agent.service';
import { AgentToolRegistry } from './orchestration/tool-registry';

@Module({
  controllers: [AgentController],
  imports: [ConfigurationModule, PortfolioModule, PropertyModule, RedisCacheModule],
  providers: [
    AgentChatAuthGuard,
    AgentGraphService,
    AgentObservabilityService,
    AgentService,
    AgentToolRegistry,
    DeterministicAgentService,
    { provide: AGENT_REDIS_CACHE_SERVICE, useExisting: RedisCacheService },
    SessionMemoryService
  ]
})
export class AgentModule {}
