// @vitest-environment node
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDesktopAppApi, createLocalDesktopRuntime } from '../../../src/desktop';
import type { AgentRuntimeEvent } from '../../../src/app';
import type { AgentAiClient } from '../../../src/agent';
import { AssistantMessageEventStream, createAiError } from '../../../src/ai';
import type { DesktopHostAdapters } from '../../../src/desktop/composition/create-host-adapters';
import type { Session } from '../../../src/session';

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
    expect(events.find((event) => event.type === 'run.status.changed' && event.payload?.status === 'completed')).toEqual(
      expect.objectContaining({
        payload: expect.objectContaining({
          requestId: 'request-1',
        }),
      }),
    );
    expect(runtime.sessionRepository.getSession('session-1')).toMatchObject({
      id: 'session-1',
      status: 'active',
      workspaceId: 'workspace-local',
    });
    expect(runtime.timelineMessageRepository.listCommittedMessagesBySession({
      projectId: 'workspace-local',
      sessionId: 'session-1',
    }).messages).toEqual([
      expect.objectContaining({
        role: 'user',
        runId: response.runId,
        blocks: [expect.objectContaining({ kind: 'user_text', text: 'hello' })],
      }),
      expect.objectContaining({
        role: 'assistant',
        runId: response.runId,
        blocks: expect.arrayContaining([
          expect.objectContaining({ kind: 'answer_text', text: 'pong', status: 'completed' }),
        ]),
      }),
    ]);
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

  it('marks provider stream terminal errors as failed runs instead of completed runs', async () => {
    const root = await createTempRoot();
    const runtime = createLocalDesktopRuntime({
      hosts: createFakeHosts(root),
      databasePath: ':memory:',
      workspaceRoot: root,
      ai: {
        stream() {
          return AssistantMessageEventStream.from([
            {
              type: 'error',
              reason: 'error',
              message: {
                role: 'assistant',
                content: [],
                stopReason: 'error',
                error: createAiError({
                  code: 'provider_bad_request',
                  message: 'Provider rejected the message order.',
                  retryable: false,
                }),
              },
            },
          ]);
        },
      },
      now: () => '2026-06-19T00:00:00.000Z',
      createId,
    });

    const response = await runtime.agentRuntime.startRun({
      rawInput: {
        id: 'raw-error-1',
        text: 'hello',
        source: { kind: 'desktop' },
        createdAt: '2026-06-19T00:00:00.000Z',
      },
      sessionId: 'session-error-1',
      client: {
        clientKind: 'test',
        requestId: 'request-error-1',
        createdAt: '2026-06-19T00:00:00.000Z',
        capabilities: { streaming: true },
      },
    });

    expect(response.status).toBe('failed');
    expect(runtime.sessionRepository.getRunRecord(response.runId)).toMatchObject({
      status: 'failed',
      error: expect.objectContaining({ code: 'provider_bad_request' }),
    });
    await runtime.stop();
  });

  it('cancels an active renderer request by targetRequestId and aborts the model stream', async () => {
    const root = await createTempRoot();
    let releaseStream: (() => void) | undefined;
    let streamStarted!: () => void;
    const streamStartedPromise = new Promise<void>((resolve) => {
      streamStarted = resolve;
    });
    const runtime = createLocalDesktopRuntime({
      hosts: createFakeHosts(root),
      databasePath: ':memory:',
      workspaceRoot: root,
      ai: {
        stream(_model, _context, options) {
          streamStarted();
          return AssistantMessageEventStream.from((async function* () {
            await new Promise<void>((resolve) => {
              releaseStream = resolve;
              options.signal?.addEventListener('abort', () => resolve(), { once: true });
            });
            if (options.signal?.aborted) {
              yield {
                type: 'error' as const,
                reason: 'aborted' as const,
                message: {
                  role: 'assistant' as const,
                  content: [],
                  stopReason: 'cancelled',
                  error: createAiError({
                    code: 'run_cancelled',
                    message: 'Run was cancelled by the user.',
                    retryable: false,
                  }),
                },
              };
              return;
            }
            yield {
              type: 'message_end' as const,
              message: { role: 'assistant' as const, content: [{ type: 'text' as const, text: 'late' }], stopReason: 'stop' },
            };
          })());
        },
      },
      now: () => '2026-06-19T00:00:00.000Z',
      createId,
    });

    const startPromise = runtime.agentRuntime.startRun({
      rawInput: {
        id: 'raw-cancel-1',
        text: 'cancel me',
        source: { kind: 'desktop' },
        createdAt: '2026-06-19T00:00:00.000Z',
      },
      sessionId: 'session-cancel-1',
      client: {
        clientKind: 'test',
        requestId: 'request-cancel-1',
        createdAt: '2026-06-19T00:00:00.000Z',
        capabilities: { streaming: true },
      },
    });
    await streamStartedPromise;

    let cancelResponse: unknown;
    try {
      cancelResponse = await runtime.agentRuntime.cancelRun({
        runId: '',
        reason: 'user_requested',
        metadata: { targetRequestId: 'request-cancel-1' },
        client: {
          clientKind: 'test',
          requestId: 'cancel-request-1',
          createdAt: '2026-06-19T00:00:01.000Z',
          capabilities: { streaming: true },
        },
      });
    } finally {
      releaseStream?.();
    }

    expect(cancelResponse).toMatchObject({
      sessionId: 'session-cancel-1',
      status: 'cancelled',
    });
    await expect(startPromise).resolves.toMatchObject({
      sessionId: 'session-cancel-1',
      status: 'cancelled',
    });
    await runtime.stop();
  });

  it('keeps failed runs visible in history without replaying empty assistant errors to the next model request', async () => {
    const root = await createTempRoot();
    const capturedMessages: unknown[][] = [];
    const runtime = createLocalDesktopRuntime({
      hosts: createFakeHosts(root),
      databasePath: ':memory:',
      workspaceRoot: root,
      ai: {
        stream(_model, context) {
          capturedMessages.push(context.messages);
          return AssistantMessageEventStream.from([
            { type: 'message_start', messageId: 'assistant-1', role: 'assistant' },
            { type: 'content_block_start', index: 0, block: { type: 'text', text: '' } },
            { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } },
            { type: 'content_block_end', index: 0, block: { type: 'text', text: 'ok' } },
            { type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }], stopReason: 'stop' } },
          ]);
        },
      },
      now: () => '2026-06-19T00:00:00.000Z',
      createId,
    });

    runtime.sessionRepository.createSession({
      id: 'session-history-filter-1' as Session['id'],
      title: 'History filter',
      status: 'active',
      workspaceId: 'workspace-local',
      workspacePath: root,
      createdAt: '2026-06-18T00:00:00.000Z',
      updatedAt: '2026-06-18T00:00:00.000Z',
    });
    runtime.sessionManager.appendMessage({
      idSeed: 'old-user',
      sourceEntryIdSeed: 'old-user-source',
      sessionId: 'session-history-filter-1',
      role: 'user',
      content: 'previous user message',
    });
    const failed = runtime.sessionManager.recordRun({
      idSeed: 'old-run',
      sourceEntryIdSeed: 'old-run-source',
      sessionId: 'session-history-filter-1',
      inputSummary: 'previous failed request',
      status: 'running',
      metadata: { parsedInputId: 'old-run' },
    });
    runtime.sessionManager.updateRunStatus({
      runId: failed.run.id,
      status: 'failed',
      endedAt: '2026-06-18T00:00:01.000Z',
      error: { code: 'provider_http_error', message: 'Provider request failed.' },
      metadata: failed.run.metadata,
    });
    runtime.sessionManager.appendMessage({
      idSeed: 'old-empty-assistant-error',
      sourceEntryIdSeed: 'old-empty-assistant-error-source',
      sessionId: 'session-history-filter-1',
      role: 'assistant',
      content: {
        role: 'assistant',
        content: [],
        stopReason: 'error',
        error: { code: 'provider_http_error', message: 'Provider request failed.' },
      },
      metadata: { agentRunId: failed.run.id, turnIndex: 0 },
    });

    const response = await runtime.agentRuntime.startRun({
      rawInput: {
        id: 'raw-after-failure',
        text: 'try again',
        source: { kind: 'desktop' },
        createdAt: '2026-06-19T00:00:00.000Z',
      },
      sessionId: 'session-history-filter-1',
      workspaceId: 'workspace-local',
      client: {
        clientKind: 'test',
        requestId: 'request-after-failure',
        createdAt: '2026-06-19T00:00:00.000Z',
        capabilities: { streaming: true },
      },
    });

    expect(response.status).toBe('completed');
    expect(runtime.sessionRepository.getRunRecord(failed.run.id)).toMatchObject({ status: 'failed' });
    expect(capturedMessages.at(-1)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: 'user',
        content: expect.stringContaining('Previous run failed before a final answer.'),
      }),
    ]));
    expect(capturedMessages.at(-1)).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: 'assistant',
        content: [],
      }),
    ]));
    await runtime.stop();
  });
});
