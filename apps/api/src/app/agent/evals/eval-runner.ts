import { Client } from 'langsmith';
import { evaluate } from 'langsmith/evaluation';
import type { EvaluationResult } from 'langsmith/evaluation';
import type { Run, Example } from 'langsmith/schemas';

import { singleTurnCases, multiTurnCases, TOTAL_CASES } from './dataset';
import { toolSelection, dataAccuracy, responseQuality, noHallucination } from './evaluators';
import { callAgent } from './target';

const DATASET_NAME = 'ghostfolio-agent-eval-v1';
const EXPERIMENT_PREFIX = 'ghostfolio-agent-eval';

async function seedDataset(client: Client): Promise<void> {
  // Delete existing dataset if it exists, to ensure clean state
  try {
    const existing = await client.readDataset({ datasetName: DATASET_NAME });
    if (existing) {
      await client.deleteDataset({ datasetId: existing.id });
      console.log(`Deleted existing dataset: ${DATASET_NAME}`);
    }
  } catch {
    // Dataset doesn't exist, that's fine
  }

  const dataset = await client.createDataset(DATASET_NAME, {
    description: `Ghostfolio agent eval suite — ${TOTAL_CASES} cases across 5 categories`
  });

  // Seed single-turn cases
  for (const evalCase of singleTurnCases) {
    await client.createExample(evalCase.inputs, evalCase.outputs, {
      datasetId: dataset.id
    });
  }

  // Seed multi-turn cases (encode as the final turn with metadata about prior turns)
  for (const mt of multiTurnCases) {
    const lastTurn = mt.turns[mt.turns.length - 1];
    const priorTurns = mt.turns.slice(0, -1);
    await client.createExample(
      {
        message: lastTurn.message,
        session_id: mt.session_id,
        prior_turns: priorTurns.map((t) => t.message)
      },
      {
        expectedTool: mt.expectedTool,
        expectedPatterns: mt.expectedPatterns,
        category: mt.category
      },
      { datasetId: dataset.id }
    );
  }

  console.log(`Seeded dataset "${DATASET_NAME}" with ${TOTAL_CASES} cases`);
}

/**
 * Target function adapter for evaluate().
 * For multi-turn cases, sends prior turns first before the evaluated turn.
 */
async function target(inputs: Record<string, unknown>): Promise<Record<string, unknown>> {
  const message = inputs.message as string;
  const sessionId = inputs.session_id as string;
  const priorTurns = (inputs.prior_turns as string[]) ?? [];

  // Send prior turns (for multi-turn cases) without scoring
  for (const turn of priorTurns) {
    await callAgent({ message: turn, session_id: sessionId });
  }

  // Send the actual turn to be evaluated
  const result = await callAgent({ message, session_id: sessionId });
  return result as unknown as Record<string, unknown>;
}

/**
 * Summary evaluator: re-applies per-case evaluator logic to compute overall pass rate.
 * Uses the new SDK signature: ({ runs, examples, inputs, outputs, referenceOutputs })
 *
 * A case "passes" if its average rubric score > 0.7.
 */
function overallPassRate({
  outputs,
  referenceOutputs
}: {
  runs: Array<Run>;
  examples: Array<Example>;
  inputs: Array<Record<string, any>>;
  outputs: Array<Record<string, any>>;
  referenceOutputs?: Array<Record<string, any>>;
}): EvaluationResult {
  let passed = 0;
  const categoryScores: Record<string, number[]> = {};

  for (let i = 0; i < outputs.length; i++) {
    const out = outputs[i];
    const ref = referenceOutputs?.[i];

    // Re-apply evaluator logic to get scores
    const scores = [
      toolSelection({ outputs: out, referenceOutputs: ref }),
      dataAccuracy({ outputs: out, referenceOutputs: ref }),
      responseQuality({ outputs: out }),
      noHallucination({ outputs: out })
    ]
      .filter((r) => typeof r.score === 'number')
      .map((r) => r.score as number);

    const avg = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    if (avg > 0.7) passed++;

    const category = (ref?.category as string) ?? 'unknown';
    if (!categoryScores[category]) categoryScores[category] = [];
    categoryScores[category].push(avg);
  }

  const passRate = outputs.length > 0 ? passed / outputs.length : 0;

  const breakdown = Object.entries(categoryScores)
    .map(([cat, scores]) => {
      const catAvg = scores.reduce((a, b) => a + b, 0) / scores.length;
      return `${cat}: ${(catAvg * 100).toFixed(0)}%`;
    })
    .join(', ');

  console.log(`\nPass rate: ${(passRate * 100).toFixed(1)}% (${passed}/${outputs.length})`);
  console.log(`Category breakdown: ${breakdown}`);

  return {
    key: 'overall_pass_rate',
    score: passRate,
    comment: `${passed}/${outputs.length} cases passed (>0.7 avg). ${breakdown}`
  };
}

async function main() {
  console.log('=== Ghostfolio Agent Eval Suite ===\n');

  // Validate env
  if (!process.env.LANGSMITH_API_KEY) {
    console.error('ERROR: LANGSMITH_API_KEY not set');
    process.exit(1);
  }
  if (!process.env.TEST_SECURITY_TOKEN) {
    console.error('ERROR: TEST_SECURITY_TOKEN not set (needed for agent API auth)');
    process.exit(1);
  }

  const baseUrl = process.env.EVAL_BASE_URL || 'https://ghostfolio-production-e8d1.up.railway.app';
  console.log(`Target: ${baseUrl}`);
  console.log(`Cases: ${TOTAL_CASES}\n`);

  const client = new Client();

  // Step 1: Seed dataset
  console.log('Seeding dataset...');
  await seedDataset(client);

  // Step 2: Run evaluation
  console.log('\nRunning evaluation...\n');
  const results = await evaluate(target, {
    data: DATASET_NAME,
    evaluators: [toolSelection, dataAccuracy, responseQuality, noHallucination],
    summaryEvaluators: [overallPassRate],
    experimentPrefix: EXPERIMENT_PREFIX,
    maxConcurrency: 2, // Gentle on production
    metadata: {
      baseUrl,
      timestamp: new Date().toISOString(),
      version: '1.0'
    }
  });

  console.log(`\nExperiment: ${results.experimentName}`);
  console.log('View results in LangSmith dashboard.');

  // Post-eval pass rate computation from ExperimentResults (for CI gating)
  let totalCases = 0;
  let passingCases = 0;

  for (const row of results.results) {
    totalCases++;
    const scores = row.evaluationResults.results
      .filter((r) => typeof r.score === 'number')
      .map((r) => r.score as number);
    const avg = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    if (avg > 0.7) passingCases++;
  }

  const finalPassRate = totalCases > 0 ? passingCases / totalCases : 0;
  console.log(`\nFinal pass rate: ${(finalPassRate * 100).toFixed(1)}% (${passingCases}/${totalCases})`);

  if (finalPassRate < 0.8) {
    console.error(`FAIL: Pass rate ${(finalPassRate * 100).toFixed(1)}% < 80% gate`);
    process.exit(1);
  }

  console.log('PASS: Eval suite meets >=80% pass rate gate.');
}

main().catch((err) => {
  console.error('Eval runner failed:', err);
  process.exit(1);
});
