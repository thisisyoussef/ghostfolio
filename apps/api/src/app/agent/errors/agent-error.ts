export enum ErrorType {
  DATA = 'data',
  TOOL = 'tool',
  MODEL = 'model',
  SERVICE = 'service'
}

const MAX_USER_MESSAGE_LENGTH = 500;

export class AgentError extends Error {
  public readonly type: ErrorType;
  public readonly userMessage: string;
  public readonly recoverable: boolean;
  public readonly cause?: Error;

  constructor(
    type: ErrorType,
    userMessage: string,
    recoverable: boolean,
    cause?: Error
  ) {
    super(userMessage);
    this.name = 'AgentError';
    this.type = type;
    this.userMessage = userMessage;
    this.recoverable = recoverable;
    this.cause = cause;
  }

  static fromUnknown(err: unknown): AgentError {
    if (err instanceof AgentError) {
      return err;
    }
    const message =
      err instanceof Error ? err.message : 'An unexpected error occurred.';
    return new AgentError(
      ErrorType.SERVICE,
      message || 'An unexpected error occurred.',
      false,
      err instanceof Error ? err : undefined
    );
  }

  toJSON(): { type: string; message: string; recoverable: boolean } {
    let msg = this.userMessage;
    if (msg.length > MAX_USER_MESSAGE_LENGTH) {
      msg = msg.slice(0, MAX_USER_MESSAGE_LENGTH) + '...';
    }
    return {
      type: this.type,
      message: msg,
      recoverable: this.recoverable
    };
  }
}
