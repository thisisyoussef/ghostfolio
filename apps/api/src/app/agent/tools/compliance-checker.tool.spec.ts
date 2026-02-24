import {
  complianceCheck,
  ComplianceCheckOutput,
  HoldingInput
} from './compliance-checker.tool';

describe('complianceCheck', () => {
  const cleanHoldings: HoldingInput[] = [
    { symbol: 'AAPL', name: 'Apple Inc.', valueInBaseCurrency: 5000 },
    {
      symbol: 'MSFT',
      name: 'Microsoft Corporation',
      valueInBaseCurrency: 3000
    },
    { symbol: 'GOOGL', name: 'Alphabet Inc.', valueInBaseCurrency: 2000 }
  ];

  const mixedHoldings: HoldingInput[] = [
    { symbol: 'AAPL', name: 'Apple Inc.', valueInBaseCurrency: 5000 },
    {
      symbol: 'XOM',
      name: 'Exxon Mobil Corporation',
      valueInBaseCurrency: 2000
    },
    { symbol: 'MSFT', name: 'Microsoft Corporation', valueInBaseCurrency: 3000 }
  ];

  it('should return score 100 for all-clean portfolio', async () => {
    const result: ComplianceCheckOutput = await complianceCheck({
      holdings: cleanHoldings
    });

    expect(result.complianceScore).toBe(100);
    expect(result.violations).toHaveLength(0);
    expect(result.cleanHoldings).toHaveLength(3);
    expect(result.totalChecked).toBe(3);
    expect(result.datasetVersion).toBeDefined();
  });

  it('should flag XOM with category fossil_fuels and severity high', async () => {
    const result = await complianceCheck({ holdings: mixedHoldings });

    expect(result.violations).toHaveLength(1);
    const xomViolation = result.violations[0];
    expect(xomViolation.symbol).toBe('XOM');
    expect(xomViolation.categories).toContain('fossil_fuels');
    expect(xomViolation.severity).toBe('high');
    expect(xomViolation.reason).toBeDefined();
    expect(xomViolation.reason.length).toBeGreaterThan(0);
  });

  it('should calculate correct compliance score (80% clean → score = 80.0)', async () => {
    // Total value = 5000 + 2000 + 3000 = 10000
    // Clean value = 5000 (AAPL) + 3000 (MSFT) = 8000
    // Score = (8000 / 10000) * 100 = 80.0
    const result = await complianceCheck({ holdings: mixedHoldings });

    expect(result.complianceScore).toBe(80);
  });

  it('should filter by category (fossil_fuels only)', async () => {
    const holdingsWithMultipleViolations: HoldingInput[] = [
      { symbol: 'AAPL', name: 'Apple Inc.', valueInBaseCurrency: 5000 },
      { symbol: 'XOM', name: 'Exxon Mobil', valueInBaseCurrency: 2000 },
      { symbol: 'LMT', name: 'Lockheed Martin', valueInBaseCurrency: 1000 },
      { symbol: 'PM', name: 'Philip Morris', valueInBaseCurrency: 2000 }
    ];

    const result = await complianceCheck({
      holdings: holdingsWithMultipleViolations,
      filterCategory: 'fossil_fuels'
    });

    // Only XOM should be flagged when filtering for fossil_fuels
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].symbol).toBe('XOM');
    // Score should only consider fossil_fuels violations
    // Clean = 5000 + 1000 + 2000 = 8000, total = 10000, score = 80
    expect(result.complianceScore).toBe(80);
  });

  it('should handle empty portfolio gracefully', async () => {
    const result = await complianceCheck({ holdings: [] });

    expect(result.complianceScore).toBe(100);
    expect(result.violations).toHaveLength(0);
    expect(result.cleanHoldings).toHaveLength(0);
    expect(result.totalChecked).toBe(0);
  });

  it('should return score 0 when all holdings are flagged', async () => {
    const allFlagged: HoldingInput[] = [
      { symbol: 'XOM', name: 'Exxon Mobil', valueInBaseCurrency: 5000 },
      { symbol: 'LMT', name: 'Lockheed Martin', valueInBaseCurrency: 5000 }
    ];

    const result = await complianceCheck({ holdings: allFlagged });

    expect(result.complianceScore).toBe(0);
    expect(result.violations).toHaveLength(2);
    expect(result.cleanHoldings).toHaveLength(0);
  });

  it('should include dataset version and lastUpdated in output', async () => {
    const result = await complianceCheck({ holdings: cleanHoldings });

    expect(result.datasetVersion).toBe('1.0');
    expect(result.datasetLastUpdated).toBeDefined();
    expect(typeof result.datasetLastUpdated).toBe('string');
  });

  it('should match symbols case-insensitively', async () => {
    const lowercaseHoldings: HoldingInput[] = [
      { symbol: 'xom', name: 'Exxon Mobil', valueInBaseCurrency: 5000 }
    ];

    const result = await complianceCheck({ holdings: lowercaseHoldings });

    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].symbol).toBe('xom');
  });

  it('should return 0 violations when filter category has no matches', async () => {
    // XOM is fossil_fuels — filtering by gambling should produce 0 violations
    const holdings: HoldingInput[] = [
      {
        symbol: 'XOM',
        name: 'Exxon Mobil Corporation',
        valueInBaseCurrency: 5000
      },
      { symbol: 'AAPL', name: 'Apple Inc.', valueInBaseCurrency: 3000 }
    ];

    const result = await complianceCheck({
      holdings,
      filterCategory: 'gambling'
    });

    expect(result.violations).toHaveLength(0);
    expect(result.complianceScore).toBe(100);
    expect(result.cleanHoldings).toHaveLength(2);
    expect(result.totalChecked).toBe(2);
  });

  it('should match by name when symbol is a UUID (MANUAL data source)', async () => {
    // Ghostfolio MANUAL data source assigns UUIDs as symbols
    // but keeps the original ticker in the name field
    const uuidHoldings: HoldingInput[] = [
      {
        symbol: 'a921354c-3177-42f9-a834-43ee37fee7be',
        name: 'XOM',
        valueInBaseCurrency: 2000
      },
      {
        symbol: '7f2438ac-a887-4e01-a1e7-efd10889b974',
        name: 'AAPL',
        valueInBaseCurrency: 5000
      }
    ];

    const result = await complianceCheck({ holdings: uuidHoldings });

    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].categories).toContain('fossil_fuels');
    expect(result.cleanHoldings).toHaveLength(1);
    // Score: (5000 / 7000) * 100 ≈ 71.43
    expect(result.complianceScore).toBeCloseTo(71.43, 0);
  });

  it('should handle multiple violations across different categories', async () => {
    const diverseViolations: HoldingInput[] = [
      { symbol: 'XOM', name: 'Exxon Mobil', valueInBaseCurrency: 3000 },
      { symbol: 'LMT', name: 'Lockheed Martin', valueInBaseCurrency: 2000 },
      { symbol: 'PM', name: 'Philip Morris', valueInBaseCurrency: 1000 },
      { symbol: 'AAPL', name: 'Apple Inc.', valueInBaseCurrency: 4000 }
    ];

    const result = await complianceCheck({ holdings: diverseViolations });

    expect(result.violations).toHaveLength(3);
    expect(result.cleanHoldings).toHaveLength(1);
    expect(result.totalChecked).toBe(4);
    // Clean = 4000, Total = 10000, Score = 40
    expect(result.complianceScore).toBe(40);
    const violationCategories = result.violations.flatMap((v) => v.categories);
    expect(violationCategories).toContain('fossil_fuels');
    expect(violationCategories).toContain('weapons_defense');
    expect(violationCategories).toContain('tobacco');
  });
});
