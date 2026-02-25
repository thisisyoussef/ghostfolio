import { confidenceLevelFromScore } from './confidence.policy';
import {
  type VerificationCheck,
  type VerificationSource,
  type VerificationSummary,
  type VerificationStatus
} from './verification.types';

export interface VerificationSummaryEntry {
  key: string;
  summary: VerificationSummary;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseJsonSafe(value: string):
  | { parsed: unknown; error?: undefined }
  | { parsed?: undefined; error: string } {
  try {
    return { parsed: JSON.parse(value) };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export function hasRequiredSections(response: string): {
  hasSourcesSection: boolean;
  hasVerificationSection: boolean;
} {
  return {
    hasSourcesSection: /(^|\n)###\s+Sources\b/i.test(response),
    hasVerificationSection: /(^|\n)###\s+Verification\b/i.test(response)
  };
}

function isVerificationCheck(value: unknown): value is VerificationCheck {
  return isRecord(value) && typeof value.passed === 'boolean';
}

function isVerificationSummary(value: unknown): value is VerificationSummary {
  if (!isRecord(value)) {
    return false;
  }

  if (
    !['pass', 'warning', 'fail'].includes(String(value.status)) ||
    typeof value.confidenceScore !== 'number' ||
    !['high', 'medium', 'low'].includes(String(value.confidenceLevel)) ||
    !isRecord(value.checks) ||
    !Array.isArray(value.sources) ||
    typeof value.generatedAt !== 'string'
  ) {
    return false;
  }

  return Object.values(value.checks).every(isVerificationCheck);
}

export function extractVerificationEntriesFromToolResult(args: {
  toolName: string;
  parsed: unknown;
}): VerificationSummaryEntry[] {
  const { toolName, parsed } = args;
  const entries: VerificationSummaryEntry[] = [];

  if (!isRecord(parsed)) {
    return entries;
  }

  if (isVerificationSummary(parsed.verification)) {
    entries.push({
      key: toolName,
      summary: parsed.verification
    });
  }

  if (toolName === 'market_data_fetch') {
    for (const [symbol, value] of Object.entries(parsed)) {
      if (!isRecord(value) || !isVerificationSummary(value.verification)) {
        continue;
      }

      entries.push({
        key: `${toolName}.${symbol}`,
        summary: value.verification
      });
    }
  }

  return entries;
}

function dedupeSources(sources: VerificationSource[]): VerificationSource[] {
  const seen = new Set<string>();

  return sources.filter((source) => {
    const key = `${source.tool}|${source.claim}|${source.source}|${source.timestamp}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

export function aggregateVerificationEntries(
  entries: VerificationSummaryEntry[]
): VerificationSummary {
  if (entries.length === 0) {
    return {
      status: 'fail',
      confidenceScore: 0,
      confidenceLevel: 'low',
      checks: {
        verificationCoverage: {
          passed: false,
          reason: 'No verification metadata found in tool payloads.'
        }
      },
      sources: [],
      generatedAt: new Date().toISOString()
    };
  }

  const checks: Record<string, VerificationCheck> = {};
  const statuses: VerificationStatus[] = [];
  const confidenceScores: number[] = [];
  const sources: VerificationSource[] = [];

  for (const entry of entries) {
    statuses.push(entry.summary.status);
    confidenceScores.push(entry.summary.confidenceScore);

    for (const [checkName, check] of Object.entries(entry.summary.checks)) {
      checks[`${entry.key}.${checkName}`] = check;
    }

    sources.push(...entry.summary.sources);
  }

  const status: VerificationStatus = statuses.includes('fail')
    ? 'fail'
    : statuses.includes('warning')
      ? 'warning'
      : 'pass';

  const confidenceScore = Math.round(
    confidenceScores.reduce((sum, score) => sum + score, 0) /
      confidenceScores.length
  );

  return {
    status,
    confidenceScore,
    confidenceLevel: confidenceLevelFromScore(confidenceScore),
    checks,
    sources: dedupeSources(sources),
    generatedAt: new Date().toISOString()
  };
}

function renderVerificationBlock(summary: VerificationSummary): string {
  const failedChecks = Object.entries(summary.checks)
    .filter(([, check]) => !check.passed)
    .map(([name, check]) => {
      return check.reason ? `${name} (${check.reason})` : name;
    });

  return [
    '### Verification',
    '',
    `- **Status:** ${summary.status.toUpperCase()}`,
    `- **Confidence:** ${summary.confidenceScore}/100 (${summary.confidenceLevel})`,
    failedChecks.length > 0
      ? `- **Failed checks:** ${failedChecks.join(', ')}`
      : '- **Failed checks:** none'
  ].join('\n');
}

function renderSourcesBlock(summary: VerificationSummary): string {
  const lines = ['### Sources', ''];

  if (summary.sources.length === 0) {
    lines.push('- No tool sources were provided.');
    return lines.join('\n');
  }

  for (const source of summary.sources) {
    lines.push(
      `- ${source.tool} (${source.claim}): ${source.source} — ${source.timestamp}`
    );
  }

  return lines.join('\n');
}

export function ensureVerificationSections(args: {
  response: string;
  summary: VerificationSummary;
}): string {
  const { response, summary } = args;
  const { hasSourcesSection, hasVerificationSection } = hasRequiredSections(
    response
  );

  const additions: string[] = [];

  if (!hasVerificationSection) {
    additions.push(renderVerificationBlock(summary));
  }

  if (!hasSourcesSection) {
    additions.push(renderSourcesBlock(summary));
  }

  if (additions.length === 0) {
    return response;
  }

  const trimmed = response.trimEnd();

  return `${trimmed}\n\n${additions.join('\n\n')}`;
}
