import {
  type ConfidenceLevel,
  type VerificationCheck,
  type VerificationSource,
  type VerificationStatus,
  type VerificationSummary
} from './verification.types';

const BASE_SCORE = 100;
const HARD_ERROR_CAP = 25;

const PENALTY_OUTPUT_SCHEMA = 30;
const PENALTY_SOURCE_ATTRIBUTION = 20;
const PENALTY_DISCREPANCY = 35;
const PENALTY_BACKUP_UNAVAILABLE = 20;

export interface ConfidencePenaltyFlags {
  outputSchemaFailed?: boolean;
  sourceAttributionFailed?: boolean;
  discrepancyExceeded?: boolean;
  backupUnavailable?: boolean;
  hardError?: boolean;
}

function clampScore(value: number): number {
  if (value < 0) {
    return 0;
  }

  if (value > 100) {
    return 100;
  }

  return value;
}

export function confidenceLevelFromScore(score: number): ConfidenceLevel {
  if (score > 90) {
    return 'high';
  }

  if (score >= 70) {
    return 'medium';
  }

  return 'low';
}

export function computeConfidenceScore(flags: ConfidencePenaltyFlags): number {
  let score = BASE_SCORE;

  if (flags.outputSchemaFailed) {
    score -= PENALTY_OUTPUT_SCHEMA;
  }

  if (flags.sourceAttributionFailed) {
    score -= PENALTY_SOURCE_ATTRIBUTION;
  }

  if (flags.discrepancyExceeded) {
    score -= PENALTY_DISCREPANCY;
  }

  if (flags.backupUnavailable) {
    score -= PENALTY_BACKUP_UNAVAILABLE;
  }

  score = clampScore(score);

  if (flags.hardError) {
    score = Math.min(score, HARD_ERROR_CAP);
  }

  return score;
}

export function deriveVerificationStatus(args: {
  checks: Record<string, VerificationCheck>;
  criticalChecks?: string[];
}): VerificationStatus {
  const { checks, criticalChecks = ['outputSchema', 'sourceAttribution'] } =
    args;

  const entries = Object.entries(checks);

  if (entries.length === 0) {
    return 'warning';
  }

  for (const criticalCheck of criticalChecks) {
    const check = checks[criticalCheck];
    if (check && !check.passed) {
      return 'fail';
    }
  }

  if (entries.some(([, check]) => !check.passed)) {
    return 'warning';
  }

  return 'pass';
}

export function buildVerificationSummary(args: {
  checks: Record<string, VerificationCheck>;
  sources: VerificationSource[];
  flags: ConfidencePenaltyFlags;
  criticalChecks?: string[];
  generatedAt?: string;
}): VerificationSummary {
  const status = deriveVerificationStatus({
    checks: args.checks,
    criticalChecks: args.criticalChecks
  });
  const confidenceScore = computeConfidenceScore(args.flags);

  return {
    status,
    confidenceScore,
    confidenceLevel: confidenceLevelFromScore(confidenceScore),
    checks: args.checks,
    sources: args.sources,
    generatedAt: args.generatedAt || new Date().toISOString()
  };
}
