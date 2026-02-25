/**
 * Adapter: reads golden-data.yaml (the single source of truth) and
 * transforms cases into the LangSmith EvalCase format.
 *
 * This module is used by eval-runner-langsmith.ts (Tier 2).
 * The deterministic runner (eval-runner.ts, Tier 1) reads YAML directly.
 */
import * as fs from 'fs';
import * as yaml from 'js-yaml';

import { GoldenCase, GoldenDataFile, EvalTurn } from './types';

// ── LangSmith-specific types ─────────────────────────────────────────────────

export interface LangSmithEvalCase {
  inputs: {
    message: string;
    session_id: string;
  };
  outputs: {
    expectedTools: string[];
    mustContain: string[];
    mustNotContain: string[];
    category: string;
  };
  metadata: {
    id: string;
    subcategory: string;
    difficulty: string;
  };
}

export interface LangSmithMultiTurnCase {
  turns: Array<{
    query: string;
    expectedTools: string[];
    mustContain: string[];
    mustNotContain: string[];
  }>;
  session_id: string;
  metadata: {
    id: string;
    category: string;
    subcategory: string;
    difficulty: string;
  };
}

// ── Adapter function ─────────────────────────────────────────────────────────

export function loadAsLangSmithCases(yamlPath: string): {
  singleTurnCases: LangSmithEvalCase[];
  multiTurnCases: LangSmithMultiTurnCase[];
  totalCases: number;
} {
  const raw = fs.readFileSync(yamlPath, 'utf-8');
  const parsed = yaml.load(raw) as GoldenDataFile;

  const singleTurnCases: LangSmithEvalCase[] = [];
  const multiTurnCases: LangSmithMultiTurnCase[] = [];

  for (const gc of parsed.cases) {
    const isMultiTurn =
      Array.isArray(gc.turns) && gc.turns.length > 0;

    if (isMultiTurn) {
      multiTurnCases.push(toMultiTurnCase(gc));
    } else {
      singleTurnCases.push(toSingleTurnCase(gc));
    }
  }

  return {
    singleTurnCases,
    multiTurnCases,
    totalCases: singleTurnCases.length + multiTurnCases.length
  };
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function toSingleTurnCase(gc: GoldenCase): LangSmithEvalCase {
  return {
    inputs: {
      message: gc.query ?? '',
      session_id: `eval-${gc.id}`
    },
    outputs: {
      expectedTools: gc.expected_tools,
      mustContain: gc.must_contain,
      mustNotContain: gc.must_not_contain,
      category: gc.category
    },
    metadata: {
      id: gc.id,
      subcategory: gc.subcategory,
      difficulty: gc.difficulty
    }
  };
}

function toMultiTurnCase(gc: GoldenCase): LangSmithMultiTurnCase {
  const turns = (gc.turns || []).map((t: EvalTurn) => ({
    query: t.query,
    expectedTools: t.expected_tools,
    mustContain: t.must_contain,
    mustNotContain: t.must_not_contain
  }));

  return {
    turns,
    session_id: `eval-mt-${gc.id}`,
    metadata: {
      id: gc.id,
      category: gc.category,
      subcategory: gc.subcategory,
      difficulty: gc.difficulty
    }
  };
}
