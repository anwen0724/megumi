import { describe, expect, it, vi } from 'vitest';
import type { DesktopIpcContext } from '../../../src/desktop/ipc/ipc-context';
import { handleSessionOperation } from '../../../src/desktop/ipc/session.handler';
import { IPC_CHANNELS } from '../../../src/shared/renderer-contracts/ipc';
import { createSessionStateManager } from '../../../src/session';
import { createInMemorySessionRepository } from './support/in-memory-session-repository';

function createId(prefix: string, value: string): string {
  return `${prefix}-${value}`;
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

function createContext(options: {
  includeAssistant?: boolean;
  includeRuntimeEvents?: boolean;
  includeCommittedTimeline?: boolean;
} = {}): DesktopIpcContext {
  const sessionRepository = createInMemorySessionRepository();
  const publishedEvents: unknown[] = [];
  const sessionManager = createSessionStateManager({
    repository: sessionRepository,
    now: () => '2026-06-20T00:00:00.000Z',
    createId,
  });
  sessionManager.createSession({
    idSeed: '1',
    title: 'History',
    workspaceId: 'workspace-1',
    workspacePath: 'C:/workspace/test',
  });
  sessionManager.appendMessage({
    idSeed: 'user-1',
    sourceEntryIdSeed: 'source-user-1',
    sessionId: 'session-1',
    role: 'user',
    content: { text: 'hello' },
  });
  sessionManager.recordRun({
    idSeed: 'run-1',
    sourceEntryIdSeed: 'source-run-1',
    sessionId: 'session-1',
    inputSummary: 'hello',
    status: 'completed',
  });
  if (options.includeAssistant) {
    sessionManager.appendMessage({
      idSeed: 'assistant-1',
      sourceEntryIdSeed: 'source-assistant-1',
      sessionId: 'session-1',
      role: 'assistant',
      content: {
        role: 'assistant',
        content: [{ type: 'text', text: 'world' }],
        stopReason: 'stop',
      },
      metadata: { agentRunId: 'session-run-run-1', turnIndex: 0 },
    });
  }
  return {
    appApi: { startRun: vi.fn(), resumeRun: vi.fn(), cancelRun: vi.fn(), retryRun: vi.fn() } as never,
    hosts: {} as never,
    runtime: {
      sessionRepository,
      sessionManager,
      runtimeEventRepository: {
        listEventsByRun: (runId: string) => options.includeRuntimeEvents && runId === 'session-run-run-1'
          ? [
              {
                eventId: 'runtime-event:session-run-run-1:1',
                sequence: 1,
                type: 'turn.started',
                runId: 'session-run-run-1',
                sessionId: 'session-1',
                workspaceId: 'workspace-1',
                occurredAt: '2026-06-20T00:00:00.000Z',
                payload: { sequence: 1 },
              },
              {
                eventId: 'runtime-event:session-run-run-1:2',
                sequence: 2,
                type: 'ai.message.event',
                runId: 'session-run-run-1',
                sessionId: 'session-1',
                workspaceId: 'workspace-1',
                occurredAt: '2026-06-20T00:00:01.000Z',
                payload: {
                  sequence: 2,
                  event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Need inspect files.' } },
                },
              },
              {
                eventId: 'runtime-event:session-run-run-1:3',
                sequence: 3,
                type: 'ai.message.event',
                runId: 'session-run-run-1',
                sessionId: 'session-1',
                workspaceId: 'workspace-1',
                occurredAt: '2026-06-20T00:00:02.000Z',
                payload: {
                  sequence: 3,
                  event: { type: 'content_block_end', index: 0, block: { type: 'thinking', thinking: 'Need inspect files.' } },
                },
              },
              {
                eventId: 'runtime-event:session-run-run-1:4',
                sequence: 4,
                type: 'ai.message.event',
                runId: 'session-run-run-1',
                sessionId: 'session-1',
                workspaceId: 'workspace-1',
                occurredAt: '2026-06-20T00:00:03.000Z',
                payload: {
                  sequence: 4,
                  event: { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: '好的，让我先看看项目目录。' } },
                },
              },
              {
                eventId: 'runtime-event:session-run-run-1:5',
                sequence: 5,
                type: 'ai.message.event',
                runId: 'session-run-run-1',
                sessionId: 'session-1',
                workspaceId: 'workspace-1',
                occurredAt: '2026-06-20T00:00:04.000Z',
                payload: {
                  sequence: 5,
                  event: { type: 'content_block_delta', index: 2, delta: { type: 'tool_call_delta', id: 'call-list', name: 'list_directory', argumentsTextDelta: '{"path":"."}' } },
                },
              },
              {
                eventId: 'runtime-event:session-run-run-1:6',
                sequence: 6,
                type: 'ai.message.completed',
                runId: 'session-run-run-1',
                sessionId: 'session-1',
                workspaceId: 'workspace-1',
                occurredAt: '2026-06-20T00:00:05.000Z',
                payload: { sequence: 6 },
              },
              {
                eventId: 'runtime-event:session-run-run-1:7',
                sequence: 7,
                type: 'tool.call.created',
                runId: 'session-run-run-1',
                sessionId: 'session-1',
                workspaceId: 'workspace-1',
                occurredAt: '2026-06-20T00:00:06.000Z',
                payload: { sequence: 7, toolCallId: 'call-list', toolName: 'list_directory', input: { path: '.' } },
              },
              {
                eventId: 'runtime-event:session-run-run-1:8',
                sequence: 8,
                type: 'tool.result.created',
                runId: 'session-run-run-1',
                sessionId: 'session-1',
                workspaceId: 'workspace-1',
                occurredAt: '2026-06-20T00:00:07.000Z',
                payload: { sequence: 8, toolCallId: 'call-list', toolName: 'list_directory', status: 'success' },
              },
              {
                eventId: 'runtime-event:session-run-run-1:9',
                sequence: 9,
                type: 'run.status.changed',
                runId: 'session-run-run-1',
                sessionId: 'session-1',
                workspaceId: 'workspace-1',
                occurredAt: '2026-06-20T00:00:08.000Z',
                payload: { sequence: 9, status: 'completed' },
              },
            ]
          : [],
      },
      timelineMessageRepository: {
        listCommittedMessagesBySession: () => options.includeCommittedTimeline
          ? {
              messages: [
                {
                  messageId: 'session-message-user-1',
                  role: 'user',
                  projectId: 'workspace-1',
                  sessionId: 'session-1',
                  runId: 'session-run-run-1',
                  turnOrder: 0,
                  createdAt: '2026-06-20T00:00:00.000Z',
                  updatedAt: '2026-06-20T00:00:00.000Z',
                  blocks: [{ blockId: 'user-text:session-message-user-1', kind: 'user_text', text: 'hello', format: 'plain' }],
                },
                {
                  messageId: 'assistant:session-run-run-1',
                  role: 'assistant',
                  projectId: 'workspace-1',
                  sessionId: 'session-1',
                  runId: 'session-run-run-1',
                  turnOrder: 1,
                  createdAt: '2026-06-20T00:00:01.000Z',
                  updatedAt: '2026-06-20T00:00:02.000Z',
                  blocks: [
                    {
                      blockId: 'process:session-run-run-1',
                      kind: 'process_disclosure',
                      runId: 'session-run-run-1',
                      status: 'completed',
                      items: [{ itemId: 'thinking:1', kind: 'thinking', thinkingId: '1', status: 'completed', text: 'committed', format: 'plain' }],
                    },
                    {
                      blockId: 'answer:session-run-run-1',
                      kind: 'answer_text',
                      runId: 'session-run-run-1',
                      textId: 'answer-1',
                      status: 'completed',
                      text: 'committed answer',
                      format: 'markdown',
                    },
                  ],
                },
              ],
              diagnostics: [],
            }
          : { messages: [], diagnostics: [] },
      },
      eventBus: {
        publish: (event: unknown) => publishedEvents.push(event),
        subscribe: vi.fn(),
      },
    } as never,
    getMainWindow: () => undefined,
    publishedEvents,
  } as DesktopIpcContext & { publishedEvents: unknown[] };
}

