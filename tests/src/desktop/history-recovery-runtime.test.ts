// @vitest-environment node
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDesktopAppApi, createLocalDesktopRuntime } from '../../../src/desktop';
import { handleRunOperation } from '../../../src/desktop/ipc/run.handler';
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

    const result = await handleRunOperation('run.events.list', { runId: response.runId }, {
      appApi,
      hosts: fakeHosts(root),
      runtime,
      getMainWindow: () => undefined,
    });

    expect(result).toEqual({
      events: expect.arrayContaining([
        expect.objectContaining({ type: 'run.started', runId: response.runId, sequence: 1 }),
        expect.objectContaining({ type: 'run.status.changed', runId: response.runId }),
      ]),
    });
    await runtime.stop();
  });
});
