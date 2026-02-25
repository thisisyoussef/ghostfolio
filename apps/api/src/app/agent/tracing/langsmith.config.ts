/**
 * LangSmith tracing configuration for the agent service.
 *
 * When LANGSMITH_TRACING=true (or LANGCHAIN_TRACING_V2=true), every agent chat call and tool invocation
 * is traced to the LangSmith project (default: 'ghostfolio-agent').
 *
 * Traces appear in the LangSmith Observability tab, giving visibility into:
 *   - Every user/eval request (inputs, outputs, latency)
 *   - Tool routing decisions
 *   - Individual tool executions as child spans
 *
 * Env vars (set in Railway for production tracing):
 *   LANGSMITH_TRACING=true
 *   LANGCHAIN_TRACING_V2=true
 *   LANGSMITH_API_KEY=lsv2_sk_...
 *   LANGSMITH_PROJECT=ghostfolio-agent
 *   LANGSMITH_WORKSPACE_ID=<workspace-uuid>  (for org-scoped keys)
 */

const LANGSMITH_PROJECT = 'ghostfolio-agent';
const LANGSMITH_WORKSPACE_ID = '4610debb-3062-47a4-a18d-faee6ddaa4c3';

function parseBoolean(value: string | undefined): boolean | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (['1', 'on', 'true', 'yes'].includes(normalized)) {
    return true;
  }

  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return undefined;
}

function resolveTracingToggle(): boolean {
  const langSmithToggle = parseBoolean(process.env.LANGSMITH_TRACING);
  const langChainToggle = parseBoolean(process.env.LANGCHAIN_TRACING_V2);

  if (langSmithToggle === true || langChainToggle === true) {
    return true;
  }

  if (langSmithToggle === false || langChainToggle === false) {
    return false;
  }

  return false;
}

/**
 * Returns true if LangSmith tracing is enabled via env vars.
 */
export function isTracingEnabled(): boolean {
  return resolveTracingToggle() && !!process.env.LANGSMITH_API_KEY;
}

/**
 * Ensures LangSmith env vars are set with defaults.
 * Call once at module init time.
 */
export function ensureLangSmithEnv(): void {
  const tracingEnabled = resolveTracingToggle();

  process.env.LANGSMITH_TRACING = tracingEnabled ? 'true' : 'false';
  process.env.LANGCHAIN_TRACING_V2 = tracingEnabled ? 'true' : 'false';

  if (!process.env.LANGSMITH_PROJECT) {
    process.env.LANGSMITH_PROJECT = LANGSMITH_PROJECT;
  }
  if (!process.env.LANGSMITH_WORKSPACE_ID) {
    process.env.LANGSMITH_WORKSPACE_ID = LANGSMITH_WORKSPACE_ID;
  }
}
