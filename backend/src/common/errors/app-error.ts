import { HttpStatus } from '@nestjs/common';

/** Códigos de erro estáveis do contrato da API. O frontend deve decidir pelo `code`, nunca pela `message`. */
export const ErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  INVALID_REFRESH_TOKEN: 'INVALID_REFRESH_TOKEN',
  EMAIL_ALREADY_REGISTERED: 'EMAIL_ALREADY_REGISTERED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  TRIP_NOT_FOUND: 'TRIP_NOT_FOUND',
  DAY_NOT_FOUND: 'DAY_NOT_FOUND',
  ACTIVITY_NOT_FOUND: 'ACTIVITY_NOT_FOUND',
  RATE_LIMITED: 'RATE_LIMITED',
  CONFLICT: 'CONFLICT',
  VERSION_CONFLICT: 'VERSION_CONFLICT',
  INVALID_REORDER: 'INVALID_REORDER',
  INVALID_TIME_ZONE: 'INVALID_TIME_ZONE',
  INVALID_DATE_RANGE: 'INVALID_DATE_RANGE',
  TRIP_TOO_LONG: 'TRIP_TOO_LONG',
  TRIP_DATE_CHANGE_CONFLICT: 'TRIP_DATE_CHANGE_CONFLICT',
  TRIP_HAS_PENDING_PAYMENT: 'TRIP_HAS_PENDING_PAYMENT',
  DAILY_ACTIVITY_LIMIT_REACHED: 'DAILY_ACTIVITY_LIMIT_REACHED',
  TRIP_UPGRADE_REQUIRED: 'TRIP_UPGRADE_REQUIRED',
  ALREADY_MEMBER: 'ALREADY_MEMBER',
  CANNOT_MODIFY_OWNER: 'CANNOT_MODIFY_OWNER',
  INVITATION_INVALID: 'INVITATION_INVALID',
  INVITATION_EMAIL_MISMATCH: 'INVITATION_EMAIL_MISMATCH',
  EMAIL_DELIVERY_UNAVAILABLE: 'EMAIL_DELIVERY_UNAVAILABLE',
  INVITATION_RESEND_LIMITED: 'INVITATION_RESEND_LIMITED',
  INVITATION_DELIVERY_IN_PROGRESS: 'INVITATION_DELIVERY_IN_PROGRESS',
  INVITATION_NOT_RESENDABLE: 'INVITATION_NOT_RESENDABLE',
  SHARE_LINK_NOT_FOUND: 'SHARE_LINK_NOT_FOUND',
  PLAN_ALREADY_ACTIVE: 'PLAN_ALREADY_ACTIVE',
  PLAN_NOT_ELIGIBLE: 'PLAN_NOT_ELIGIBLE',
  PAYMENT_PENDING: 'PAYMENT_PENDING',
  BILLING_UNAVAILABLE: 'BILLING_UNAVAILABLE',
  BILLING_MISCONFIGURED: 'BILLING_MISCONFIGURED',
  PAYMENT_PROVIDER_ERROR: 'PAYMENT_PROVIDER_ERROR',
  ORDER_NOT_FOUND: 'ORDER_NOT_FOUND',
  WEBHOOK_SIGNATURE_INVALID: 'WEBHOOK_SIGNATURE_INVALID',
  AI_UNAVAILABLE: 'AI_UNAVAILABLE',
  AI_USAGE_LIMIT_REACHED: 'AI_USAGE_LIMIT_REACHED',
  AI_BUDGET_EXHAUSTED: 'AI_BUDGET_EXHAUSTED',
  AI_REQUEST_TOO_LARGE: 'AI_REQUEST_TOO_LARGE',
  AI_TOO_MANY_DAYS: 'AI_TOO_MANY_DAYS',
  AI_JOB_IN_PROGRESS: 'AI_JOB_IN_PROGRESS',
  AI_JOB_NOT_FOUND: 'AI_JOB_NOT_FOUND',
  LOCATION_SEARCH_UNAVAILABLE: 'LOCATION_SEARCH_UNAVAILABLE',
  LOCATION_PROVIDER_ERROR: 'LOCATION_PROVIDER_ERROR',
  IDEMPOTENCY_KEY_REUSED: 'IDEMPOTENCY_KEY_REUSED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export class AppError extends Error {
  constructor(
    readonly status: HttpStatus,
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }

  static badRequest(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    return new AppError(HttpStatus.BAD_REQUEST, code, message, details);
  }
  static unauthorized(code: ErrorCode, message: string) {
    return new AppError(HttpStatus.UNAUTHORIZED, code, message);
  }
  static forbidden(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    return new AppError(HttpStatus.FORBIDDEN, code, message, details);
  }
  static notFound(code: ErrorCode, message: string) {
    return new AppError(HttpStatus.NOT_FOUND, code, message);
  }
  static conflict(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    return new AppError(HttpStatus.CONFLICT, code, message, details);
  }
  static unprocessable(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    return new AppError(HttpStatus.UNPROCESSABLE_ENTITY, code, message, details);
  }
  static badGateway(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    return new AppError(HttpStatus.BAD_GATEWAY, code, message, details);
  }
  static tooManyRequests(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    return new AppError(HttpStatus.TOO_MANY_REQUESTS, code, message, details);
  }
  static unavailable(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    return new AppError(HttpStatus.SERVICE_UNAVAILABLE, code, message, details);
  }
}
