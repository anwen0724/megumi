import { normalizeRuntimeError } from '@megumi/coding-agent/runtime-error';
import { createRuntimeDebugId } from '@megumi/coding-agent/events';
import { redactRuntimeValue } from '@megumi/coding-agent/adapters/local/security/redaction';
import {
  noopRuntimeLogger,
  type RuntimeLogger,
} from '../services/agent-run/runtime-logger.service';

type RuntimeProcessEventName = 'uncaughtException' | 'unhandledRejection';

export interface RuntimeProcessLike {
  on(eventName: RuntimeProcessEventName, listener: (error: unknown) => void): unknown;
}

export interface RegisterRuntimeProcessErrorHandlersOptions {
  process?: RuntimeProcessLike;
  logger?: RuntimeLogger;
  debugIdFactory?: () => string;
}

export function registerRuntimeProcessErrorHandlers(
  options: RegisterRuntimeProcessErrorHandlersOptions = {},
): void {
  const processLike = options.process ?? process;
  const logger = options.logger ?? noopRuntimeLogger;
  const debugIdFactory = options.debugIdFactory ?? createRuntimeDebugId;

  processLike.on('uncaughtException', (error) => {
    logger.error('runtime_process_uncaught_exception', createDetails(error, debugIdFactory));
  });

  processLike.on('unhandledRejection', (error) => {
    logger.error('runtime_process_unhandled_rejection', createDetails(error, debugIdFactory));
  });
}

function createDetails(
  error: unknown,
  debugIdFactory: () => string,
): Record<string, unknown> {
  return redactRuntimeValue({
    error: normalizeRuntimeError(error, {
      source: 'main',
      debugId: debugIdFactory(),
      fallbackMessage: 'Megumi runtime encountered an unexpected error.',
    }),
  }) as Record<string, unknown>;
}
