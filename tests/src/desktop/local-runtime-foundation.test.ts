// @vitest-environment node
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDesktopAppApi, createLocalDesktopRuntime } from '../../../src/desktop';
import type { AgentRuntimeEvent } from '../../../src/app';
import type { AgentAiClient } from '../../../src/agent';
import { AssistantMessageEventStream } from '../../../src/ai';
import type { DesktopHostAdapters } from '../../../src/desktop/composition/create-host-adapters';

const createdRoots: string[] = [];

afterEach(async () => {
  await Promise.all(createdRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function createTempRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'megumi-desktop-runtime-'));
  createdRoots.push(root);
  return root;
}

function createFakeHosts(root: string): DesktopHostAdapters {
  return {
    clipboardHost: {
      readText: () => '',
      writeText: () => undefined,
    },
    dialogHost: {
      openProjectDirectory: async () => root,
    },
    environmentHost: {
      get: () => undefined,
    },
    fileHost: {
      readFile: (filePath) => fs.readFile(filePath),
      writeFile: (filePath, data) => fs.writeFile(filePath, data),
    },
    megumiHomeHost: {
      getMegumiHome: () => path.join(root, '.megumi'),
    },
    processHost: {
      spawn,
    },
    secureStorageHost: {
      encrypt: (value) => Buffer.from(value, 'utf8'),
      decrypt: (value) => value.toString('utf8'),
      isAvailable: () => true,
    },
    shellHost: {
      openPath: async () => undefined,
    },
  };
}

