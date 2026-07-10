import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  createProductRuntimeLogger,
  PRODUCT_RUNTIME_LOG_FILE_NAME,
} from '@megumi/product/logging';

describe('createProductRuntimeLogger', () => {
  it('owns the JSONL envelope, product path, clock, redaction, and truncation', () => {
    const appendText = vi.fn();
    const logger = createProductRuntimeLogger({
      logsPath: 'C:/home/logs',
      writer: { appendText },
      clock: { now: () => new Date('2026-07-10T08:00:00.000Z') },
      maxStringLength: 8,
    });

    logger.info?.('runtime_started', {
      authorization: 'Bearer TEST_RUNTIME_SECRET',
      message: '1234567890',
    });

    expect(appendText).toHaveBeenCalledWith(
      path.join('C:/home/logs', PRODUCT_RUNTIME_LOG_FILE_NAME),
      expect.stringMatching(/\n$/),
    );
    const record = JSON.parse(appendText.mock.calls[0][1]) as Record<string, unknown>;
    expect(record).toMatchObject({
      timestamp: '2026-07-10T08:00:00.000Z',
      level: 'info',
      event: 'runtime_…[truncated]',
      details: {
        authorization: '[redacted]',
        message: '12345678…[truncated]',
      },
    });
  });

  it('degrades without throwing when the host writer fails', () => {
    const onWriteFailure = vi.fn();
    const logger = createProductRuntimeLogger({
      logsPath: 'C:/home/logs',
      writer: { appendText: () => { throw new Error('disk full'); } },
      clock: { now: () => new Date('2026-07-10T08:00:00.000Z') },
      onWriteFailure,
    });

    expect(() => logger.error?.('runtime_failed')).not.toThrow();
    expect(onWriteFailure).toHaveBeenCalledWith(expect.objectContaining({ message: 'disk full' }));
  });
});
