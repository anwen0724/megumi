// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createAppApiAdapter, type AgentRuntimePort, type AppClientContext } from '../../../src/app';

function createClientContext(): AppClientContext {
  return {
    clientKind: 'test',
    requestId: 'request-1',
    createdAt: '2026-06-19T00:00:00.000Z',
    capabilities: {
      streaming: true,
      approval: true,
      filePicker: false,
      workspacePanel: false,
    },
  };
}

function createFakeRuntime(): AgentRuntimePort {
  return {
    async startRun(request) {
      return {
        runId: 'run-1',
        sessionId: request.sessionId,
        workspaceId: request.workspaceId,
        status: 'running',
      };
    },
    async resumeRun(request) {
      return {
        runId: request.runId,
        sessionId: request.sessionId,
        workspaceId: request.workspaceId,
        status: 'running',
      };
    },
    async cancelRun(request) {
      return {
        runId: request.runId,
        sessionId: request.sessionId,
        workspaceId: request.workspaceId,
        status: 'cancelled',
      };
    },
    async retryRun(request) {
      return {
        runId: request.runId,
        sessionId: request.sessionId,
        workspaceId: request.workspaceId,
        status: 'queued',
      };
    },
    subscribe: vi.fn(() => () => undefined),
  };
}

describe('AppApi adapter', () => {
  it('delegates run requests to the injected AgentRuntimePort with client context', async () => {
    const runtime = createFakeRuntime();
    const startRun = vi.spyOn(runtime, 'startRun');
    const appApi = createAppApiAdapter({ agentRuntime: runtime });
    const context = createClientContext();

    const response = await appApi.startRun({
      rawInput: { text: 'hello' },
      sessionId: 'session-1',
      workspaceId: 'workspace-1',
      permissionMode: 'default',
    }, context);

    expect(response).toEqual({
      runId: 'run-1',
      sessionId: 'session-1',
      workspaceId: 'workspace-1',
      status: 'running',
    });
    expect(startRun).toHaveBeenCalledWith({
      rawInput: { text: 'hello' },
      sessionId: 'session-1',
      workspaceId: 'workspace-1',
      permissionMode: 'default',
      client: context,
    });
  });

  it('does not expose or create an event subscription surface', () => {
    const runtime = createFakeRuntime();
    const appApi = createAppApiAdapter({ agentRuntime: runtime });

    expect('subscribe' in appApi).toBe(false);
    expect(runtime.subscribe).not.toHaveBeenCalled();
  });
});
