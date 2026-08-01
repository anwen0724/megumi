/*
 * Adapts product runtime logs to the Observability owner without a second log file.
 */
import type { ObservabilityService } from './service/observability-service';
import { redactRuntimeDetails, redactRuntimeMessage } from './redaction';

export interface RuntimeLogger {
  info?(event: string, details?: Record<string, unknown>): void;
  warn(event: string, details?: Record<string, unknown>): void;
  error?(event: string, details?: Record<string, unknown>): void;
}

export const noopRuntimeLogger: RuntimeLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export function createObservabilityRuntimeLogger(
  observability: ObservabilityService,
): RuntimeLogger {
  const record = (
    level: 'info' | 'warn' | 'error',
    event: string,
    details?: Record<string, unknown>,
  ) => observability.recordLog({
    level,
    event: redactRuntimeMessage(event),
    ...(details ? { attributes: redactRuntimeDetails(details) } : {}),
  });
  return {
    info: (event, details) => record('info', event, details),
    warn: (event, details) => record('warn', event, details),
    error: (event, details) => record('error', event, details),
  };
}
