// @vitest-environment node
/* Verifies that diagnostics failures never alter product callback semantics. */
import { describe, expect, it, vi } from 'vitest';
import { createTraceRecorder } from '../../../packages/agent/observability/src/trace/trace-recorder';

describe('Observability failure isolation', () => {
  it('returns the original result and executes once when every record write fails', async () => {
    const operation = vi.fn(async () => ({ status: 'accepted' as const }));
    const observability = createTraceRecorder({
      enqueue: () => { throw new Error('journal unavailable'); },
    });

    await expect(observability.withTrace(
      { kind: 'conversation' },
      operation,
    )).resolves.toEqual({ status: 'accepted' });
    expect(operation).toHaveBeenCalledTimes(1);
  });
});
