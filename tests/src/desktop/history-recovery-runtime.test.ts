// @vitest-environment node
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDesktopAppApi, createLocalDesktopRuntime } from '../../../src/desktop';
import { handleRunOperation } from '../../../src/desktop/ipc/handlers/run.handler';
import { IPC_CHANNELS } from '../../../src/shared/renderer-contracts/ipc';
import type { AgentAiClient } from '../../../src/agent';
import { AssistantMessageEventStream } from '../../../src/ai';
import type { DesktopHostAdapters } from '../../../src/desktop/composition/create-host-adapters';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function tempRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'megumi-history-runtime-'));
  roots.push(root);
  return root;
}

function fakeHosts(root: string): DesktopHostAdapters {
  return {
    clipboardHost: { readText: () => '', writeText: () => undefined },
    dialogHost: { openProjectDirectory: async () => root },
    environmentHost: { get: () => undefined },
    fileHost: { readFile: (filePath) => fs.readFile(filePath), writeFile: (filePath, data) => fs.writeFile(filePath, data) },
    megumiHomeHost: { getMegumiHome: () => path.join(root, '.megumi') },
    processHost: { spawn },
    secureStorageHost: { encrypt: (value) => Buffer.from(value), decrypt: (value) => value.toString('utf8'), isAvailable: () => true },
    shellHost: { openPath: async () => undefined },
  };
}

function fakeAi(): AgentAiClient {
  return {
    stream() {
      return AssistantMessageEventStream.from([
        { type: 'message_start', messageId: 'assistant-1', role: 'assistant' },
        { type: 'content_block_start', index: 0, block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'pong' } },
        { type: 'content_block_end', index: 0, block: { type: 'text', text: 'pong' } },
        { type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'pong' }], stopReason: 'stop' } },
      ]);
    },
  };
}

function rendererRequest<TPayload>(channel: string, payload: TPayload) {
  return {
    requestId: `request:${channel}`,
    meta: {
      channel,
      source: 'renderer',
      createdAt: '2026-06-20T00:00:00.000Z',
    },
    context: {
      requestId: `request:${channel}`,
      traceId: `trace:${channel}`,
      operationName: channel,
      source: 'renderer',
      createdAt: '2026-06-20T00:00:00.000Z',
    },
    payload,
  };
}

describe('durable runtime event history', () => {
  it('records runtime events during app execution and serves run.events.list from database', async () => {
    const root = await tempRoot();
    const runtime = createLocalDesktopRuntime({
      hosts: fakeHosts(root),
      databasePath: ':memory:',
      workspaceRoot: root,
      ai: fakeAi(),
      now: () => '2026-06-20T00:00:00.000Z',
      createId: (prefix, value) => `${prefix}-${value}`,
    });
    const appApi = createDesktopAppApi({ agentRuntime: runtime.agentRuntime });

    const response = await appApi.startRun({
      rawInput: { id: 'raw-1', text: 'hello', source: { kind: 'desktop' }, createdAt: '2026-06-20T00:00:00.000Z' },
      sessionId: 'session-1',
      workspaceId: 'workspace-local',
    }, {
      clientKind: 'test',
      requestId: 'request-1',
      createdAt: '2026-06-20T00:00:00.000Z',
      capabilities: { streaming: true },
    });

    const runsResult = await handleRunOperation('run.listBySession', rendererRequest(IPC_CHANNELS.run.listBySession, {
      sessionId: 'session-1',
    }), {
      appApi,
      hosts: fakeHosts(root),
      runtime,
      getMainWindow: () => undefined,
    }) as { runs: Array<{ runId: string; sessionId: string; status: string }> };

    const result = await handleRunOperation('run.events.list', rendererRequest(IPC_CHANNELS.run.events.list, {
      runId: response.runId,
    }), {
      appApi,
      hosts: fakeHosts(root),
      runtime,
      getMainWindow: () => undefined,
    }) as { events: Array<{ eventType: string; runId: string; sessionId?: string; sequence: number; createdAt: string; payload: Record<string, unknown> }> };
    const storedEvents = runtime.runtimeEventRepository.listEventsByRun(response.runId);

    expect(runsResult).toEqual({
      runs: [expect.objectContaining({
        runId: response.runId,
        sessionId: 'session-1',
        status: 'completed',
      })],
    });
    expect(result).toEqual({
      events: expect.arrayContaining([
        expect.objectContaining({
          eventType: 'run.started',
          runId: response.runId,
          sessionId: 'session-1',
          sequence: 1,
          createdAt: expect.any(String),
          payload: expect.objectContaining({ workspaceId: 'workspace-local' }),
        }),
        expect.objectContaining({
          eventType: 'run.completed',
          runId: response.runId,
          sessionId: 'session-1',
          payload: expect.objectContaining({ workspaceId: 'workspace-local' }),
        }),
      ]),
    });
    expect(storedEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'run.started',
        runId: response.runId,
        sessionId: 'session-1',
        workspaceId: 'workspace-local',
      }),
      expect.objectContaining({
        type: 'run.status.changed',
        runId: response.runId,
        sessionId: 'session-1',
        workspaceId: 'workspace-local',
      }),
    ]));
    await runtime.stop();
  });

  it('filters runtime history events that cannot be projected to renderer DTOs', async () => {
    const root = await tempRoot();
    const runtime = createLocalDesktopRuntime({
      hosts: fakeHosts(root),
      databasePath: ':memory:',
      workspaceRoot: root,
      ai: fakeAi(),
      now: () => '2026-06-20T00:00:00.000Z',
      createId: (prefix, value) => `${prefix}-${value}`,
    });
    runtime.runtimeEventRepository.saveEvent({
      type: 'approval.requested',
      runId: 'run-approval-1',
      sessionId: 'session-1',
      workspaceId: 'workspace-local',
      occurredAt: '2026-06-20T00:00:00.000Z',
      payload: { approvalRequestId: 'approval-1', toolCallId: 'tool-call-1' },
    });
    runtime.runtimeEventRepository.saveEvent({
      type: 'context.ready',
      runId: 'run-approval-1',
      sessionId: 'session-1',
      workspaceId: 'workspace-local',
      occurredAt: '2026-06-20T00:00:01.000Z',
      payload: { included: 1 },
    });

    const result = await handleRunOperation('run.events.list', rendererRequest(IPC_CHANNELS.run.events.list, {
      runId: 'run-approval-1',
    }), {
      appApi: createDesktopAppApi({ agentRuntime: runtime.agentRuntime }),
      hosts: fakeHosts(root),
      runtime,
      getMainWindow: () => undefined,
    }) as { events: Array<{ eventType: string }> };

    expect(result.events).toEqual([
      expect.objectContaining({ eventType: 'context.effective.updated' }),
    ]);
    expect(result.events).not.toContain(undefined);
    await runtime.stop();
  });
});
