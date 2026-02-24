import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';

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

interface ChatResponse {
  response: string;
  tool_calls: ToolCall[];
  session_id: string;
}

@Component({
  host: { class: 'page' },
  imports: [CommonModule, FormsModule],
  selector: 'gf-agent-page',
  styleUrls: ['./agent-page.scss'],
  templateUrl: './agent-page.html'
})
export class GfAgentPageComponent {
  public messages: ChatMessage[] = [];
  public inputMessage = '';
  public isLoading = false;
  public sessionId = `session-${Date.now()}`;

  public constructor(private http: HttpClient) {}

  public sendMessage() {
    const message = this.inputMessage.trim();
    if (!message || this.isLoading) {
      return;
    }

    this.messages.push({ role: 'user', content: message });
    this.inputMessage = '';
    this.isLoading = true;

    this.http
      .post<ChatResponse>('/api/v1/agent/chat', {
        message,
        session_id: this.sessionId
      })
      .subscribe({
        next: (response) => {
          this.messages.push({
            role: 'assistant',
            content: response.response,
            toolCalls: response.tool_calls
          });
          this.isLoading = false;
        },
        error: (error) => {
          this.messages.push({
            role: 'assistant',
            content: `Error: ${error.message || 'Something went wrong'}`
          });
          this.isLoading = false;
        }
      });
  }

  public onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendMessage();
    }
  }

  public toggleToolCalls(message: ChatMessage) {
    (message as { showToolCalls?: boolean }).showToolCalls =
      !(message as { showToolCalls?: boolean }).showToolCalls;
  }

  public hasToolCalls(message: ChatMessage): boolean {
    return (message.toolCalls?.length ?? 0) > 0;
  }

  public isToolCallsVisible(message: ChatMessage): boolean {
    return (message as { showToolCalls?: boolean }).showToolCalls === true;
  }
}
