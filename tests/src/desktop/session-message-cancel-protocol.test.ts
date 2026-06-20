// Locks renderer requestId to Agent run lifecycle mapping for cancellation and terminal reset.
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentRuntimeEvent } from '../../../src/app';
import type { AgentAiClient } from '../../../src/agent';
import { AssistantMessageEventStream } from '../../../src/ai';
import { createLocalDesktopRuntime } from '../../../src/desktop';
import type { DesktopHostAdapters } from '../../../src/desktop/composition/create-host-adapters';

const createdRoots: string[] = [];

afterEach(async () => {
  await Promise.all(createdRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function createTempRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'megumi-cancel-protocol-'));
  createdRoots.push(root);
  return root;
}

function createFakeHosts(root: string): DesktopHostAdapters {
  return {
    clipboardHost: { readText: () => '', writeText: () => undefined },
    dialogHost: { openProjectDirectory: async () => root },
    environmentHost: { get: () => undefined },
    fileHost: {
      readFile: (filePath) => fs.readFile(filePath),
      writeFile: (filePath, data) => fs.writeFile(filePath, data),
    },
    megumiHomeHost: { getMegumiHome: () => path.join(root, '.megumi') },
    processHost: { spawn },
    secureStorageHost: {
      encrypt: (value) => Buffer.from(value, 'utf8'),
      decrypt: (value) => value.toString('utf8'),
      isAvailable: () => true,
    },
    shellHost: { openPath: async () => undefined },
  };
}

function createId(prefix: string, value: string): string {
  return `${prefix}-${value.replace(/[^A-Za-z0-9:_-]/g, '_')}`;
}

function startRequest(requestId: string, text: string) {
  return {
    rawInput: {
      id: `raw-${requestId}`,
      text,
      source: { kind: 'desktop' as const },
      createdAt: '2026-06-20T00:00:00.000Z',
    },
    sessionId: `session-${requestId}`,
    workspaceId: 'workspace-local',
    client: {
      clientKind: 'test' as const,
      requestId,
      createdAt: '2026-06-20T00:00:00.000Z',
      capabilities: { streaming: true },
    },
  };
}

function completedAi(): AgentAiClient {
  return {
    stream() {
      return AssistantMessageEventStream.from([
        { type: 'message_start', messageId: 'assistant-1', role: 'assistant' },
        { type: 'content_block_start', index: 0, block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'done' } },
        { type: 'content_block_end', index: 0, block: { type: 'text', text: 'done' } },
        { type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'done' }], stopReason: 'stop' } },
      ]);
    },
  };
}

function waitingApprovalAi(): AgentAiClient {
  return {
    stream() {
      return AssistantMessageEventStream.from([
        { type: 'message_start', messageId: 'assistant-1', role: 'assistant' },
        {
          type: 'content_block_start',
          index: 0,
          block: { type: 'toolCall', id: 'tool-call-1', name: 'write_file', argumentsText: '{"path":"src/a.ts","content":"hello"}' },
        },
        {
          type: 'content_block_end',
          index: 0,
          block: { type: 'toolCall', id: 'tool-call-1', name: 'write_file', argumentsText: '{"path":"src/a.ts","content":"hello"}' },
        },
        {
          type: 'message_end',
          message: {
            role: 'assistant',
            content: [{ type: 'toolCall', id: 'tool-call-1', name: 'write_file', argumentsText: '{"path":"src/a.ts","content":"hello"}' }],
          },
        },
      ]);
    },
  };
}

function cancellableAi(started: () => void, release: Promise<void>): AgentAiClient {
  return {
    stream() {
      return AssistantMessageEventStream.from((async function* () {
        yield { type: 'message_start' as const, messageId: 'assistant-1', role: 'assistant' as const };
        started();
        await release;
        yield { type: 'message_end' as const, message: { role: 'assistant' as const, content: [], stopReason: 'cancelled' } };
      })());
    },
  };
}

