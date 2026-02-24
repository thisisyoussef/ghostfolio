import { Injectable } from '@nestjs/common';

import { marketDataFetch } from './tools/market-data.tool';

interface ToolCallInfo {
  name: string;
  args: Record<string, unknown>;
  result: string;
}

export interface ChatResponse {
  response: string;
  toolCalls: ToolCallInfo[];
  sessionId: string;
}

@Injectable()
export class AgentService {
  async chat(input: {
    message: string;
    sessionId: string;
  }): Promise<ChatResponse> {
    const { message, sessionId } = input;

    if (!message.trim()) {
      return {
        response: 'Please provide a message to get started.',
        toolCalls: [],
        sessionId
      };
    }

    // Extract ticker symbols from the message (basic pattern matching)
    const symbolPattern = /\b([A-Z]{1,5})\b/g;
    const potentialSymbols = message.match(symbolPattern) || [];
    const commonWords = new Set([
      'I',
      'A',
      'THE',
      'IS',
      'IT',
      'OF',
      'AND',
      'OR',
      'TO',
      'IN',
      'FOR',
      'ON',
      'AT',
      'BY',
      'AN',
      'BE',
      'AS',
      'DO',
      'IF',
      'SO',
      'NO',
      'UP',
      'MY',
      'ME',
      'WE',
      'HE',
      'CAN',
      'HOW',
      'ARE',
      'NOT',
      'BUT',
      'ALL',
      'HAS',
      'WAS',
      'HAD',
      'GET',
      'GOT',
      'WHAT',
      'TELL',
      'SHOW',
      'GIVE',
      'ABOUT',
      'PRICE',
      'STOCK',
      'MARKET',
      'DATA',
      'QUOTE'
    ]);
    const symbols = potentialSymbols.filter(
      (s) => !commonWords.has(s) && s.length >= 2
    );

    if (symbols.length === 0) {
      return {
        response:
          'I can help you look up stock market data. Please include ticker symbols (e.g., AAPL, MSFT) in your question.',
        toolCalls: [],
        sessionId
      };
    }

    // Fetch market data
    const marketData = await marketDataFetch({ symbols });
    const toolCalls: ToolCallInfo[] = [
      {
        name: 'market_data_fetch',
        args: { symbols },
        result: JSON.stringify(marketData)
      }
    ];

    // Build response text
    const parts: string[] = [];
    for (const symbol of symbols) {
      const data = marketData[symbol];
      if (data.error) {
        parts.push(`${symbol}: ${data.error}`);
      } else {
        const priceStr = data.price ? `$${data.price.toFixed(2)}` : 'N/A';
        const nameStr = data.name ? ` (${data.name})` : '';
        parts.push(`${symbol}${nameStr}: ${priceStr}`);
      }
    }

    return {
      response: parts.join('\n'),
      toolCalls,
      sessionId
    };
  }
}
