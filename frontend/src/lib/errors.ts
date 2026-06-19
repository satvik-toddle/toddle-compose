// Normalized API error. NestJS returns { statusCode, message, error } where
// `message` may be a string or an array of validation strings.
export class ApiError extends Error {
  readonly statusCode: number;
  readonly error?: string;
  readonly body: unknown;

  constructor(statusCode: number, message: string, error?: string, body?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.error = error;
    this.body = body;
  }
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}

export const isUnauthorized = (e: unknown) => isApiError(e) && e.statusCode === 401;
export const isForbidden = (e: unknown) => isApiError(e) && e.statusCode === 403;
export const isNotFound = (e: unknown) => isApiError(e) && e.statusCode === 404;
export const isConflict = (e: unknown) => isApiError(e) && e.statusCode === 409;

// A workspace-scoped read that 403/404s means the caller lost access to it
// (removed/demoted mid-session, or the workspace vanished).
export const isAccessLost = (e: unknown) =>
  isApiError(e) && (e.statusCode === 403 || e.statusCode === 404);

export function messageOf(e: unknown, fallback = 'Something went wrong'): string {
  if (isApiError(e)) return e.message || fallback;
  if (e instanceof Error) return e.message || fallback;
  return fallback;
}
