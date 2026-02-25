import { ensureLangSmithEnv, isTracingEnabled } from './langsmith.config';

describe('langsmith.config', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.LANGSMITH_TRACING;
    delete process.env.LANGCHAIN_TRACING_V2;
    delete process.env.LANGSMITH_API_KEY;
    delete process.env.LANGSMITH_PROJECT;
    delete process.env.LANGSMITH_WORKSPACE_ID;
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('should keep LANGSMITH_TRACING and LANGCHAIN_TRACING_V2 in sync', () => {
    process.env.LANGCHAIN_TRACING_V2 = 'true';

    ensureLangSmithEnv();

    expect(process.env.LANGSMITH_TRACING).toBe('true');
    expect(process.env.LANGCHAIN_TRACING_V2).toBe('true');
    expect(process.env.LANGSMITH_PROJECT).toBe('ghostfolio-agent');
    expect(process.env.LANGSMITH_WORKSPACE_ID).toBeDefined();
  });

  it('should report tracing disabled without LangSmith API key', () => {
    process.env.LANGSMITH_TRACING = 'true';

    ensureLangSmithEnv();

    expect(isTracingEnabled()).toBe(false);
  });

  it('should enable tracing when either toggle is true and API key exists', () => {
    process.env.LANGCHAIN_TRACING_V2 = 'true';
    process.env.LANGSMITH_API_KEY = 'lsv2_sk_test';

    ensureLangSmithEnv();

    expect(isTracingEnabled()).toBe(true);
    expect(process.env.LANGSMITH_TRACING).toBe('true');
  });
});
