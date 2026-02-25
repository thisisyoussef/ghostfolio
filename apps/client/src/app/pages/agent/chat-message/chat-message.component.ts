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
  @Input() verification?: VerificationSummary;
  @Input() isError = false;
  @Input() errorType = '';

  public showToolCalls = false;

  public get hasToolCalls(): boolean {
    return (this.toolCalls?.length ?? 0) > 0;
  }

  public get hasVerification(): boolean {
    return this.role === 'assistant' && !!this.verification;
  }

  public get hasSources(): boolean {
    return (this.verification?.sources?.length ?? 0) > 0;
  }

  public get renderedContent(): string {
    if (this.role !== 'assistant' || !this.verification) {
      return this.content;
    }

    return this.stripMetadataSections(this.content);
  }

  public get statusLabel(): string {
    return this.verification?.status?.toUpperCase() || 'PASS';
  }

  public get statusClass(): string {
    switch (this.verification?.status) {
      case 'pass':
        return 'status-pass';
      case 'warning':
        return 'status-warning';
      case 'fail':
        return 'status-fail';
      default:
        return 'status-pass';
    }
  }

  public get failedChecksText(): string {
    if (!this.verification) {
      return 'none';
    }

    const failedChecks = Object.entries(this.verification.checks)
      .filter(([, check]) => !check.passed)
      .map(([name, check]) => {
        return check.reason ? `${name} (${check.reason})` : name;
      });

    return failedChecks.length > 0 ? failedChecks.join(', ') : 'none';
  }

  public get uniqueToolNames(): string[] {
    const names = this.toolCalls?.map((toolCall) => toolCall.name) ?? [];
    return [...new Set(names)];
  }

  public formatTimestamp(value: string): string {
    const timestamp = new Date(value);

    if (Number.isNaN(timestamp.getTime())) {
      return value;
    }

    return timestamp.toLocaleString();
  }

  public toggleToolCalls() {
    this.showToolCalls = !this.showToolCalls;
  }

  private stripMetadataSections(markdown: string): string {
    let sanitized = markdown;

    sanitized = this.removeHeadingSection(sanitized, 'Verification');
    sanitized = this.removeHeadingSection(sanitized, 'Sources');
    sanitized = sanitized.replace(/^\s*-\s*\*\*Source:\*\*.*$/gim, '');
    sanitized = sanitized.replace(/^\s*Source:\s*.*$/gim, '');
    sanitized = sanitized.replace(/\n{3,}/g, '\n\n');

    return sanitized.trim();
  }

  private removeHeadingSection(markdown: string, heading: string): string {
    const pattern = new RegExp(
      `(?:^|\\n)#{2,3}\\s+${heading}\\b[\\s\\S]*?(?=\\n#{1,6}\\s+|$)`,
      'gi'
    );

    return markdown.replace(pattern, '\n');
  }
}
