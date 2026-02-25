import { CommonModule } from '@angular/common';
import {
  CUSTOM_ELEMENTS_SCHEMA,
  Component,
  Input
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MarkdownModule } from 'ngx-markdown';

import { GfToolResultCardComponent } from '../tool-result-card/tool-result-card.component';

interface ToolCall {
  name: string;
  args: Record<string, unknown>;
  result: string;
}

@Component({
  imports: [CommonModule, MatButtonModule, MatCardModule, MarkdownModule, GfToolResultCardComponent],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  selector: 'gf-chat-message',
  styleUrls: ['./chat-message.scss'],
  templateUrl: './chat-message.html'
})
export class GfChatMessageComponent {
  @Input() role: 'user' | 'assistant' = 'assistant';
  @Input() content = '';
  @Input() toolCalls?: ToolCall[];
  @Input() isError = false;
  @Input() errorType = '';

  public showToolCalls = false;

  public get hasToolCalls(): boolean {
    return (this.toolCalls?.length ?? 0) > 0;
  }

  public toggleToolCalls() {
    this.showToolCalls = !this.showToolCalls;
  }
}
