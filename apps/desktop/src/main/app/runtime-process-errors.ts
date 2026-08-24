/* Registers process-level failures against the Product runtime logger. */
import { redactHostRuntimeValue } from '@megumi/product/host';
import { normalizeRuntimeIpcError } from '../ipc/errors';
import type { DesktopRuntimeLogger as ProductRuntimeLogger } from '../runtime-logger';

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
}

export function registerRuntimeProcessErrorHandlers(
  options: RegisterRuntimeProcessErrorHandlersOptions = {},
): void {
  const processLike = options.process ?? process;
  const logger = options.logger ?? noopRuntimeLogger;

  processLike.on('uncaughtException', (error) => {
    logger.error?.('runtime_process_uncaught_exception', createDetails(error));
  });
  processLike.on('unhandledRejection', (error) => {
    logger.error?.('runtime_process_unhandled_rejection', createDetails(error));
  });
}

function createDetails(error: unknown): Record<string, unknown> {
  return redactHostRuntimeValue({
    error: normalizeRuntimeIpcError(error, 'Megumi runtime encountered an unexpected error.'),
  }) as Record<string, unknown>;
}
