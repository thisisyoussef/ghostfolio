import {
  aggregateVerificationEntries,
  ensureVerificationSections,
  extractVerificationEntriesFromToolResult,
  hasRequiredSections,
  parseJsonSafe
} from './output-validation';
import { type VerificationSummary } from './verification.types';

function makeSummary(args: {
  status?: 'pass' | 'warning' | 'fail';
  confidenceScore?: number;
}): VerificationSummary {
  return {
    status: args.status || 'pass',
    confidenceScore: args.confidenceScore ?? 100,
    confidenceLevel:
      (args.confidenceScore ?? 100) > 90
        ? 'high'
        : (args.confidenceScore ?? 100) >= 70
          ? 'medium'
          : 'low',
    checks: {
      outputSchema: { passed: true },
      sourceAttribution: { passed: true }
    },
    sources: [
      {
        tool: 'market_data_fetch',
        claim: 'price quote for AAPL',
        source: 'Yahoo',
        timestamp: new Date().toISOString()
      }
    ],
    generatedAt: new Date().toISOString()
  };
}

describe('output validation', () => {
  it('should parse JSON safely and report invalid payloads', () => {
    expect(parseJsonSafe('{"ok":true}')).toHaveProperty('parsed');
    expect(parseJsonSafe('{bad-json')).toHaveProperty('error');
  });

  it('should extract market verification entries from per-symbol payloads', () => {
    const payload = {
      AAPL: {
        price: 100,
        verification: makeSummary({ status: 'warning', confidenceScore: 80 })
      },
      MSFT: {
        price: 200,
        verification: makeSummary({ status: 'pass', confidenceScore: 98 })
      }
    };

    const entries = extractVerificationEntriesFromToolResult({
      toolName: 'market_data_fetch',
      parsed: payload
    });

    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.key)).toEqual([
      'market_data_fetch.AAPL',
      'market_data_fetch.MSFT'
    ]);
  });

  it('should aggregate entry status and average confidence score', () => {
    const summary = aggregateVerificationEntries([
      {
        key: 'market_data_fetch.AAPL',
        summary: makeSummary({ status: 'warning', confidenceScore: 80 })
      },
      {
        key: 'compliance_check',
        summary: makeSummary({ status: 'pass', confidenceScore: 100 })
      }
    ]);

    expect(summary.status).toBe('warning');
    expect(summary.confidenceScore).toBe(90);
    expect(summary.confidenceLevel).toBe('medium');
    expect(Object.keys(summary.checks).length).toBeGreaterThan(0);
  });

  it('should append missing verification/sources sections to response text', () => {
    const summary = makeSummary({ status: 'pass', confidenceScore: 100 });
    const response = ensureVerificationSections({
      response: 'AAPL is $100.',
      summary
    });

    const sections = hasRequiredSections(response);
    expect(sections.hasVerificationSection).toBe(true);
    expect(sections.hasSourcesSection).toBe(true);
    expect(response).toContain('### Verification');
    expect(response).toContain('### Sources');
  });
});
