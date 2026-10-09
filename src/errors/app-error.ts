export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'AUTH_REQUIRED'
  | 'AUTH_EXPIRED_OR_REVOKED'
  | 'INSUFFICIENT_SCOPE'
  | 'RESOURCE_NOT_FOUND'
  | 'PERMISSION_DENIED'
  | 'RATE_LIMITED'
  | 'GOOGLE_API_ERROR'
  | 'NETWORK_ERROR'
  | 'OUTCOME_UNKNOWN'
  | 'INTERNAL_ERROR';

/** Whether the write definitely did not happen, definitely happened, or may have happened. */
export type Outcome = 'not_performed' | 'performed' | 'unknown';

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly outcome: Outcome;
  readonly hint?: string;

  constructor(code: ErrorCode, message: string, opts: { outcome?: Outcome; hint?: string; cause?: unknown } = {}) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = 'AppError';
    this.code = code;
    this.outcome = opts.outcome ?? 'not_performed';
    this.hint = opts.hint;
  }
}

export const validationError = (message: string): AppError => new AppError('VALIDATION_ERROR', message);
