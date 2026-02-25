import { CommonModule } from '@angular/common';
import {
  CUSTOM_ELEMENTS_SCHEMA,
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output
} from '@angular/core';
import { MatChipsModule } from '@angular/material/chips';

interface ToolCall {
  name: string;
  args: Record<string, unknown>;
  result: string;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: ToolCall[];
}

interface SuggestedAction {
  label: string;
  icon: string;
  prompt: string;
}

@Component({
  imports: [CommonModule, MatChipsModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  selector: 'gf-suggested-actions',
  styleUrls: ['./suggested-actions.scss'],
  templateUrl: './suggested-actions.html'
})
export class GfSuggestedActionsComponent implements OnChanges {
  @Input() messages: ChatMessage[] = [];
  @Output() actionSelected = new EventEmitter<string>();

  public suggestions: SuggestedAction[] = [];

  private static readonly STARTERS: SuggestedAction[] = [
    { label: 'Check my portfolio risk', icon: 'pie-chart-outline', prompt: 'Analyze my portfolio risk and diversification' },
    { label: 'Price of AAPL', icon: 'trending-up-outline', prompt: 'What is the current price of AAPL?' },
    { label: 'ESG compliance scan', icon: 'leaf-outline', prompt: 'Run an ESG compliance check on my holdings' },
    { label: 'Market overview', icon: 'stats-chart-outline', prompt: 'Show me prices for AAPL, MSFT, GOOGL, AMZN' }
  ];

  public ngOnChanges() {
    this.updateSuggestions();
  }

  public onChipClick(action: SuggestedAction) {
    this.actionSelected.emit(action.prompt);
  }

  private updateSuggestions() {
    if (this.messages.length === 0) {
      this.suggestions = GfSuggestedActionsComponent.STARTERS;
      return;
    }

    const lastAssistant = [...this.messages]
      .reverse()
      .find((m) => m.role === 'assistant' && m.toolCalls?.length);

    if (!lastAssistant?.toolCalls?.length) {
      this.suggestions = GfSuggestedActionsComponent.STARTERS;
      return;
    }

    const lastTool = lastAssistant.toolCalls[0];
    const symbols = this.extractSymbols(lastTool);

    switch (lastTool.name) {
      case 'marketDataFetch':
      case 'market_data_fetch':
        this.suggestions = [
          ...(symbols.length ? [{
            label: `ESG check for ${symbols[0]}`,
            icon: 'leaf-outline',
            prompt: `Check ESG compliance for ${symbols.join(', ')}`
          }] : []),
          { label: 'Portfolio risk analysis', icon: 'pie-chart-outline', prompt: 'Analyze my portfolio risk' },
          { label: 'Check another stock', icon: 'trending-up-outline', prompt: 'What is the price of ' }
        ];
        break;

      case 'portfolioRiskAnalysis':
      case 'portfolio_risk_analysis':
        this.suggestions = [
          { label: 'ESG compliance scan', icon: 'leaf-outline', prompt: 'Run an ESG compliance check on my holdings' },
          ...(symbols.length ? [{
            label: `Price of ${symbols[0]}`,
            icon: 'trending-up-outline',
            prompt: `What is the current price of ${symbols[0]}?`
          }] : []),
          { label: 'Check another stock', icon: 'stats-chart-outline', prompt: 'What is the price of ' }
        ];
        break;

      case 'complianceCheck':
      case 'compliance_check':
        this.suggestions = [
          { label: 'Portfolio risk analysis', icon: 'pie-chart-outline', prompt: 'Analyze my portfolio risk and diversification' },
          ...(symbols.length ? [{
            label: `Price of ${symbols[0]}`,
            icon: 'trending-up-outline',
            prompt: `What is the current price of ${symbols[0]}?`
          }] : []),
          { label: 'Check market overview', icon: 'stats-chart-outline', prompt: 'Show me prices for AAPL, MSFT, GOOGL' }
        ];
        break;

      default:
        this.suggestions = GfSuggestedActionsComponent.STARTERS;
    }
  }

  private extractSymbols(toolCall: ToolCall): string[] {
    try {
      const args = toolCall.args as { symbols?: string[] };
      if (args.symbols?.length) return args.symbols;

      const result = JSON.parse(toolCall.result);
      if (Array.isArray(result)) {
        return result.map((r: any) => r.symbol).filter(Boolean);
      }
      if (result.symbol) return [result.symbol];
    } catch {}
    return [];
  }
}
