/* Registers process-level failures against the Product runtime logger. */
import {
  generateRuntimeDebugId,
  normalizeHostRuntimeError,
  redactHostRuntimeValue,
} from '@megumi/product/host';
import type { ProductRuntimeLogger } from '@megumi/product';

const noopRuntimeLogger: ProductRuntimeLogger = {
  warn: () => undefined,
};

type RuntimeProcessEventName = 'uncaughtException' | 'unhandledRejection';

export interface RuntimeProcessLike {
  on(eventName: RuntimeProcessEventName, listener: (error: unknown) => void): unknown;
}

export interface RegisterRuntimeProcessErrorHandlersOptions {
  process?: RuntimeProcessLike;
  logger?: ProductRuntimeLogger;
  debugIdFactory?: () => string;
}

export function registerRuntimeProcessErrorHandlers(
  options: RegisterRuntimeProcessErrorHandlersOptions = {},
): void {
  const processLike = options.process ?? process;
  const logger = options.logger ?? noopRuntimeLogger;
  const debugIdFactory = options.debugIdFactory ?? generateRuntimeDebugId;

  processLike.on('uncaughtException', (error) => {
    logger.error?.('runtime_process_uncaught_exception', createDetails(error, debugIdFactory));
  });
  processLike.on('unhandledRejection', (error) => {
    logger.error?.('runtime_process_unhandled_rejection', createDetails(error, debugIdFactory));
  });
}

function createDetails(error: unknown, debugIdFactory: () => string): Record<string, unknown> {
  return redactHostRuntimeValue({
    error: normalizeHostRuntimeError(error, {
      source: 'main',
      debugId: debugIdFactory(),
      fallbackMessage: 'Megumi runtime encountered an unexpected error.',
    }),
  }) as Record<string, unknown>;
}
