// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createAppApiAdapter, type AgentRuntimeEvent, type AgentRuntimePort, type AppClientContext } from '../../../src/app';

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

function createFakeRuntime(): AgentRuntimePort & { emit(event: AgentRuntimeEvent): void; unsubscribeCount(): number } {
  const subscribers = new Set<(event: AgentRuntimeEvent) => void>();
  let unsubscribeCalls = 0;

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
    subscribe(callback) {
      subscribers.add(callback);
      return () => {
        unsubscribeCalls += 1;
        subscribers.delete(callback);
      };
    },
    emit(event) {
      for (const subscriber of subscribers) subscriber(event);
    },
    unsubscribeCount() {
      return unsubscribeCalls;
    },
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

  it('maps AgentRuntimeEvent into AppEvent and unsubscribes from runtime when the last subscriber leaves', () => {
    const runtime = createFakeRuntime();
    const appApi = createAppApiAdapter({ agentRuntime: runtime });
    const received: unknown[] = [];

    const unsubscribe = appApi.subscribe((event) => received.push(event));
    runtime.emit({
      type: 'ai.message.completed',
      runId: 'run-1',
      sessionId: 'session-1',
      workspaceId: 'workspace-1',
      occurredAt: '2026-06-19T00:00:01.000Z',
      payload: { contentBlocks: 1 },
    });
    unsubscribe();
    runtime.emit({
      type: 'run.completed',
      runId: 'run-1',
      occurredAt: '2026-06-19T00:00:02.000Z',
      payload: {},
    });

    expect(received).toEqual([
      {
        type: 'ai.message.completed',
        occurredAt: '2026-06-19T00:00:01.000Z',
        source: 'agent',
        payload: {
          runId: 'run-1',
          sessionId: 'session-1',
          workspaceId: 'workspace-1',
          contentBlocks: 1,
        },
      },
    ]);
    expect(runtime.unsubscribeCount()).toBe(1);
  });
});
