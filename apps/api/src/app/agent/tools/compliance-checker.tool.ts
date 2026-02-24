export interface HoldingInput {
  symbol: string;
  name?: string;
  valueInBaseCurrency: number;
}

export interface ComplianceCheckInput {
  holdings: HoldingInput[];
  filterCategory?: string;
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

export async function complianceCheck(
  input: ComplianceCheckInput
): Promise<ComplianceCheckOutput> {
  const { holdings, filterCategory } = input;
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
    const entry = violationMap.get(upperSymbol);
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

  return {
    complianceScore,
    violations,
    cleanHoldings,
    totalChecked: holdings.length,
    datasetVersion: dataset.version,
    datasetLastUpdated: dataset.lastUpdated
  };
}
