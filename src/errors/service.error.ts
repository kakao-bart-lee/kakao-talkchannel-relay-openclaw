export const ErrorCodes = {
  ACCOUNT_NOT_FOUND: 'ACCOUNT_NOT_FOUND',
  MESSAGE_NOT_FOUND: 'MESSAGE_NOT_FOUND',
  INVALID_TOKEN: 'INVALID_TOKEN',
  CALLBACK_FAILED: 'CALLBACK_FAILED',
  CALLBACK_EXPIRED: 'CALLBACK_EXPIRED',
  MAPPING_NOT_FOUND: 'MAPPING_NOT_FOUND',
  INVALID_STATUS_TRANSITION: 'INVALID_STATUS_TRANSITION',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  INVALID_CODE: 'INVALID_CODE',
  EXPIRED_CODE: 'EXPIRED_CODE',
  ALREADY_PAIRED: 'ALREADY_PAIRED',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export class ServiceError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly statusCode: number = 500,
    public readonly context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ServiceError';
  }
}
