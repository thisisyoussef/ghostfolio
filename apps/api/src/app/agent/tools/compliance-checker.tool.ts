import { buildVerificationSummary } from '../verification/confidence.policy';
import {
  attributionToSources,
  hasValidSourceAttribution,
  toSourceAttribution
} from '../verification/source-attribution';
import {
  type VerificationSourceAttribution,
  type VerificationSummary
} from '../verification/verification.types';

export interface HoldingInput {
  symbol: string;
  name?: string;
  valueInBaseCurrency: number;
}

export interface ComplianceCheckInput {
  holdings: HoldingInput[];
  filterCategory?: string;
  requestedSymbols?: string[];
}

export interface ViolationResult {
  symbol: string;
  name: string;
  categories: string[];
  severity: string;
  reason: string;
  valueInBaseCurrency: number;
}

export interface ComplianceCheckOutput {
  complianceScore: number;
  violations: ViolationResult[];
  cleanHoldings: {
    symbol: string;
    name: string;
    valueInBaseCurrency: number;
  }[];
  totalChecked: number;
  datasetVersion: string;
  datasetLastUpdated: string;
  requestedSymbols?: string[];
  matchedSymbols?: string[];
  unmatchedSymbols?: string[];
  sourceAttribution?: VerificationSourceAttribution;
  verification?: VerificationSummary;
}

interface EsgViolationEntry {
  symbol: string;
  name: string;
  categories: string[];
  severity: string;
  reason: string;
}

interface EsgDataset {
  version: string;
  lastUpdated: string;
  categories: Record<string, string>;
  violations: EsgViolationEntry[];
}

// Use require() for JSON — works with both ts-jest and webpack bundling
// eslint-disable-next-line @typescript-eslint/no-var-requires
const esgDataset: EsgDataset = require('../data/esg-violations.json');

function isValidComplianceOutput(output: ComplianceCheckOutput): boolean {
  return (
    typeof output.complianceScore === 'number' &&
    Array.isArray(output.violations) &&
    Array.isArray(output.cleanHoldings) &&
    typeof output.totalChecked === 'number' &&
    typeof output.datasetVersion === 'string' &&
    typeof output.datasetLastUpdated === 'string'
  );
}

export async function complianceCheck(
  input: ComplianceCheckInput
): Promise<ComplianceCheckOutput> {
  const { holdings, filterCategory, requestedSymbols = [] } = input;
  const dataset = esgDataset;

  // Build a lookup map: uppercase symbol → violation entry
  const violationMap = new Map<string, EsgViolationEntry>();
  for (const entry of dataset.violations) {
    violationMap.set(entry.symbol.toUpperCase(), entry);
  }

  const violations: ViolationResult[] = [];
  const cleanHoldings: {
    symbol: string;
    name: string;
    valueInBaseCurrency: number;
  }[] = [];

  let totalValue = 0;
  let violatedValue = 0;

  for (const holding of holdings) {
    const upperSymbol = holding.symbol.toUpperCase();
    // Try matching by symbol first, then by name (for MANUAL data source where
    // Ghostfolio assigns UUIDs as symbols but keeps the ticker in the name)
    const upperName = (holding.name || '').toUpperCase();
    const entry = violationMap.get(upperSymbol) || violationMap.get(upperName);
    totalValue += holding.valueInBaseCurrency;

    if (entry) {
      // Check if this violation matches the category filter (if provided)
      const matchesFilter =
        !filterCategory ||
        entry.categories.includes(filterCategory.toLowerCase());

      if (matchesFilter) {
        violations.push({
          symbol: holding.symbol,
          name: entry.name,
          categories: entry.categories,
          severity: entry.severity,
          reason: entry.reason,
          valueInBaseCurrency: holding.valueInBaseCurrency
        });
        violatedValue += holding.valueInBaseCurrency;
      } else {
        // Violated but not in the filtered category — treat as clean for scoring
        cleanHoldings.push({
          symbol: holding.symbol,
          name: holding.name || entry.name,
          valueInBaseCurrency: holding.valueInBaseCurrency
        });
      }
    } else {
      cleanHoldings.push({
        symbol: holding.symbol,
        name: holding.name || holding.symbol,
        valueInBaseCurrency: holding.valueInBaseCurrency
      });
    }
  }

  const complianceScore =
    totalValue === 0
      ? 100
      : Math.round(((totalValue - violatedValue) / totalValue) * 100 * 100) /
        100;

  const baseResult: ComplianceCheckOutput = {
    complianceScore,
    violations,
    cleanHoldings,
    totalChecked: holdings.length,
    datasetVersion: dataset.version,
    datasetLastUpdated: dataset.lastUpdated,
    ...(requestedSymbols.length > 0
      ? {
          matchedSymbols: Array.from(
            new Set(
              holdings.map((holding) => {
                return String(holding.symbol || '').toUpperCase();
              })
            )
          ),
          requestedSymbols: Array.from(
            new Set(
              requestedSymbols.map((symbol) => {
                return String(symbol || '').toUpperCase();
              })
            )
          )
        }
      : {})
  };

  if (baseResult.requestedSymbols && baseResult.matchedSymbols) {
    const matchedSet = new Set(baseResult.matchedSymbols);
    baseResult.unmatchedSymbols = baseResult.requestedSymbols.filter((symbol) => {
      return !matchedSet.has(symbol);
    });
  }

  const sourceAttribution = toSourceAttribution({
    primarySource: `ESG Violations Dataset v${dataset.version}`,
    primaryTimestamp: dataset.lastUpdated
  });

  const checks = {
    outputSchema: {
      passed: isValidComplianceOutput(baseResult),
      reason: isValidComplianceOutput(baseResult)
        ? undefined
        : 'Compliance output schema is invalid.'
    },
    sourceAttribution: {
      passed: hasValidSourceAttribution(sourceAttribution),
      reason: hasValidSourceAttribution(sourceAttribution)
        ? undefined
        : 'Source attribution must include source and timestamp.'
    },
    scoreBounds: {
      passed: complianceScore >= 0 && complianceScore <= 100,
      reason:
        complianceScore >= 0 && complianceScore <= 100
          ? undefined
          : 'Compliance score must be between 0 and 100.'
    }
  };

  const verification = buildVerificationSummary({
    checks,
    sources: attributionToSources({
      attribution: sourceAttribution,
      tool: 'compliance_check',
      primaryClaim: 'esg compliance dataset'
    }),
    flags: {
      outputSchemaFailed: !checks.outputSchema.passed,
      sourceAttributionFailed: !checks.sourceAttribution.passed
    }
  });

  return {
    ...baseResult,
    sourceAttribution,
    verification
  };
}
