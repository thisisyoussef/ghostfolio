/**
 * Tier 2 Eval Runner: LangSmith platform with deterministic evaluators.
 *
 * Same golden-data.yaml cases and same binary checks as Tier 1,
 * but results are tracked in the LangSmith dashboard for:
 *   - Run history and experiment comparison
 *   - Per-case tracing (via traceable() target)
 *   - Visual dashboard with scores
 *
 * NO LLM-as-judge. All evaluators are pure deterministic code.
 *
 * Usage:
 *   LANGSMITH_API_KEY=... EVAL_ACCESS_TOKEN=... \
 *   EVAL_BASE_URL=https://ghostfolio-production-e8d1.up.railway.app \
 *   npx tsx apps/api/src/app/agent/evals/eval-runner-langsmith.ts
 */
import * as path from 'path';

import { Client } from 'langsmith';
import { evaluate } from 'langsmith/evaluation';

import { loadAsLangSmithCases } from './dataset';
import { authenticate, createTarget, clearAuthCache } from './target';
import {
  toolSelectionEvaluator,
  contentValidationEvaluator,
  negativeValidationEvaluator,
  verificationMetadataEvaluator,
  overallPassEvaluator
} from './langsmith-evaluators';

// ── Configuration ────────────────────────────────────────────────────────────

const LANGSMITH_PROJECT = 'ghostfolio-agent';
const DATASET_NAME = 'ghostfolio-agent-eval-v1';
const EXPERIMENT_PREFIX = 'ghostfolio-agent-eval';
const GOLDEN_DATA_PATH = path.resolve(__dirname, 'golden-data.yaml');

// ── Dataset seeding ──────────────────────────────────────────────────────────

async function seedDataset(client: Client): Promise<void> {
  console.log(`Seeding dataset: ${DATASET_NAME}`);

  const { singleTurnCases, totalCases } = loadAsLangSmithCases(GOLDEN_DATA_PATH);

  // Delete existing dataset if it exists (re-seed on every run)
  try {
    const existing = await client.readDataset({ datasetName: DATASET_NAME });
    if (existing) {
      await client.deleteDataset({ datasetId: existing.id });
      console.log('  Deleted existing dataset');
    }
  } catch {
    // Dataset doesn't exist yet — fine
  }

  const dataset = await client.createDataset(DATASET_NAME, {
    description: `Ghostfolio agent eval: ${totalCases} golden cases (deterministic checks)`
  });

  // Seed single-turn cases (multi-turn cases are handled separately)
  for (const evalCase of singleTurnCases) {
    await client.createExample(evalCase.inputs, evalCase.outputs, {
      datasetId: dataset.id,
      metadata: evalCase.metadata
    });
  }

  console.log(`  Seeded ${singleTurnCases.length} single-turn cases`);
  console.log(`  (${totalCases - singleTurnCases.length} multi-turn cases run separately)\n`);
}

// ── Multi-turn evaluation (manual, not via evaluate()) ───────────────────────

