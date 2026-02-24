import { traceable } from 'langsmith/traceable';

import { AgentChatResponse } from './types';

const BASE_URL = process.env.EVAL_BASE_URL || 'https://ghostfolio-production-e8d1.up.railway.app';

let cachedJwt: string | null = null;

/**
 * Exchange the TEST_SECURITY_TOKEN for a JWT bearer token.
 * Caches the token for the lifetime of the eval run.
 */
async function getJwt(): Promise<string> {
  if (cachedJwt) return cachedJwt;

  const accessToken = process.env.TEST_SECURITY_TOKEN;
  if (!accessToken) {
    throw new Error('TEST_SECURITY_TOKEN not set — required for agent API auth');
  }

  const res = await fetch(`${BASE_URL}/api/v1/auth/anonymous/${accessToken}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Auth failed (${res.status}): ${text}`);
  }

  const body = await res.json();
  cachedJwt = body.authToken;
  return cachedJwt;
}

/**
 * Send a chat message to the production agent API.
 * Wrapped with traceable() so LangSmith records the full HTTP round-trip.
 * Authenticates via JWT obtained from the anonymous auth endpoint.
 */
export const callAgent = traceable(
  async (inputs: { message: string; session_id: string }): Promise<AgentChatResponse> => {
    const url = `${BASE_URL}/api/v1/agent/chat`;
    const jwt = await getJwt();

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${jwt}`
      },
      body: JSON.stringify({
        message: inputs.message,
        session_id: inputs.session_id
      })
    });

    if (!res.ok) {
      const text = await res.text();
      return {
        response: `HTTP ${res.status}: ${text}`,
        tool_calls: [],
        session_id: inputs.session_id
      };
    }

    return (await res.json()) as AgentChatResponse;
  },
  { name: 'ghostfolio-agent-chat', run_type: 'chain' }
);
