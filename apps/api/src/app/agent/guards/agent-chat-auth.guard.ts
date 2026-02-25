import { ConfigurationService } from '@ghostfolio/api/services/configuration/configuration.service';

import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class AgentChatAuthGuard extends AuthGuard('jwt') {
  public constructor(
    private readonly configurationService: ConfigurationService
  ) {
    super();
  }

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    try {
      return (await super.canActivate(context)) as boolean;
    } catch (error) {
      if (this.configurationService.get('ENABLE_FEATURE_AGENT_CHAT_DEMO_MODE')) {
        return true;
      }

      throw error;
    }
  }
}
