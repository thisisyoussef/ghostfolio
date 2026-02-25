import * as path from 'path';

import {
  loadAsLangSmithCases,
  LangSmithEvalCase,
  LangSmithMultiTurnCase
} from './dataset';

const GOLDEN_DATA_PATH = path.resolve(__dirname, 'golden-data.yaml');

describe('dataset adapter (golden-data.yaml → LangSmith format)', () => {
  let result: ReturnType<typeof loadAsLangSmithCases>;

  beforeAll(() => {
    result = loadAsLangSmithCases(GOLDEN_DATA_PATH);
  });

  describe('loadAsLangSmithCases', () => {
    it('should return singleTurnCases and multiTurnCases arrays', () => {
      expect(result).toHaveProperty('singleTurnCases');
      expect(result).toHaveProperty('multiTurnCases');
      expect(Array.isArray(result.singleTurnCases)).toBe(true);
      expect(Array.isArray(result.multiTurnCases)).toBe(true);
    });

    it('should produce 45 single-turn cases and 10 multi-turn cases from 55 golden cases', () => {
      expect(result.singleTurnCases).toHaveLength(45);
      expect(result.multiTurnCases).toHaveLength(10);
    });

    it('should produce totalCases equal to 55', () => {
      expect(result.totalCases).toBe(55);
    });
  });

  describe('single-turn case shape', () => {
    let firstCase: LangSmithEvalCase;

    beforeAll(() => {
      firstCase = result.singleTurnCases[0];
    });

    it('should have inputs with message and session_id', () => {
      expect(firstCase.inputs).toHaveProperty('message');
      expect(firstCase.inputs).toHaveProperty('session_id');
      expect(typeof firstCase.inputs.message).toBe('string');
      expect(firstCase.inputs.message.length).toBeGreaterThan(0);
    });

    it('should have outputs with expectedTools, mustContain, mustNotContain, category', () => {
      expect(firstCase.outputs).toHaveProperty('expectedTools');
      expect(firstCase.outputs).toHaveProperty('mustContain');
      expect(firstCase.outputs).toHaveProperty('mustNotContain');
      expect(firstCase.outputs).toHaveProperty('category');
      expect(firstCase.outputs).toHaveProperty('requiresVerification');
      expect(Array.isArray(firstCase.outputs.expectedTools)).toBe(true);
      expect(Array.isArray(firstCase.outputs.mustContain)).toBe(true);
      expect(Array.isArray(firstCase.outputs.mustNotContain)).toBe(true);
      expect(typeof firstCase.outputs.requiresVerification).toBe('boolean');
    });

    it('should have metadata with id, subcategory, difficulty', () => {
      expect(firstCase.metadata).toHaveProperty('id');
      expect(firstCase.metadata).toHaveProperty('subcategory');
      expect(firstCase.metadata).toHaveProperty('difficulty');
      expect(firstCase.metadata).toHaveProperty('coverageBucket');
    });

    it('should map gs-001 correctly (AAPL price query)', () => {
      const aapl = result.singleTurnCases.find(
        (c) => c.metadata.id === 'gs-001'
      );
      expect(aapl).toBeDefined();
      expect(aapl!.inputs.message).toBe(
        'What is the current price of AAPL?'
      );
      expect(aapl!.outputs.expectedTools).toEqual(['market_data_fetch']);
      expect(aapl!.outputs.mustContain).toEqual(['AAPL']);
      expect(aapl!.outputs.category).toBe('market_data');
    });
  });

  describe('multi-turn case shape', () => {
    let firstMulti: LangSmithMultiTurnCase;

    beforeAll(() => {
      firstMulti = result.multiTurnCases[0];
    });

    it('should have turns array with query, expectedTools, mustContain, mustNotContain', () => {
      expect(Array.isArray(firstMulti.turns)).toBe(true);
      expect(firstMulti.turns.length).toBeGreaterThanOrEqual(2);

      const turn = firstMulti.turns[0];
      expect(turn).toHaveProperty('query');
      expect(turn).toHaveProperty('expectedTools');
      expect(turn).toHaveProperty('mustContain');
      expect(turn).toHaveProperty('mustNotContain');
    });

    it('should have metadata with id, category, subcategory, difficulty', () => {
      expect(firstMulti.metadata).toHaveProperty('id');
      expect(firstMulti.metadata).toHaveProperty('category');
      expect(firstMulti.metadata.category).toBe('multi_turn');
    });

    it('should have session_id for multi-turn context', () => {
      expect(firstMulti).toHaveProperty('session_id');
      expect(typeof firstMulti.session_id).toBe('string');
    });
  });

  describe('PLACEHOLDER_LONG_INPUT handling', () => {
    it('should preserve PLACEHOLDER_LONG_INPUT as-is (runner resolves it)', () => {
      const longInput = result.singleTurnCases.find(
        (c) => c.metadata.id === 'gs-020'
      );
      expect(longInput).toBeDefined();
      expect(longInput!.inputs.message).toBe('PLACEHOLDER_LONG_INPUT');
    });
  });

  describe('empty query handling', () => {
    it('should map empty query string for gs-019', () => {
      const empty = result.singleTurnCases.find(
        (c) => c.metadata.id === 'gs-019'
      );
      expect(empty).toBeDefined();
      expect(empty!.inputs.message).toBe('');
    });
  });
});
