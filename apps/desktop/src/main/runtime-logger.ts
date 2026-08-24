/* Minimal logging contract used by Desktop IPC and process-error projections. */
export interface DesktopRuntimeLogger {
  info?(event: string, details?: Record<string, unknown>): void;
  warn(event: string, details?: Record<string, unknown>): void;
  error?(event: string, details?: Record<string, unknown>): void;
}
