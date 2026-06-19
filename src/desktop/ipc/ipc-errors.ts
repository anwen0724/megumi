// Defines desktop IPC errors used by bridge handlers.
export class DesktopIpcError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'DesktopIpcError';
    this.code = code;
    this.details = details;
  }
}

export function unavailable(operation: string, reason: string): DesktopIpcError {
  return new DesktopIpcError(
    'desktop_capability_unavailable',
    `${operation} is unavailable in the current src desktop runtime: ${reason}`,
    { operation, reason },
  );
}