function createFakeAi(): AgentAiClient {
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

function createId(prefix: string, value: string): string {
  return `${prefix}-${value.replace(/[^A-Za-z0-9:_-]/g, '_')}`;
}

describe('local desktop runtime foundation', () => {
  it('creates an AppApi from an injected AgentRuntimePort without creating app-owned runtime dependencies', async () => {
    const calls: unknown[] = [];
    const appApi = createDesktopAppApi({
      agentRuntime: {
        async startRun(request) {
          calls.push(request);
          return {
            runId: 'run-1',
            sessionId: request.sessionId,
            workspaceId: request.workspaceId,
            status: 'running',
          };
        },
        async resumeRun(request) {
          return { runId: request.runId, status: 'running' };
        },
        async cancelRun(request) {
          return { runId: request.runId, status: 'cancelled' };
        },
        async retryRun(request) {
          return { runId: request.runId, status: 'queued' };
        },
        subscribe() {
          return () => undefined;
        },
      },
    });

    const response = await appApi.startRun({
      rawInput: { text: 'hello' },
      sessionId: 'session-1',
      workspaceId: 'workspace-1',
    }, {
      clientKind: 'test',
      requestId: 'request-1',
      createdAt: '2026-06-19T00:00:00.000Z',
      capabilities: { streaming: true },
    });

    expect(response).toEqual({
      runId: 'run-1',
      sessionId: 'session-1',
      workspaceId: 'workspace-1',
      status: 'running',
    });
    expect(calls).toEqual([
      {
        rawInput: { text: 'hello' },
        sessionId: 'session-1',
        workspaceId: 'workspace-1',
        client: {
          clientKind: 'test',
          requestId: 'request-1',
          createdAt: '2026-06-19T00:00:00.000Z',
          capabilities: { streaming: true },
        },
      },
    ]);
  });

  it('wires current Agent Core behind AgentRuntimePort.startRun with injectable test hosts', async () => {
    const root = await createTempRoot();
    const runtime = createLocalDesktopRuntime({
      hosts: createFakeHosts(root),
      databasePath: ':memory:',
      workspaceRoot: root,
      ai: createFakeAi(),
      now: () => '2026-06-19T00:00:00.000Z',
      createId,
      systemInstruction: 'You are Megumi in a local runtime test.',
    });
    const events: AgentRuntimeEvent[] = [];
    const unsubscribe = runtime.agentRuntime.subscribe((event) => events.push(event));

    const response = await runtime.agentRuntime.startRun({
      rawInput: {
        id: 'raw-1',
        text: 'hello',
        source: { kind: 'desktop' },
        createdAt: '2026-06-19T00:00:00.000Z',
      },
      sessionId: 'session-1',
      workspaceId: 'workspace-local',
      permissionMode: 'default',
      client: {
        clientKind: 'test',
        requestId: 'request-1',
        createdAt: '2026-06-19T00:00:00.000Z',
        capabilities: { streaming: true, approval: true },
      },
    });
    unsubscribe();

    expect(response.status).toBe('completed');
    expect(response.sessionId).toBe('session-1');
    expect(response.workspaceId).toBe('workspace-local');
    expect(events.map((event) => event.type)).toEqual(expect.arrayContaining([
      'run.started',
      'turn.started',
      'context.ready',
      'ai.message.event',
      'ai.message.completed',
      'run.status.changed',
    ]));
    expect(runtime.sessionRepository.getSession('session-1')).toMatchObject({
      id: 'session-1',
      status: 'active',
      workspaceId: 'workspace-local',
    });
    await runtime.stop();
  });

  it('persists renderer workspace path on sessions created by startRun', async () => {
    const root = await createTempRoot();
    const runtime = createLocalDesktopRuntime({
      hosts: createFakeHosts(root),
      databasePath: ':memory:',
      workspaceRoot: root,
      ai: createFakeAi(),
      now: () => '2026-06-19T00:00:00.000Z',
      createId,
    });

    await runtime.agentRuntime.startRun({
      rawInput: {
        id: 'raw-workspace-path-1',
        text: 'hello',
        source: { kind: 'desktop' },
        metadata: { workspacePath: 'C:/Users/anwen/Desktop/test' },
        createdAt: '2026-06-19T00:00:00.000Z',
      },
      sessionId: 'session-workspace-path-1',
      workspaceId: 'workspace-test',
      client: {
        clientKind: 'test',
        requestId: 'request-workspace-path-1',
        createdAt: '2026-06-19T00:00:00.000Z',
        capabilities: { streaming: true },
      },
    });

    expect(runtime.sessionRepository.getSession('session-workspace-path-1')).toMatchObject({
      id: 'session-workspace-path-1',
      workspaceId: 'workspace-test',
      workspacePath: 'C:/Users/anwen/Desktop/test',
    });
    await runtime.stop();
  });

  it('uses the requested provider and model for the Agent Run model call', async () => {
    const root = await createTempRoot();
    const seenModels: Array<{ providerId: string; modelId: string }> = [];
    const runtime = createLocalDesktopRuntime({
      hosts: createFakeHosts(root),
      databasePath: ':memory:',
      workspaceRoot: root,
      ai: {
        stream(model) {
          seenModels.push(model);
          return AssistantMessageEventStream.from([
            { type: 'message_start', messageId: 'assistant-1', role: 'assistant' },
            { type: 'content_block_start', index: 0, block: { type: 'text', text: '' } },
            { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'pong' } },
            { type: 'content_block_end', index: 0, block: { type: 'text', text: 'pong' } },
            { type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'pong' }], stopReason: 'stop' } },
          ]);
        },
      },
      now: () => '2026-06-19T00:00:00.000Z',
      createId,
    });

    await runtime.agentRuntime.startRun({
      rawInput: {
        id: 'raw-model-1',
        text: 'hello',
        source: { kind: 'desktop' },
        createdAt: '2026-06-19T00:00:00.000Z',
      },
      sessionId: 'session-model-1',
      providerId: 'openai',
      modelId: 'gpt-5.4-mini',
      client: {
        clientKind: 'test',
        requestId: 'request-model-1',
        createdAt: '2026-06-19T00:00:00.000Z',
        capabilities: { streaming: true },
      },
    });

    expect(seenModels).toEqual([{ providerId: 'openai', modelId: 'gpt-5.4-mini' }]);
    await runtime.stop();
  });
});
