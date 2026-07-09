// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  registerRuntimeProcessErrorHandlers,
  type RuntimeProcessLike,
} from '@megumi/desktop/main/app/runtime-process-errors';

function createProcessLike(): RuntimeProcessLike & {
  listeners: Map<string, Array<(error: unknown) => void>>;
} {
  const listeners = new Map<string, Array<(error: unknown) => void>>();

  return {
    listeners,
    on(eventName, listener) {
      const current = listeners.get(eventName) ?? [];
      current.push(listener);
      listeners.set(eventName, current);
      return this;
    },
  };
}

function createLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

describe('registerRuntimeProcessErrorHandlers', () => {
  it('logs uncaught exceptions as display-safe runtime errors', () => {
    const processLike = createProcessLike();
    const logger = createLogger();

    registerRuntimeProcessErrorHandlers({
      process: processLike,
      logger,
      debugIdFactory: () => 'debug-process-1',
    });

    processLike.listeners.get('uncaughtException')?.[0]?.(
      new Error('raw process crash with TEST_PROCESS_SECRET'),
    );

    expect(logger.error).toHaveBeenCalledWith(
      'runtime_process_uncaught_exception',
      expect.objectContaining({
        error: expect.objectContaining({
          code: 'runtime_unknown',
          message: 'Megumi runtime encountered an unexpected error.',
          severity: 'error',
          retryable: true,
          source: 'main',
          debugId: 'debug-process-1',
        }),
      }),
    );
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('TEST_PROCESS_SECRET');
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('raw process crash');
  });

  it('logs unhandled rejections without exposing raw rejection values', () => {
    const processLike = createProcessLike();
    const logger = createLogger();

    registerRuntimeProcessErrorHandlers({
      process: processLike,
      logger,
      debugIdFactory: () => 'debug-process-2',
    });

    processLike.listeners.get('unhandledRejection')?.[0]?.('token: secret-token-value');

    expect(logger.error).toHaveBeenCalledWith(
      'runtime_process_unhandled_rejection',
      expect.objectContaining({
        error: expect.objectContaining({
          code: 'runtime_unknown',
          debugId: 'debug-process-2',
          source: 'main',
        }),
      }),
    );
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('secret-token-value');
  });
});
