import { AgentError, ErrorType } from './agent-error';

describe('AgentError', () => {
  // Happy path (3)
  it('should create AgentError with ErrorType.TOOL', () => {
    const err = new AgentError(ErrorType.TOOL, 'Tool failed', true);
    expect(err.type).toBe(ErrorType.TOOL);
    expect(err.userMessage).toBe('Tool failed');
    expect(err.recoverable).toBe(true);
    expect(err).toBeInstanceOf(Error);
  });

  it('should create AgentError with ErrorType.DATA', () => {
    const err = new AgentError(ErrorType.DATA, 'Bad data from Yahoo', false);
    expect(err.type).toBe(ErrorType.DATA);
    expect(err.recoverable).toBe(false);
  });

  it('should create AgentError with ErrorType.MODEL', () => {
    const err = new AgentError(ErrorType.MODEL, 'LLM timeout', true);
    expect(err.type).toBe(ErrorType.MODEL);
  });

  // Edge cases (3)
  it('should classify unknown error as ErrorType.SERVICE via fromUnknown', () => {
    const err = AgentError.fromUnknown(new Error('random'));
    expect(err.type).toBe(ErrorType.SERVICE);
    expect(err.recoverable).toBe(false);
  });

  it('should preserve original error in cause property', () => {
    const original = new Error('root cause');
    const err = new AgentError(ErrorType.TOOL, 'Wrapper', true, original);
    expect(err.cause).toBe(original);
  });

  it('should serialize to JSON with type, userMessage, recoverable', () => {
    const err = new AgentError(ErrorType.DATA, 'Serialize me', false);
    const json = err.toJSON();
    expect(json).toEqual({
      type: 'data',
      message: 'Serialize me',
      recoverable: false
    });
  });

  // Error/failure modes (2)
  it('should handle null message gracefully via fromUnknown', () => {
    const err = AgentError.fromUnknown(null);
    expect(err.userMessage).toBe('An unexpected error occurred.');
    expect(err.type).toBe(ErrorType.SERVICE);
  });

  it('should handle nested AgentError (pass through, not double-wrap)', () => {
    const inner = new AgentError(ErrorType.DATA, 'Inner', true);
    const outer = AgentError.fromUnknown(inner);
    expect(outer).toBe(inner); // same reference, not wrapped
  });

  // Boundary conditions (2)
  it('should truncate userMessage over 500 chars in toJSON', () => {
    const longMsg = 'x'.repeat(1000);
    const err = new AgentError(ErrorType.TOOL, longMsg, true);
    const json = err.toJSON();
    expect(json.message.length).toBeLessThanOrEqual(503); // 500 + '...'
  });

  it('should handle special characters in message without injection', () => {
    const msg = '<script>alert("xss")</script> \'; DROP TABLE users;--';
    const err = new AgentError(ErrorType.TOOL, msg, true);
    expect(err.userMessage).toBe(msg); // stored as-is, no mutation
    expect(err.toJSON().message).toBe(msg); // under 500, not truncated
  });
});
