import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import { GfChatMessageComponent } from './chat-message/chat-message.component';
import { GfAgentPageComponent } from './agent-page.component';

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

describe('GfAgentPageComponent', () => {
  let fixture: ComponentFixture<GfAgentPageComponent>;
  let component: GfAgentPageComponent;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GfAgentPageComponent, HttpClientTestingModule]
    }).compileComponents();

    fixture = TestBed.createComponent(GfAgentPageComponent);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('stores and passes verification metadata from chat response to assistant message', () => {
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

    component.sendMessage('Price of AAPL');

    const request = httpMock.expectOne('/api/v1/agent/chat');
    expect(request.request.method).toBe('POST');
    request.flush({
      response: 'AAPL is $272.14.',
      tool_calls: [],
      session_id: component.sessionId,
      verification
    });

    fixture.detectChanges();

    expect(component.messages).toHaveLength(2);
    expect(component.messages[1].verification).toEqual(verification);

    const messageComponents = fixture.debugElement.queryAll(
      By.directive(GfChatMessageComponent)
    );
    expect(messageComponents).toHaveLength(2);
    expect(messageComponents[1].componentInstance.verification).toEqual(
      verification
    );
  });

  it('maps backend is_error and error_type into assistant message state', () => {
    component.sendMessage('Analyze my portfolio risk');

    const request = httpMock.expectOne('/api/v1/agent/chat');
    request.flush({
      response: 'Unable to safely verify tool outputs.',
      tool_calls: [],
      session_id: component.sessionId,
      is_error: true,
      error_type: 'data'
    });

    fixture.detectChanges();

    expect(component.messages).toHaveLength(2);
    expect(component.messages[1].isError).toBe(true);
    expect(component.messages[1].errorType).toBe('data');

    const messageComponents = fixture.debugElement.queryAll(
      By.directive(GfChatMessageComponent)
    );
    expect(messageComponents[1].componentInstance.isError).toBe(true);
    expect(messageComponents[1].componentInstance.errorType).toBe('data');
  });

  it('creates classified service error message for transport failures', () => {
    component.sendMessage('Price of AAPL');

    const request = httpMock.expectOne('/api/v1/agent/chat');
    request.error(new ProgressEvent('error'));
    fixture.detectChanges();

    expect(component.messages).toHaveLength(2);
    expect(component.messages[1].isError).toBe(true);
    expect(component.messages[1].errorType).toBe('service');
    expect(component.messages[1].content).toContain(
      'A temporary service issue occurred'
    );
  });
});
