/*
 * Defines the minimal product-agnostic logger accepted by Agent
 * composition. Product runtimes provide the concrete logging implementation.
 */
export interface RuntimeLogger {
  info?(event: string, details?: Record<string, unknown>): void;
  warn(event: string, details?: Record<string, unknown>): void;
  error?(event: string, details?: Record<string, unknown>): void;
}
