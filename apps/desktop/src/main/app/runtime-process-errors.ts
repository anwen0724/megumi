import { normalizeRuntimeError } from '@megumi/agent';
import { createRuntimeDebugId } from '@megumi/shared/runtime';
import { redactRuntimeValue } from '../services/security/redaction';
import {
  noopRuntimeLogger,
  type RuntimeLogger,
} from '../services/runtime/runtime-logger.service';

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



