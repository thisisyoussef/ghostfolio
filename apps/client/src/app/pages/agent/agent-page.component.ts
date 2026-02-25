import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import {
  AfterViewChecked,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
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
import { GfWelcomePanelComponent } from './welcome-panel/welcome-panel.component';

interface ToolCall {
  name: string;
  args: Record<string, unknown>;
  result: string;
}

interface VerificationCheck {
  passed: boolean;
  reason?: string;
  details?: Record<string, unknown>;
}

interface VerificationSource {
  tool: string;
  claim: string;
  source: string;
  timestamp: string;
}

interface VerificationSummary {
  status: 'pass' | 'warning' | 'fail';
  confidenceScore: number;
  confidenceLevel: 'high' | 'medium' | 'low';
  checks: Record<string, VerificationCheck>;
  sources: VerificationSource[];
  generatedAt: string;
}

type ClassifiedErrorType = 'data' | 'tool' | 'model' | 'service';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: ToolCall[];
  verification?: VerificationSummary;
  isError?: boolean;
  errorType?: ClassifiedErrorType;
}

interface ChatResponse {
  response: string;
  tool_calls: ToolCall[];
  session_id: string;
  verification?: VerificationSummary;
  is_error?: boolean;
  error_type?: ClassifiedErrorType;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'page' },
  imports: [
    CommonModule,
    GfChatInputComponent,
    GfChatMessageComponent,
    GfSuggestedActionsComponent,
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

  public constructor(
    private changeDetectorRef: ChangeDetectorRef,
    private http: HttpClient
  ) {
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
            verification: response.verification,
            isError: response.is_error === true,
            errorType: this.normalizeErrorType(response.error_type)
          });
          this.isLoading = false;
          this.shouldScroll = true;
          this.changeDetectorRef.markForCheck();
        },
        error: () => {
          this.messages.push({
            role: 'assistant',
            content: 'A temporary service issue occurred. Please try again in a moment.',
            isError: true,
            errorType: 'service'
          });
          this.isLoading = false;
          this.shouldScroll = true;
          this.changeDetectorRef.markForCheck();
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

  private normalizeErrorType(
    errorType: string | undefined
  ): ClassifiedErrorType | undefined {
    if (
      errorType === 'data' ||
      errorType === 'tool' ||
      errorType === 'model' ||
      errorType === 'service'
    ) {
      return errorType;
    }

    return undefined;
  }
}
