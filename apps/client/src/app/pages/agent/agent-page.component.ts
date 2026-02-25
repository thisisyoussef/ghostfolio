import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import {
  AfterViewChecked,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  ElementRef,
  ViewChild
} from '@angular/core';
import { addIcons } from 'ionicons';
import {
  checkmarkCircleOutline,
  constructOutline,
  leafOutline,
  personOutline,
  pieChartOutline,
  sendOutline,
  sparklesOutline,
  statsChartOutline,
  trendingUpOutline,
  warningOutline
} from 'ionicons/icons';

import { GfChatInputComponent } from './chat-input/chat-input.component';
import { GfChatMessageComponent } from './chat-message/chat-message.component';
import { GfSuggestedActionsComponent } from './suggested-actions/suggested-actions.component';
import { GfToolResultCardComponent } from './tool-result-card/tool-result-card.component';
import { GfWelcomePanelComponent } from './welcome-panel/welcome-panel.component';

interface ToolCall {
  name: string;
  args: Record<string, unknown>;
  result: string;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: ToolCall[];
  isError?: boolean;
  errorType?: string;
}

interface ChatResponse {
  response: string;
  tool_calls: ToolCall[];
  session_id: string;
  is_error?: boolean;
  error_type?: string;
}

@Component({
  host: { class: 'page' },
  imports: [
    CommonModule,
    GfChatInputComponent,
    GfChatMessageComponent,
    GfSuggestedActionsComponent,
    GfToolResultCardComponent,
    GfWelcomePanelComponent
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  selector: 'gf-agent-page',
  styleUrls: ['./agent-page.scss'],
  templateUrl: './agent-page.html'
})
export class GfAgentPageComponent implements AfterViewChecked {
  @ViewChild('messagesContainer') private messagesContainer: ElementRef;

  public messages: ChatMessage[] = [];
  public isLoading = false;
  public sessionId = `session-${Date.now()}`;

  private shouldScroll = false;

  public constructor(private http: HttpClient) {
    addIcons({
      checkmarkCircleOutline,
      constructOutline,
      leafOutline,
      personOutline,
      pieChartOutline,
      sendOutline,
      sparklesOutline,
      statsChartOutline,
      trendingUpOutline,
      warningOutline
    });
  }

  public ngAfterViewChecked() {
    if (this.shouldScroll) {
      this.scrollToBottom();
      this.shouldScroll = false;
    }
  }

  public sendMessage(message: string) {
    if (!message.trim() || this.isLoading) {
      return;
    }

    this.messages.push({ role: 'user', content: message.trim() });
    this.isLoading = true;
    this.shouldScroll = true;

    this.http
      .post<ChatResponse>('/api/v1/agent/chat', {
        message: message.trim(),
        session_id: this.sessionId
      })
      .subscribe({
        next: (response) => {
          this.messages.push({
            role: 'assistant',
            content: response.response,
            toolCalls: response.tool_calls,
            isError: response.is_error,
            errorType: response.error_type
          });
          this.isLoading = false;
          this.shouldScroll = true;
        },
        error: (error) => {
          this.messages.push({
            role: 'assistant',
            content: `Error: ${error.message || 'Something went wrong. Please try again.'}`
          });
          this.isLoading = false;
          this.shouldScroll = true;
        }
      });
  }

  private scrollToBottom() {
    try {
      const el = this.messagesContainer?.nativeElement;
      if (el) {
        el.scrollTop = el.scrollHeight;
      }
    } catch {}
  }
}
