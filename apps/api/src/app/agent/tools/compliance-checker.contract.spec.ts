/**
 * Layer 4: ESG Compliance Contract Tests
 *
 * Verifies the output shape of complianceCheck() against its TypeScript interface.
 * Pure function tests — zero dependencies, zero mocks.
 * Calls complianceCheck() directly with known inputs and validates structure.
 */

import {
  complianceCheck,
  ComplianceCheckOutput,
  HoldingInput
} from './compliance-checker.tool';

describe('complianceCheck — Contract Tests (Layer 4)', () => {
  // Test 1: ComplianceCheckOutput has all required fields with correct types
  it('should return output matching ComplianceCheckOutput interface', async () => {
    const holdings: HoldingInput[] = [
      { symbol: 'AAPL', name: 'Apple Inc.', valueInBaseCurrency: 5000 },
      {
        symbol: 'XOM',
        name: 'Exxon Mobil Corporation',
        valueInBaseCurrency: 2000
      }
    ];

    const result: ComplianceCheckOutput = await complianceCheck({ holdings });

    // Required fields exist
    expect(result).toHaveProperty('complianceScore');
    expect(result).toHaveProperty('violations');
    expect(result).toHaveProperty('cleanHoldings');
    expect(result).toHaveProperty('totalChecked');
    expect(result).toHaveProperty('datasetVersion');
    expect(result).toHaveProperty('datasetLastUpdated');
    expect(result).toHaveProperty('sourceAttribution');
    expect(result).toHaveProperty('verification');

    // Correct types
    expect(typeof result.complianceScore).toBe('number');
    expect(Array.isArray(result.violations)).toBe(true);
    expect(Array.isArray(result.cleanHoldings)).toBe(true);
    expect(typeof result.totalChecked).toBe('number');
    expect(typeof result.datasetVersion).toBe('string');
    expect(typeof result.datasetLastUpdated).toBe('string');
    expect(typeof result.sourceAttribution?.primary?.source).toBe('string');
    expect(typeof result.sourceAttribution?.primary?.timestamp).toBe('string');
    expect(typeof result.verification?.confidenceScore).toBe('number');
    expect(typeof result.verification?.status).toBe('string');

    // No extra top-level fields
    const validKeys = new Set([
      'complianceScore',
      'violations',
      'cleanHoldings',
      'totalChecked',
      'datasetVersion',
      'datasetLastUpdated',
      'sourceAttribution',
      'verification'
    ]);
    for (const key of Object.keys(result)) {
      expect(validKeys.has(key)).toBe(true);
    }
  });

  // Test 2: violations[] entries have all required fields
  it('should return violation entries with correct shape', async () => {
    const holdings: HoldingInput[] = [
      {
        symbol: 'XOM',
        name: 'Exxon Mobil Corporation',
        valueInBaseCurrency: 3000
      },
      { symbol: 'LMT', name: 'Lockheed Martin', valueInBaseCurrency: 2000 },
      {
        symbol: 'PM',
        name: 'Philip Morris International',
        valueInBaseCurrency: 1000
      }
    ];

    const result = await complianceCheck({ holdings });

    expect(result.violations.length).toBeGreaterThanOrEqual(3);

    for (const violation of result.violations) {
      // Required fields
      expect(violation).toHaveProperty('symbol');
      expect(violation).toHaveProperty('name');
      expect(violation).toHaveProperty('categories');
      expect(violation).toHaveProperty('severity');
      expect(violation).toHaveProperty('reason');
      expect(violation).toHaveProperty('valueInBaseCurrency');

      // Correct types
      expect(typeof violation.symbol).toBe('string');
      expect(typeof violation.name).toBe('string');
      expect(Array.isArray(violation.categories)).toBe(true);
      expect(violation.categories.length).toBeGreaterThan(0);
      expect(typeof violation.severity).toBe('string');
      expect(['high', 'medium', 'low']).toContain(violation.severity);
      expect(typeof violation.reason).toBe('string');
      expect(violation.reason.length).toBeGreaterThan(0);
      expect(typeof violation.valueInBaseCurrency).toBe('number');
    }
  });

  // Test 3: cleanHoldings[] entries have all required fields
  it('should return clean holding entries with correct shape', async () => {
    const holdings: HoldingInput[] = [
      { symbol: 'AAPL', name: 'Apple Inc.', valueInBaseCurrency: 5000 },
      {
        symbol: 'MSFT',
        name: 'Microsoft Corporation',
        valueInBaseCurrency: 3000
      },
      {
        symbol: 'XOM',
        name: 'Exxon Mobil Corporation',
        valueInBaseCurrency: 2000
      }
    ];

    const result = await complianceCheck({ holdings });

    expect(result.cleanHoldings.length).toBeGreaterThanOrEqual(2);

    for (const clean of result.cleanHoldings) {
      // Required fields
      expect(clean).toHaveProperty('symbol');
      expect(clean).toHaveProperty('name');
      expect(clean).toHaveProperty('valueInBaseCurrency');

      // Correct types
      expect(typeof clean.symbol).toBe('string');
      expect(typeof clean.name).toBe('string');
      expect(typeof clean.valueInBaseCurrency).toBe('number');

      // No extra fields
      const validKeys = new Set(['symbol', 'name', 'valueInBaseCurrency']);
      for (const key of Object.keys(clean)) {
        expect(validKeys.has(key)).toBe(true);
      }
    }
  });
});