async function runMultiTurnEvals(
  baseUrl: string,
  jwt: string
): Promise<{ passed: number; failed: number; total: number }> {
  const { multiTurnCases } = loadAsLangSmithCases(GOLDEN_DATA_PATH);

  if (multiTurnCases.length === 0) {
    return { passed: 0, failed: 0, total: 0 };
  }

  console.log(`\nRunning ${multiTurnCases.length} multi-turn cases...`);
  let passed = 0;

  for (const mtCase of multiTurnCases) {
    const sessionId = `${mtCase.session_id}-${Date.now()}`;
    let casePassed = true;

    process.stdout.write(`  [${mtCase.metadata.id}] ${mtCase.metadata.subcategory}...`);

    for (const turn of mtCase.turns) {
      const message =
        turn.query === 'PLACEHOLDER_LONG_INPUT'
          ? 'A'.repeat(10000)
          : turn.query;

      const res = await fetch(`${baseUrl}/api/v1/agent/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${jwt}`
        },
        body: JSON.stringify({ message, session_id: sessionId })
      });

      if (!res.ok) {
        casePassed = false;
        break;
      }

      const body = (await res.json()) as {
        response: string;
        tool_calls: Array<{ name: string }>;
      };
      const actualTools = body.tool_calls.map((tc) => tc.name);
      const lower = body.response.toLowerCase();

      // Tool check
      if (turn.expectedTools.length > 0) {
        if (!turn.expectedTools.every((t) => actualTools.includes(t))) {
          casePassed = false;
        }
      }

      // Content check
      if (turn.mustContain.length > 0) {
        if (!turn.mustContain.every((s) => lower.includes(s.toLowerCase()))) {
          casePassed = false;
        }
      }

      // Negative check
      if (turn.mustNotContain.length > 0) {
        if (turn.mustNotContain.some((s) => lower.includes(s.toLowerCase()))) {
          casePassed = false;
        }
      }
    }

    if (casePassed) passed++;
    console.log(` ${casePassed ? 'PASS' : 'FAIL'}`);
  }

  return {
    passed,
    failed: multiTurnCases.length - passed,
    total: multiTurnCases.length
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('=== Ghostfolio Agent Eval Suite (LangSmith Tier 2) ===\n');

  // Validate env vars
  const baseUrl = process.env.EVAL_BASE_URL || 'http://localhost:3333';
  const accessToken = process.env.EVAL_ACCESS_TOKEN;
  const langsmithKey = process.env.LANGSMITH_API_KEY;

  if (!accessToken) {
    console.error('ERROR: EVAL_ACCESS_TOKEN not set');
    process.exit(1);
  }
  if (!langsmithKey) {
    console.error('ERROR: LANGSMITH_API_KEY not set');
    process.exit(1);
  }

  // Set LangSmith project and workspace so all runs/experiments land correctly
  process.env.LANGSMITH_PROJECT = LANGSMITH_PROJECT;
  // Org-scoped service keys require workspace ID (X-Tenant-ID header)
  if (!process.env.LANGSMITH_WORKSPACE_ID) {
    process.env.LANGSMITH_WORKSPACE_ID = '4610debb-3062-47a4-a18d-faee6ddaa4c3';
  }

  console.log(`Target: ${baseUrl}`);
  console.log(`LangSmith project: ${LANGSMITH_PROJECT}`);
  console.log(`LangSmith key: ${langsmithKey.substring(0, 10)}...`);

  // Authenticate
  clearAuthCache();
  console.log('\nAuthenticating...');
  const jwt = await authenticate(baseUrl, accessToken);
  console.log('Authenticated successfully.\n');

  // Seed dataset
  const client = new Client();
  await seedDataset(client);

  // Create traceable target
  const target = createTarget(baseUrl, jwt);

  // Run single-turn evals via LangSmith evaluate()
  console.log('Running single-turn evals via LangSmith evaluate()...\n');

  const results = await evaluate(target, {
    data: DATASET_NAME,
    evaluators: [
      toolSelectionEvaluator,
      contentValidationEvaluator,
      negativeValidationEvaluator,
      verificationMetadataEvaluator,
      overallPassEvaluator
    ],
    experimentPrefix: EXPERIMENT_PREFIX,
    maxConcurrency: 2,
    metadata: {
      tier: '2-langsmith',
      runner: 'eval-runner-langsmith.ts'
    }
  });

  // Count single-turn results
  let stPassed = 0;
  let stTotal = 0;
  for (const row of results.results) {
    stTotal++;
    const evalResults = row.evaluationResults?.results || [];
    const overallResult = evalResults.find(
      (r) => r.key === 'overall_pass'
    );
    if (overallResult?.score === 1) {
      stPassed++;
    }
  }

  console.log(`\nSingle-turn: ${stPassed}/${stTotal} passed`);

  // Run multi-turn evals (manual, not via evaluate())
  const mtResults = await runMultiTurnEvals(baseUrl, jwt);
  console.log(`Multi-turn: ${mtResults.passed}/${mtResults.total} passed`);

  // Overall summary
  const totalPassed = stPassed + mtResults.passed;
  const totalCases = stTotal + mtResults.total;
  const passRate = totalCases > 0
    ? Math.round((totalPassed / totalCases) * 10000) / 100
    : 0;

  console.log(`\n=== Overall: ${totalPassed}/${totalCases} (${passRate}%) ===`);
  console.log(`Experiment: ${results.experimentName}`);
  console.log(`Dashboard: https://smith.langchain.com/\n`);

  if (passRate >= 80) {
    console.log('PASS: Eval suite meets >=80% pass rate gate.');
    process.exit(0);
  } else {
    console.error(`FAIL: Pass rate ${passRate}% < 80% gate`);
    process.exit(1);
  }
}

// Only run when executed directly
if (require.main === module) {
  main().catch((err) => {
    console.error('Eval runner failed:', err);
    process.exit(1);
  });
}
