import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import { GfChatMessageComponent } from './chat-message.component';

jest.mock('ngx-markdown', () => {
  const core = require('@angular/core');

  const MockMarkdownComponent = class {
    public data = '';
  };
  core.Component({
    inputs: ['data'],
    selector: 'markdown',
    standalone: true,
    template: '{{ data }}'
  })(MockMarkdownComponent);

  const MockMarkdownModule = class {};
  core.NgModule({
    exports: [MockMarkdownComponent],
    imports: [MockMarkdownComponent]
  })(MockMarkdownModule);

  return { MarkdownModule: MockMarkdownModule };
});

describe('GfChatMessageComponent', () => {
  let fixture: ComponentFixture<GfChatMessageComponent>;
  let component: GfChatMessageComponent;

  const verification = {
    status: 'pass' as const,
    confidenceScore: 100,
    confidenceLevel: 'high' as const,
    checks: {
      outputSchema: { passed: true }
    },
    sources: [
      {
        tool: 'market_data_fetch',
        claim: 'price quote for AAPL',
        source: 'Yahoo Finance (chart v8)',
        timestamp: '2026-02-25T03:57:28.019Z'
      }
    ],
    generatedAt: '2026-02-25T03:57:28.019Z'
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GfChatMessageComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(GfChatMessageComponent);
    component = fixture.componentInstance;
  });

  it('strips appended verification and sources sections when verification metadata exists', () => {
    component.role = 'assistant';
    component.content =
      "Here's the current market data for AAPL.\n\n### Verification\n\n- **Status:** PASS\n\n### Sources\n\n- market_data_fetch: Yahoo Finance";
    component.verification = verification;

    fixture.detectChanges();

    const messageText = (
      fixture.debugElement.query(By.css('.message-content')).nativeElement as HTMLElement
    ).textContent;

    expect(messageText).toContain("Here's the current market data for AAPL.");
    expect(messageText).not.toContain('Status:');
    expect(messageText).not.toContain('market_data_fetch: Yahoo Finance');
  });

  it('strips inline Source lines when verification metadata exists', () => {
    component.role = 'assistant';
    component.content =
      '### ESG Compliance Report\n\n- **Compliance Score:** 68.27%\n- **Source:** ESG Violations Dataset v1.0 (2025-01-15)\nSource: Yahoo Finance';
    component.verification = verification;

    fixture.detectChanges();

    const messageText = (
      fixture.debugElement.query(By.css('.message-content')).nativeElement as HTMLElement
    ).textContent;

    expect(messageText).toContain('ESG Compliance Report');
    expect(messageText).toContain('Compliance Score');
    expect(messageText).not.toContain('ESG Violations Dataset v1.0');
    expect(messageText).not.toContain('Source: Yahoo Finance');
  });

  it('does not strip message text when verification metadata is missing', () => {
    component.role = 'assistant';
    component.content =
      "Here's the current market data for AAPL.\n\n### Verification\n\n- **Status:** PASS\n\n### Sources\n\n- market_data_fetch: Yahoo Finance";
    component.verification = undefined;

    fixture.detectChanges();

    const messageText = (
      fixture.debugElement.query(By.css('.message-content')).nativeElement as HTMLElement
    ).textContent;

    expect(messageText).toContain('Verification');
    expect(messageText).toContain('Sources');
    expect(messageText).toContain('market_data_fetch: Yahoo Finance');
  });

  it('renders verification summary with status, confidence, and failed checks', () => {
    component.role = 'assistant';
    component.content = 'Result body';
    component.verification = {
      ...verification,
      status: 'warning',
      confidenceScore: 80,
      confidenceLevel: 'medium',
      checks: {
        crossSourcePrice: {
          passed: false,
          reason: 'Discrepancy exceeds threshold.'
        },
        outputSchema: { passed: true }
      }
    };

    fixture.detectChanges();

    const status = fixture.debugElement.query(By.css('.verification-status'))
      .nativeElement as HTMLElement;
    const metadataText = (
      fixture.debugElement.query(By.css('.metadata-panel')).nativeElement as HTMLElement
    ).textContent;

    expect(status.textContent).toContain('WARNING');
    expect(metadataText).toContain('80/100 (medium)');
    expect(metadataText).toContain(
      'crossSourcePrice (Discrepancy exceeds threshold.)'
    );
  });

  it('keeps tool calls collapsed by default and expands on toggle', () => {
    component.role = 'assistant';
    component.content = 'Result body';
    component.toolCalls = [
      {
        name: 'market_data_fetch',
        args: { symbols: ['AAPL'] },
        result: '{"AAPL":{"symbol":"AAPL","price":272.14}}'
      }
    ];

    fixture.detectChanges();

    expect(fixture.debugElement.query(By.css('.tool-calls-panel'))).toBeTruthy();
    expect(fixture.debugElement.query(By.css('.tool-calls-expanded'))).toBeNull();

    const toggleButton = fixture.debugElement.query(By.css('.tool-calls-toggle'))
      .nativeElement as HTMLButtonElement;
    toggleButton.click();
    fixture.detectChanges();

    expect(fixture.debugElement.query(By.css('.tool-calls-expanded'))).toBeTruthy();
    expect(fixture.debugElement.query(By.css('.tool-call'))).toBeTruthy();
    expect(
      (
        fixture.debugElement.query(By.css('.tool-name-chip')).nativeElement as HTMLElement
      ).textContent
    ).toContain('market_data_fetch');
  });
});
