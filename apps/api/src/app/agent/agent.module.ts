import { PortfolioModule } from '@ghostfolio/api/app/portfolio/portfolio.module';
import { PrismaModule } from '@ghostfolio/api/services/prisma/prisma.module';

import { Module } from '@nestjs/common';

import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';

@Module({
  controllers: [AgentController],
  imports: [PortfolioModule, PrismaModule],
  providers: [AgentService]
})
export class AgentModule {}
