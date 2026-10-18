export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VERSION_CONFLICT'
  | 'ALREADY_CLAIMED'
  | 'INVALID_TRANSITION'
  | 'SELF_APPROVAL_FORBIDDEN'
  | 'REASON_REQUIRED'
  | 'ITEM_CLOSED'
  | 'ASSIGNEE_NOT_ELIGIBLE'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'SERVICE_UNAVAILABLE'
  | 'INTERNAL_ERROR';

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function validationError(message: string, details?: unknown): AppError {
  return new AppError(400, 'VALIDATION_ERROR', message, details);
}

export function unauthenticated(message = 'Authentication required'): AppError {
  return new AppError(401, 'UNAUTHENTICATED', message);
}

export function forbidden(message = 'Forbidden'): AppError {
  return new AppError(403, 'FORBIDDEN', message);
}

export function notFound(message = 'Not found'): AppError {
  return new AppError(404, 'NOT_FOUND', message);
}

export function versionConflict(current: unknown): AppError {
  return new AppError(409, 'VERSION_CONFLICT', 'Item was changed by someone else', {
    current,
  });
}

export function alreadyClaimed(current: unknown): AppError {
  return new AppError(409, 'ALREADY_CLAIMED', 'Item was already claimed', { current });
}

export function invalidTransition(message: string): AppError {
  return new AppError(422, 'INVALID_TRANSITION', message);
}

export function selfApprovalForbidden(): AppError {
  return new AppError(
    422,
    'SELF_APPROVAL_FORBIDDEN',
    'You cannot approve or reject an item assigned to you',
  );
}

export function reasonRequired(message = 'A reason is required'): AppError {
  return new AppError(422, 'REASON_REQUIRED', message);
}

export function itemClosed(): AppError {
  return new AppError(422, 'ITEM_CLOSED', 'Closed items cannot be changed');
}

export function assigneeNotEligible(): AppError {
  return new AppError(
    422,
    'ASSIGNEE_NOT_ELIGIBLE',
    'Assignee must be a Member or Lead of this team',
  );
}

export function idempotencyKeyReused(): AppError {
  return new AppError(
    422,
    'IDEMPOTENCY_KEY_REUSED',
    'Idempotency-Key was reused with a different request body',
  );
}
