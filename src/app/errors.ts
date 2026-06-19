// Defines App API errors without exposing provider secrets or host internals.
export class AppApiError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'AppApiError';
    this.code = code;
    this.details = details;
  }
}
