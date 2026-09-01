/* Verifies startup rollback and shutdown attempt every registered resource. */
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createApplicationResourceManager } from '../../../packages/agent/composition/src/application-resource-manager';

describe('Application resource recovery', () => {
  it('rolls back registered resources in reverse-safe order', () => {
    const unsubscribe = vi.fn();
    const close = vi.fn();
    const resources = createApplicationResourceManager({ shutdownTimeoutMs: 10 });
    resources.registerDatabase({ close });
    resources.registerEventSubscription({ unsubscribe });
    resources.rollbackStartup();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it('continues shutdown and reports aggregated failures', async () => {
    const resources = createApplicationResourceManager({ shutdownTimeoutMs: 10 });
    const close = vi.fn();
    const unsubscribe = vi.fn();
    resources.registerDatabase({ close });
    resources.registerEventSubscription({ unsubscribe });
    await expect(resources.dispose({
      discovery: { shutdown: async () => { throw new Error('discovery'); } },
      executions: { shutdown: async () => ({ status: 'completed', interruptedExecutionIds: [] }) },
      conversation: { shutdown: async () => undefined },
      voice: { dispose: async () => undefined },
      speechOutput: { dispose() {} },
      observability: { shutdown: async () => undefined },
    })).rejects.toBeInstanceOf(AggregateError);
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });
});
