import { PortfolioService } from '@ghostfolio/api/app/portfolio/portfolio.service';

import { tool } from '@langchain/core/tools';
import { Injectable } from '@nestjs/common';
import { z, type ZodTypeAny } from 'zod';

import { AgentError, ErrorType } from '../errors/agent-error';
import { complianceCheck } from '../tools/compliance-checker.tool';
import { marketDataFetch } from '../tools/market-data.tool';
import { portfolioRiskAnalysis } from '../tools/portfolio-analysis.tool';

export interface ToolExecutionContext {
  userId: string;
}

interface ToolDefinition {
  description: string;
  name: string;
  schema: ZodTypeAny;
}

const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    description:
      'Fetches current market data for one or more ticker symbols (stocks or crypto).',
    name: 'market_data_fetch',
    schema: z.object({
      symbols: z.array(z.string().min(1)).min(1).max(10)
    })
  },
  {
    description:
      'Analyzes the user portfolio for concentration risk, allocation, and performance.',
    name: 'portfolio_risk_analysis',
    schema: z.object({
      dateRange: z.string().optional()
    })
  },
  {
    description:
      'Runs an ESG compliance check on portfolio holdings. Optionally filters to one ESG category.',
    name: 'compliance_check',
    schema: z.object({
      filterCategory: z.string().optional()
    })
  }
];

const createLangChainTool = tool as unknown as (
  fn: (args: Record<string, unknown>) => Promise<string>,
  options: {
    description: string;
    name: string;
    schema: ZodTypeAny;
  }
) => unknown;

@Injectable()
export class AgentToolRegistry {
  public constructor(private readonly portfolioService: PortfolioService) {}

  public getLangChainTools(
    context: ToolExecutionContext
  ): unknown[] {
    return TOOL_DEFINITIONS.map((definition) => {
      return createLangChainTool(
        async (args: Record<string, unknown>) => {
          const result = await this.executeToolCall(
            definition.name,
            args,
            context
          );

          return JSON.stringify(result);
        },
        {
          description: definition.description,
          name: definition.name,
          schema: definition.schema
        }
      );
    });
  }

  public getToolDefinition(name: string): ToolDefinition | undefined {
    return TOOL_DEFINITIONS.find((definition) => definition.name === name);
  }

  public async executeToolCall(
    name: string,
    rawArgs: Record<string, unknown>,
    context: ToolExecutionContext
  ): Promise<unknown> {
    const definition = this.getToolDefinition(name);

    if (!definition) {
      throw new AgentError(
        ErrorType.TOOL,
        `Unknown tool requested: ${name}`,
        false
      );
    }

    const args = definition.schema.parse(rawArgs);

    switch (name) {
      case 'market_data_fetch': {
        const symbols = Array.from(
          new Set(
            (args.symbols as string[])
              .map((symbol) => symbol.trim().toUpperCase())
              .filter(Boolean)
          )
        );

        if (symbols.length === 0) {
          throw new AgentError(
            ErrorType.TOOL,
            'No valid symbols were provided for market data fetch.',
            true
          );
        }

        return marketDataFetch({ symbols });
      }

      case 'portfolio_risk_analysis': {
        const result = await portfolioRiskAnalysis(
          {
            ...(args.dateRange ? { dateRange: args.dateRange } : {})
          },
          this.portfolioService,
          context.userId
        );

        if (result.error) {
          throw new AgentError(ErrorType.SERVICE, result.error, true);
        }

        return result;
      }

      case 'compliance_check': {
        let holdings: Record<string, any>;

        try {
          const details = await this.portfolioService.getDetails({
            dateRange: 'max' as any,
            filters: [],
            impersonationId: undefined,
            userId: context.userId,
            withSummary: false
          });

          holdings = details.holdings || {};
        } catch {
          throw new AgentError(
            ErrorType.SERVICE,
            'Unable to check portfolio compliance — portfolio service unavailable.',
            true
          );
        }

        const holdingInputs = Object.entries(holdings).map(
          ([symbol, data]: [string, any]) => ({
            symbol,
            name: data.name || symbol,
            valueInBaseCurrency: data.valueInBaseCurrency || 0
          })
        );

        return complianceCheck({
          filterCategory: args.filterCategory,
          holdings: holdingInputs
        });
      }

      default:
        throw new AgentError(
          ErrorType.TOOL,
          `No execution handler implemented for tool ${name}`,
          false
        );
    }
  }
}