describe('session message cancel protocol', () => {
  it('keeps request mapping while running so cancel can target requestId', async () => {
    const root = await createTempRoot();
    let release!: () => void;
    const releasePromise = new Promise<void>((resolve) => { release = resolve; });
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => { started = resolve; });
    const runtime = createLocalDesktopRuntime({
      hosts: createFakeHosts(root),
      databasePath: ':memory:',
      workspaceRoot: root,
      ai: cancellableAi(started, releasePromise),
      now: () => '2026-06-20T00:00:00.000Z',
      createId,
    });

    const start = runtime.agentRuntime.startRun(startRequest('request-running-1', 'cancel while running'));
    await startedPromise;
    const cancel = await runtime.agentRuntime.cancelRun({
      runId: '',
      reason: 'user_requested',
      metadata: { targetRequestId: 'request-running-1' },
      client: { clientKind: 'test', requestId: 'cancel-1', createdAt: '2026-06-20T00:00:01.000Z', capabilities: { streaming: true } },
    });
    release();

    expect(cancel).toMatchObject({ status: 'cancelled', sessionId: 'session-request-running-1' });
    await expect(start).resolves.toMatchObject({ status: 'cancelled', sessionId: 'session-request-running-1' });
    await runtime.stop();
  });

  it('keeps request mapping while waiting for approval so cancel can target requestId', async () => {
    const root = await createTempRoot();
    const events: AgentRuntimeEvent[] = [];
    const runtime = createLocalDesktopRuntime({
      hosts: createFakeHosts(root),
      databasePath: ':memory:',
      workspaceRoot: root,
      ai: waitingApprovalAi(),
      now: () => '2026-06-20T00:00:00.000Z',
      createId,
    });
    const unsubscribe = runtime.agentRuntime.subscribe((event) => events.push(event));

    await expect(runtime.agentRuntime.startRun(startRequest('request-approval-1', 'write file'))).resolves.toMatchObject({
      status: 'waiting_for_approval',
      sessionId: 'session-request-approval-1',
    });
    const cancel = await runtime.agentRuntime.cancelRun({
      runId: '',
      reason: 'user_requested',
      metadata: { targetRequestId: 'request-approval-1' },
      client: { clientKind: 'test', requestId: 'cancel-approval-1', createdAt: '2026-06-20T00:00:01.000Z', capabilities: { streaming: true } },
    });
    const approval = await runtime.permissionRepository.getApprovalRequest('approval-tool-call-1');

    expect(cancel).toMatchObject({ status: 'cancelled', sessionId: 'session-request-approval-1' });
    expect(approval).toEqual(expect.objectContaining({
      id: 'approval-tool-call-1',
      status: 'cancelled',
      userDecision: { kind: 'cancel', decidedAt: '2026-06-20T00:00:00.000Z' },
    }));
    expect(events).toContainEqual(expect.objectContaining({
      type: 'run.cancelled',
      payload: expect.objectContaining({ requestId: 'request-approval-1' }),
    }));
    unsubscribe();
    await runtime.stop();
  });

  it('publishes terminal requestId before clearing mapping', async () => {
    const root = await createTempRoot();
    const events: AgentRuntimeEvent[] = [];
    const runtime = createLocalDesktopRuntime({
      hosts: createFakeHosts(root),
      databasePath: ':memory:',
      workspaceRoot: root,
      ai: completedAi(),
      now: () => '2026-06-20T00:00:00.000Z',
      createId,
    });
    const unsubscribe = runtime.agentRuntime.subscribe((event) => events.push(event));

    await expect(runtime.agentRuntime.startRun(startRequest('request-terminal-1', 'finish'))).resolves.toMatchObject({
      status: 'completed',
    });

    expect(events).toContainEqual(expect.objectContaining({
      type: 'run.status.changed',
      payload: expect.objectContaining({ status: 'completed', requestId: 'request-terminal-1' }),
    }));
    await expect(runtime.agentRuntime.cancelRun({
      runId: '',
      reason: 'user_requested',
      metadata: { targetRequestId: 'request-terminal-1' },
      client: { clientKind: 'test', requestId: 'cancel-terminal-1', createdAt: '2026-06-20T00:00:01.000Z', capabilities: { streaming: true } },
    })).rejects.toThrow(/runId or targetRequestId is required|run record was not found/);
    unsubscribe();
    await runtime.stop();
  });
});