describe('history and recovery session IPC', () => {
  it('hydrates session list and timeline from session facts', async () => {
    const context = createContext({ includeAssistant: true });

    await expect(handleSessionOperation('session.list', {}, context)).resolves.toEqual({
      sessions: [expect.objectContaining({
        sessionId: 'session-1',
        title: 'History',
        workspaceId: 'workspace-1',
        workspacePath: 'C:/workspace/test',
      })],
    });
    await expect(handleSessionOperation('session.timeline.list', rendererRequest(IPC_CHANNELS.session.timeline.list, {
      projectId: 'workspace-1',
      sessionId: 'session-1',
    }), context)).resolves.toEqual({
      sessionId: 'session-1',
      messages: [
        expect.objectContaining({
          messageId: 'session-message-user-1',
          projectId: 'workspace-1',
          sessionId: 'session-1',
          role: 'user',
          runId: 'session-run-run-1',
          blocks: [expect.objectContaining({ kind: 'user_text', text: 'hello' })],
        }),
        expect.objectContaining({
          messageId: 'session-message-assistant-1',
          projectId: 'workspace-1',
          sessionId: 'session-1',
          role: 'assistant',
          runId: 'session-run-run-1',
          blocks: expect.arrayContaining([
            expect.objectContaining({ kind: 'answer_text', text: 'world', status: 'completed' }),
          ]),
        }),
      ],
      runs: [expect.objectContaining({ runId: 'session-run-run-1', inputSummary: 'hello', status: 'completed' })],
      activePath: expect.arrayContaining([
        expect.objectContaining({ kind: 'message' }),
        expect.objectContaining({ kind: 'run' }),
      ]),
      diagnostics: [],
    });
  });

  it('hydrates disclosure items from persisted runtime events', async () => {
    const context = createContext({ includeAssistant: true, includeRuntimeEvents: true });

    const timeline = await handleSessionOperation('session.timeline.list', rendererRequest(IPC_CHANNELS.session.timeline.list, {
      projectId: 'workspace-1',
      sessionId: 'session-1',
    }), context) as { messages: Array<{ role: string; blocks: Array<{ kind: string; items?: unknown[]; status?: string }> }> };
    const assistant = timeline.messages.find((message) => message.role === 'assistant');
    const process = assistant?.blocks.find((block) => block.kind === 'process_disclosure');

    expect(process).toEqual(expect.objectContaining({
      status: 'completed',
      items: [
        expect.objectContaining({
          kind: 'thinking',
          text: 'Need inspect files.',
          status: 'completed',
        }),
        expect.objectContaining({
          kind: 'assistant_text',
          text: '好的，让我先看看项目目录。',
          status: 'completed',
        }),
        expect.objectContaining({
          kind: 'tool_activity',
          inputSummary: '.',
          status: 'succeeded',
        }),
      ],
    }));
  });

  it('prefers committed canonical timeline history over fallback runtime reconstruction', async () => {
    const context = createContext({ includeAssistant: true, includeRuntimeEvents: true, includeCommittedTimeline: true });

    const timeline = await handleSessionOperation('session.timeline.list', rendererRequest(IPC_CHANNELS.session.timeline.list, {
      projectId: 'workspace-1',
      sessionId: 'session-1',
    }), context) as { messages: Array<{ role: string; blocks: Array<{ kind: string; text?: string; items?: Array<{ text?: string }> }> }>; diagnostics: unknown[] };
    const assistant = timeline.messages.find((message) => message.role === 'assistant');
    const answer = assistant?.blocks.find((block) => block.kind === 'answer_text');
    const process = assistant?.blocks.find((block) => block.kind === 'process_disclosure');

    expect(timeline.diagnostics).toEqual([]);
    expect(timeline.messages.map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(answer).toEqual(expect.objectContaining({ text: 'committed answer' }));
    expect(process?.items).toEqual([expect.objectContaining({ text: 'committed' })]);
  });

  it('hydrates one assistant timeline from a multi-step run without letting a final empty error assistant overwrite it', async () => {
    const context = createContext({ includeRuntimeEvents: true });
    context.runtime?.sessionManager.appendMessage({
      idSeed: 'assistant-turn-0',
      sourceEntryIdSeed: 'source-assistant-turn-0',
      sessionId: 'session-1',
      role: 'assistant',
      content: {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'Need inspect files.' },
          { type: 'text', text: '好的，让我先看看项目目录。' },
          { type: 'toolCall', id: 'call-list', name: 'list_directory', argumentsText: '{"path":"."}' },
        ],
        stopReason: 'tool_calls',
      },
      metadata: { agentRunId: 'session-run-run-1', turnIndex: 0 },
    });
    context.runtime?.sessionManager.appendMessage({
      idSeed: 'tool-result-turn-0',
      sourceEntryIdSeed: 'source-tool-result-turn-0',
      sessionId: 'session-1',
      role: 'tool_result',
      content: {
        role: 'toolResult',
        toolCallId: 'call-list',
        content: 'README.md',
      },
      metadata: { agentRunId: 'session-run-run-1', turnIndex: 0, toolCallId: 'call-list' },
    });
    context.runtime?.sessionManager.appendMessage({
      idSeed: 'assistant-turn-1',
      sourceEntryIdSeed: 'source-assistant-turn-1',
      sessionId: 'session-1',
      role: 'assistant',
      content: {
        role: 'assistant',
        content: [],
        stopReason: 'error',
        error: { code: 'provider_http_error', message: 'Provider rejected the request.' },
      },
      metadata: { agentRunId: 'session-run-run-1', turnIndex: 1 },
    });

    const timeline = await handleSessionOperation('session.timeline.list', rendererRequest(IPC_CHANNELS.session.timeline.list, {
      projectId: 'workspace-1',
      sessionId: 'session-1',
    }), context) as { messages: Array<{ role: string; blocks: Array<{ kind: string; text?: string; items?: Array<{ kind: string; text?: string }> }> }> };
    const assistantMessages = timeline.messages.filter((message) => message.role === 'assistant');
    const process = assistantMessages[0]?.blocks.find((block) => block.kind === 'process_disclosure');

    expect(assistantMessages).toHaveLength(1);
    expect(process?.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'thinking', text: 'Need inspect files.' }),
      expect.objectContaining({ kind: 'assistant_text', text: '好的，让我先看看项目目录。' }),
      expect.objectContaining({ kind: 'tool_activity' }),
    ]));
  });

  it('creates and cancels branch draft through session owner facts', async () => {
    const context = createContext() as DesktopIpcContext & { publishedEvents: unknown[] };
    const originalLeaf = context.runtime?.sessionRepository.getActiveLeaf('session-1');
    expect(originalLeaf?.id).toBe('session-source-entry-source-run-1');

    const created = await handleSessionOperation('session.branchDraft.create', {
      sessionId: 'session-1',
      messageId: 'session-message-user-1',
      intent: 'rerun',
      createdAt: '2026-06-20T00:01:00.000Z',
    }, context) as { branchDraft: { branchMarkerId: string; sourceMessageId: string; seedText: string; intent: string } };

    expect(created.branchDraft).toMatchObject({
      sourceMessageId: 'session-message-user-1',
      seedText: 'hello',
      intent: 'rerun',
    });
    expect(context.runtime?.sessionRepository.getActiveLeaf('session-1')?.id)
      .toBe('session-source-entry-source-user-1');

    await expect(handleSessionOperation('session.branchDraft.cancel', {
      sessionId: 'session-1',
      branchMarkerId: created.branchDraft.branchMarkerId,
      createdAt: '2026-06-20T00:02:00.000Z',
    }, context)).resolves.toEqual({ cancelled: true });
    expect(context.runtime?.sessionRepository.getActiveLeaf('session-1')?.id).toBe(originalLeaf?.id);
    expect(context.publishedEvents).toContainEqual(expect.objectContaining({
      type: 'session.branch_draft.cancelled',
      sessionId: 'session-1',
      occurredAt: expect.any(String),
      payload: {
        branchMarkerId: created.branchDraft.branchMarkerId,
        restoredLeafSourceEntryId: originalLeaf?.id,
        reason: 'branch_cancelled',
      },
    }));
  });

  it('does not cancel a branch draft after new sources were appended', async () => {
    const context = createContext();

    const created = await handleSessionOperation('session.branchDraft.create', {
      sessionId: 'session-1',
      messageId: 'session-message-user-1',
      intent: 'branch',
      createdAt: '2026-06-20T00:01:00.000Z',
    }, context) as { branchDraft: { branchMarkerId: string } };
    context.runtime?.sessionManager.appendMessage({
      idSeed: 'after-branch',
      sourceEntryIdSeed: 'source-after-branch',
      sessionId: 'session-1',
      role: 'user',
      content: { text: 'new branch input' },
    });

    await expect(handleSessionOperation('session.branchDraft.cancel', {
      sessionId: 'session-1',
      branchMarkerId: created.branchDraft.branchMarkerId,
      createdAt: '2026-06-20T00:02:00.000Z',
    }, context)).resolves.toEqual({ cancelled: false, reason: 'branch_has_new_sources' });
    expect(context.runtime?.sessionRepository.getActiveLeaf('session-1')?.id)
      .toBe('session-source-entry-source-after-branch');
  });
});
