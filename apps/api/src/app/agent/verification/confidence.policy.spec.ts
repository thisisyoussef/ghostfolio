import {
  buildVerificationSummary,
  computeConfidenceScore,
  confidenceLevelFromScore,
  deriveVerificationStatus
} from './confidence.policy';

describe('confidence policy', () => {
  it('should apply fixed penalties and cap hard error confidence at 25', () => {
    const score = computeConfidenceScore({
      outputSchemaFailed: true,
      sourceAttributionFailed: true,
      discrepancyExceeded: true,
      backupUnavailable: true,
      hardError: true
    });

    expect(score).toBe(0);
  });

  it('should map confidence levels by fixed thresholds', () => {
    expect(confidenceLevelFromScore(95)).toBe('high');
    expect(confidenceLevelFromScore(70)).toBe('medium');
    expect(confidenceLevelFromScore(69)).toBe('low');
  });

  it('should return fail when critical check fails and warning when non-critical check fails', () => {
    expect(
      deriveVerificationStatus({
        checks: {
          outputSchema: { passed: false },
          sourceAttribution: { passed: true },
          scoreBounds: { passed: true }
        }
      })
    ).toBe('fail');

    expect(
      deriveVerificationStatus({
        checks: {
          outputSchema: { passed: true },
          sourceAttribution: { passed: true },
          scoreBounds: { passed: false }
        }
      })
    ).toBe('warning');
  });

  it('should build deterministic summary with score, level, and checks', () => {
    const summary = buildVerificationSummary({
      checks: {
        outputSchema: { passed: true },
        sourceAttribution: { passed: true },
        crossSourcePrice: { passed: false }
      },
      sources: [],
      flags: {
        discrepancyExceeded: true
      }
    });

    expect(summary.confidenceScore).toBe(65);
    expect(summary.confidenceLevel).toBe('low');
    expect(summary.status).toBe('warning');
    expect(summary.generatedAt).toBeDefined();
  });
});
