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
    const isDemoModeEnabled = this.configurationService.get(
      'ENABLE_FEATURE_AGENT_CHAT_DEMO_MODE'
    );

    try {
      const isAuthenticated = (await super.canActivate(context)) as boolean;

      if (isAuthenticated) {
        return true;
      }

      return isDemoModeEnabled;
    } catch (error) {
      if (isDemoModeEnabled) {
        return true;
      }

      throw error;
    }
  }
}
