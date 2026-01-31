/**
 * HTTP Status Codes used throughout the application.
 */
export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
} as const;

export type HttpStatus = (typeof HTTP_STATUS)[keyof typeof HTTP_STATUS];

/**
 * Account mode values matching database enum.
 */
export const ACCOUNT_MODE = {
  DIRECT: 'direct',
  RELAY: 'relay',
} as const;

export type AccountMode = (typeof ACCOUNT_MODE)[keyof typeof ACCOUNT_MODE];

/**
 * Inbound message status values matching database enum.
 */
export const INBOUND_MESSAGE_STATUS = {
  QUEUED: 'queued',
  DELIVERED: 'delivered',
  EXPIRED: 'expired',
} as const;

export type InboundMessageStatus =
  (typeof INBOUND_MESSAGE_STATUS)[keyof typeof INBOUND_MESSAGE_STATUS];

/**
 * Outbound message status values matching database enum.
 */
export const OUTBOUND_MESSAGE_STATUS = {
  PENDING: 'pending',
  SENT: 'sent',
  FAILED: 'failed',
} as const;

export type OutboundMessageStatus =
  (typeof OUTBOUND_MESSAGE_STATUS)[keyof typeof OUTBOUND_MESSAGE_STATUS];

/**
 * Kakao API response version.
 */
export const KAKAO_API_VERSION = '2.0' as const;
