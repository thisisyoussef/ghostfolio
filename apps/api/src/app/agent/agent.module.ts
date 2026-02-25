import { PortfolioModule } from '@ghostfolio/api/app/portfolio/portfolio.module';

import { Module } from '@nestjs/common';

import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';
import { SessionMemoryService } from './memory/session-memory.service';

@Module({
  controllers: [AgentController],
  imports: [PortfolioModule],
  providers: [
    AgentService,
    { provide: SessionMemoryService, useValue: new SessionMemoryService() }
  ]
})
export class AgentModule {}
