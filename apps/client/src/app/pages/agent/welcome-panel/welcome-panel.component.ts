import { CommonModule } from '@angular/common';
import {
  CUSTOM_ELEMENTS_SCHEMA,
  Component,
  EventEmitter,
  Output
} from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';

@Component({
  imports: [CommonModule, MatCardModule, MatButtonModule],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  selector: 'gf-welcome-panel',
  styleUrls: ['./welcome-panel.scss'],
  templateUrl: './welcome-panel.html'
})
export class GfWelcomePanelComponent {
  @Output() promptSelected = new EventEmitter<string>();

  public readonly capabilities = [
    { icon: 'pie-chart-outline', label: 'Portfolio risk analysis' },
    { icon: 'trending-up-outline', label: 'Real-time stock prices' },
    { icon: 'leaf-outline', label: 'ESG compliance checks' }
  ];

  public readonly starters = [
    { label: 'Check my portfolio risk', prompt: 'Analyze my portfolio risk and diversification' },
    { label: 'Price of AAPL', prompt: 'What is the current price of AAPL?' },
    { label: 'ESG scan holdings', prompt: 'Run an ESG compliance check on my holdings' },
    { label: 'Market overview', prompt: 'Show me prices for AAPL, MSFT, GOOGL, AMZN' }
  ];

  public onStarterClick(prompt: string) {
    this.promptSelected.emit(prompt);
  }
}
