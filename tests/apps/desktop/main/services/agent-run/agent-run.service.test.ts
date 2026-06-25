// @vitest-environment node
// Verifies the desktop agent-run facade delegates each run method to the product
// runtime's SessionRunService, so the run IPC handler depends on the facade.
import { describe, expect, it, vi } from 'vitest';
import { createDesktopAgentRunService } from '@megumi/desktop/main/services/agent-run/agent-run.service';

function stubSessionRunService() {
  return {
    listRunsBySession: vi.fn(() => [{ runId: 'run-1' }]),
    listRuntimeEventsByRun: vi.fn(() => [{ eventId: 'event-1' }]),
  };
}

describe('desktop agent-run facade', () => {
  it('delegates listRunsBySession to the runtime', () => {
    const runtime = stubSessionRunService();
    const service = createDesktopAgentRunService(runtime as never);
    expect(service.listRunsBySession('session-1')).toEqual([{ runId: 'run-1' }]);
    expect(runtime.listRunsBySession).toHaveBeenCalledWith('session-1');
  });

  it('delegates listRuntimeEventsByRun to the runtime', () => {
    const runtime = stubSessionRunService();
    const service = createDesktopAgentRunService(runtime as never);
    expect(service.listRuntimeEventsByRun('run-1')).toEqual([{ eventId: 'event-1' }]);
    expect(runtime.listRuntimeEventsByRun).toHaveBeenCalledWith('run-1');
  });
});
