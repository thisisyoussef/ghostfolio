/**
 * HTTP target for LangSmith eval runner (Tier 2).
 *
 * Exports a plain async function — LangSmith's `evaluate()` wraps it
 * with `traceable()` internally, avoiding CJS/ESM mismatch issues.
 */
import { AgentChatResponse } from './types';

// ── Authentication ───────────────────────────────────────────────────────────

interface AuthResponse {
  authToken: string;
}

let cachedJwt: string | null = null;

export async function authenticate(
  baseUrl: string,
  accessToken: string
): Promise<string> {
  if (cachedJwt) return cachedJwt;

  const res = await fetch(`${baseUrl}/api/v1/auth/anonymous/${accessToken}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Authentication failed (${res.status}): ${text}`);
  }
  const body = (await res.json()) as AuthResponse;
  cachedJwt = body.authToken;
  return cachedJwt;
}

export function clearAuthCache(): void {
  cachedJwt = null;
}

// ── Traceable target function ────────────────────────────────────────────────

const LONG_INPUT_PLACEHOLDER = 'PLACEHOLDER_LONG_INPUT';
const LONG_INPUT_REPLACEMENT = 'A'.repeat(10000);

function resolveMessage(message: string): string {
  if (message === LONG_INPUT_PLACEHOLDER) {
    return LONG_INPUT_REPLACEMENT;
  }
  return message;
}

/**
 * The target function passed to LangSmith `evaluate()`.
 * Returns a plain async function — `evaluate()` wraps it with
 * `traceable()` internally for per-case tracing in the dashboard.
 *
 * Input shape: { message: string, session_id: string }
 * Output shape: { response: string, tool_calls: [...] }
 */
export function createTarget(baseUrl: string, jwt: string) {
  return async (inputs: {
    message: string;
    session_id: string;
  }): Promise<{
    response: string;
    tool_calls: Array<{
      name: string;
      args: Record<string, unknown>;
      result: string;
    }>;
  }> => {
    const message = resolveMessage(inputs.message);

    const res = await fetch(`${baseUrl}/api/v1/agent/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwt}`
      },
      body: JSON.stringify({
        message,
        session_id: inputs.session_id
      })
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Chat API error: HTTP ${res.status} ${text}`);
    }

    const body = (await res.json()) as AgentChatResponse;
    return {
      response: body.response,
      tool_calls: body.tool_calls
    };
  };
}
