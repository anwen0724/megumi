import { describe, expect, it, vi } from 'vitest';
import { createChatHost } from '@megumi/product/host-interface/chat-host';
import type { AgentRun } from '@megumi/agent/agent-run';
import type { RuntimeEvent } from '@megumi/agent/events';
import type { TimelineMessage } from '@megumi/agent/projections/timeline';
import { createSessionBranchService, type SessionService } from '@megumi/agent/session';

const unavailableContextService = {
  getSessionUsageSnapshot: () => ({ status: 'not_available' as const }),
};

describe('ChatHost product semantics', () => {
  it('delegates explicit session creation request to the Session owner', async () => {
    const createSession = vi.fn(() => ({
      status: 'created' as const,
      session: {
        session_id: 'session:owner-1',
        workspace_id: 'workspace:1',
        title: 'Planning',
        status: 'active' as const,
        created_at: '2026-07-10T00:00:00.000Z',
        updated_at: '2026-07-10T00:00:00.000Z',
      },
    }));
    const host = createChatHost({
      agentRunService: { startRun: vi.fn(), cancelRun: vi.fn() } as never,
      commandService: { getCommandSuggestions: vi.fn() } as never,
      sessionService: {
        createSession,
        getSession: vi.fn(() => ({ status: 'not_found' })),
      } as never,
      branchService: createSessionBranchService(),
      workspaceService: { listWorkspaces: vi.fn(async () => ({ workspaces: [] })) },
      sessionTimelineQuery: { listSessionTimeline: vi.fn() as never },
      contextService: unavailableContextService,
    });

    await expect(host.createSession({
      projectId: 'workspace:1',
      title: 'Planning',
    })).resolves.toMatchObject({
      status: 'created',
      session: {
        id: 'session:owner-1',
        projectId: 'workspace:1',
        title: 'Planning',
      },
    });
    expect(createSession).toHaveBeenCalledWith({
      workspace_id: 'workspace:1',
      title: 'Planning',
    });
  });

  it('returns Session owner failures from createSession without throwing', async () => {
    const host = createHost(vi.fn(), vi.fn(), {
      createSession: vi.fn(() => ({
        status: 'failed' as const,
        failure: { code: 'session_repository_error', message: 'Session store failed.' },
      })),
    });

    await expect(host.createSession({
      projectId: 'workspace:1',
      title: 'Planning',
    })).resolves.toEqual({
      status: 'failed',
      failure: { code: 'session_repository_error', message: 'Session store failed.' },
    });
  });

  it('returns Session owner failures from listSessions without throwing', async () => {
    const host = createChatHost({
      agentRunService: { startRun: vi.fn(), cancelRun: vi.fn() } as never,
      commandService: { getCommandSuggestions: vi.fn() } as never,
      sessionService: {
        listSessions: vi.fn(() => ({
          status: 'failed' as const,
          failure: { code: 'session_repository_error', message: 'Cannot list sessions.' },
        })),
      } as never,
      branchService: createSessionBranchService(),
      workspaceService: {
        listWorkspaces: vi.fn(async () => ({
          workspaces: [{
            workspace_id: 'workspace:1',
            name: 'megumi',
            root_path: 'C:/work/megumi',
            root_path_key: 'c:/work/megumi',
            status: 'available' as const,
            created_at: '2026-07-10T00:00:00.000Z',
            updated_at: '2026-07-10T00:00:00.000Z',
            last_opened_at: '2026-07-10T00:00:00.000Z',
          }],
        })),
      },
      sessionTimelineQuery: { listSessionTimeline: vi.fn() as never },
      contextService: unavailableContextService,
    });

    await expect(host.listSessions()).resolves.toEqual({
      status: 'failed',
      failure: { code: 'session_repository_error', message: 'Cannot list sessions.' },
    });
  });

  it('returns Session owner failures from listMessages without throwing', async () => {
    const getActiveConversationHistory = vi.fn(() => ({
        status: 'failed' as const,
        failure: { code: 'session_not_found', message: 'Session was not found.' },
      }));
    const host = createHost(vi.fn(), vi.fn(), { getActiveConversationHistory });

    await expect(host.listMessages({ sessionId: 'session:missing' })).resolves.toEqual({
      status: 'failed',
      failure: { code: 'session_not_found', message: 'Session was not found.' },
    });
    expect(getActiveConversationHistory).toHaveBeenCalledWith({ session_id: 'session:missing' });
  });

  it('loads user messages for a set of diagnostic Run IDs', async () => {
    const listUserMessagesByRunIds = vi.fn(() => ({
      status: 'ok' as const,
      messages: [{
        message_id: 'message:1',
        session_id: 'session:1',
        run_id: 'run:1',
        message_kind: 'user_message' as const,
        content: [{ type: 'text' as const, text: 'Inspect this run' }],
        created_at: '2026-07-14T00:00:00.000Z',
      }],
    }));
    const host = createHost(vi.fn(), vi.fn(), { listUserMessagesByRunIds });

    await expect(host.listMessages({
      runIds: ['run:1'],
    })).resolves.toMatchObject({
      status: 'ok',
      messages: [{ runId: 'run:1', role: 'user', text: 'Inspect this run' }],
    });
    expect(listUserMessagesByRunIds).toHaveBeenCalledWith({
      run_ids: ['run:1'],
    });
  });

  it('does not assign session title or permission defaults for send requests', async () => {
    const startRun = vi.fn(async () => ({
      status: 'completed',
      request_id: 'request:generated',
      message: 'done',
    }));
    const host = createHost(startRun);

    const result = await host.sendUserInput({
      projectId: 'workspace:1',
      text: 'hello',
      modelSelection: { provider_id: 'deepseek', model_id: 'deepseek-chat' },
    });

    expect(startRun).toHaveBeenCalledWith(expect.objectContaining({
      request_id: expect.stringMatching(/^request:/),
      workspace_id: 'workspace:1',
      session: { type: 'new' },
    }));
    const startRunCalls = startRun.mock.calls as unknown as Array<[Record<string, unknown>]>;
    const startRunRequest = startRunCalls[0]?.[0];
    expect(startRunRequest).not.toHaveProperty('permission_mode');
    expect(result.payload).toMatchObject({ type: 'completed', message: 'done' });
  });

  it('forwards branch draft selection to Agent Run without exposing parent entries', async () => {
    const startRun = vi.fn(async () => ({
      status: 'completed',
      request_id: 'request:branch-send',
      message: 'done',
    }));
    const host = createHost(startRun);

    await host.sendUserInput({
      requestId: 'request:branch-send',
      projectId: 'workspace:1',
      sessionId: 'session:1',
      branchMarkerId: 'branch:1',
      text: 'continue from there',
      modelSelection: { provider_id: 'deepseek', model_id: 'deepseek-chat' },
    });

    expect(startRun).toHaveBeenCalledWith(expect.objectContaining({
      branch_marker_id: 'branch:1',
    }));
    expect(startRun).not.toHaveBeenCalledWith(expect.objectContaining({
      parent_entry_id: expect.any(String),
    }));
  });

  it('uses the Agent Run returned session instead of creating a fallback session', async () => {
    const startRun = vi.fn(async () => ({
      status: 'started' as const,
      request_id: 'request:1',
      session: {
        session_id: 'session:owner',
        workspace_id: 'workspace:1',
        title: 'Owner Session',
        status: 'active' as const,
        created_at: '2026-07-10T00:00:00.000Z',
        updated_at: '2026-07-10T00:00:00.000Z',
      },
      user_message_id: 'message:1',
      user_message: {
        message: {
          message_id: 'message:1',
          session_id: 'session:owner',
          run_id: 'run:1',
          message_kind: 'user_message' as const,
          content: [{ type: 'text' as const, text: 'hello' }],
          created_at: '2026-07-10T00:00:01.000Z',
        },
        attachments: [],
      },
      run: {
        run_id: 'run:1',
        workspace_id: 'workspace:1',
        session_id: 'session:owner',
        model_selection: { provider_id: 'deepseek', model_id: 'deepseek-chat' },
        trigger: { type: 'user_input' as const, user_message_id: 'message:1' },
        status: 'running' as const,
        created_at: '2026-07-10T00:00:01.000Z',
      },
      events: (async function* () {})(),
    }));
    const getSession = vi.fn(() => ({ status: 'not_found' as const }));
    const host = createHost(startRun, vi.fn(), { getSession });

    const result = await host.sendUserInput({
      requestId: 'request:1',
      projectId: 'workspace:1',
      text: 'hello',
      modelSelection: { provider_id: 'deepseek', model_id: 'deepseek-chat' },
    });

    expect(result.payload).toMatchObject({
      type: 'agent_run',
      session: {
        id: 'session:owner',
        title: 'Owner Session',
      },
      userMessage: {
        messageId: 'message:1',
        role: 'user',
        runId: 'run:1',
      },
    });
    expect(getSession).not.toHaveBeenCalled();
  });

  it.each([
    ['host_interaction_required', { interaction: { kind: 'status_panel' } }, 'host_interaction_request'],
    ['completed', { message: 'done' }, 'completed'],
    ['failed', { failure: { code: 'command_failed', message: 'bad command' } }, 'error'],
  ] as const)('maps %s without Desktop interpreting the result', async (status, extra, expectedType) => {
    const host = createHost(vi.fn(async () => ({
      status,
      request_id: 'request:1',
      ...extra,
    })));
    const result = await host.sendUserInput({
      requestId: 'request:1',
      projectId: 'workspace:1',
      text: '/command',
      modelSelection: { provider_id: 'deepseek', model_id: 'deepseek-chat' },
    });
    expect(result.payload.type).toBe(expectedType);
  });

  it('preserves Agent Run events for completed and failed send results', async () => {
    const completedEvent = runtimeEvent({
      eventId: 'event:completed',
      eventType: 'run.completed',
      payload: {},
    });
    const completedHost = createHost(vi.fn(async () => ({
      status: 'completed' as const,
      request_id: 'request:completed',
      message: 'done',
      events: [completedEvent],
    })));

    const completed = await completedHost.sendUserInput({
      requestId: 'request:completed',
      projectId: 'workspace:1',
      text: '/done',
      modelSelection: { provider_id: 'deepseek', model_id: 'deepseek-chat' },
    });

    expect(completed.payload).toMatchObject({ type: 'completed', message: 'done' });
    await expect(collectAsync(completed.events!)).resolves.toEqual([completedEvent]);

    const failedEvent = runtimeEvent({
      eventId: 'event:failed',
      eventType: 'run.failed',
      payload: { code: 'command_failed', message: 'bad command' },
    });
    const failedHost = createHost(vi.fn(async () => ({
      status: 'failed' as const,
      request_id: 'request:failed',
      failure: { code: 'command_failed' as const, message: 'bad command' },
      events: [failedEvent],
    })));

    const failed = await failedHost.sendUserInput({
      requestId: 'request:failed',
      projectId: 'workspace:1',
      text: '/fail',
      modelSelection: { provider_id: 'deepseek', model_id: 'deepseek-chat' },
    });

    expect(failed.payload).toMatchObject({ type: 'error', message: 'bad command' });
    await expect(collectAsync(failed.events!)).resolves.toEqual([failedEvent]);
  });

  it.each([
    [{ status: 'not_found' as const, run_id: 'run:missing' }, { status: 'not_found', runId: 'run:missing' }],
    [{
      status: 'not_cancellable' as const,
      reason: 'already_terminal' as const,
      run: agentRun({ run_id: 'run:done', status: 'completed', completed_at: '2026-07-10T00:01:00.000Z' }),
    }, { status: 'not_cancellable', reason: 'already_terminal' }],
    [{
      status: 'failed' as const,
      failure: { code: 'cancel_failed' as const, message: 'cannot cancel', retryable: true },
    }, { status: 'failed', failure: { code: 'cancel_failed', message: 'cannot cancel', retryable: true } }],
  ] as const)('projects cancel result %s', async (ownerResult, expectedPayload) => {
    const cancelRun = vi.fn(() => ownerResult);
    const host = createChatHost({
      agentRunService: { startRun: vi.fn(), cancelRun } as never,
      commandService: { getCommandSuggestions: vi.fn() } as never,
      sessionService: { createSession: vi.fn(), getSession: vi.fn() } as never,
      branchService: createSessionBranchService(),
      workspaceService: { listWorkspaces: vi.fn(async () => ({ workspaces: [] })) },
      sessionTimelineQuery: { listSessionTimeline: vi.fn() as never },
      contextService: unavailableContextService,
    });

    await expect(host.cancelUserInput({ runId: 'run:1' })).resolves.toMatchObject({
      payload: expectedPayload,
    });
  });

  it('projects explicit assistant-message branch draft references from the Session owner', async () => {
    const branch = createSessionBranchService({
      ids: {
        branchMarkerId: () => 'branch:owner-1',
        eventId: () => 'event:owner-1',
      },
      clock: { now: () => '2026-07-10T00:00:00.000Z' },
    });
    const host = createHost(vi.fn(), vi.fn(), {}, branch);
    const created = host.createBranchDraft({
      requestId: 'request:branch',
      sessionId: 'session:1',
      messageId: 'assistant-message:1',
    });
    expect(created.payload.branchDraft).toEqual({
      branchMarkerId: 'branch:owner-1',
      sessionId: 'session:1',
      sourceMessageId: 'assistant-message:1',
      createdAt: '2026-07-10T00:00:00.000Z',
    });
    const cancelled = host.cancelBranchDraft({
      requestId: 'request:cancel',
      sessionId: 'session:1',
      branchMarkerId: created.payload.branchDraft.branchMarkerId,
    });
    expect(cancelled.payload).toEqual({ cancelled: true });
    expect(cancelled.events).toBeDefined();
  });

  it('projects internal command completion into display and submit values', async () => {
    const host = createHost(vi.fn(), vi.fn(async () => ({
      type: 'suggestions',
      draft_input: '/te',
      command_prefix: 'te',
      groups: [{
        id: 'skills',
        label: 'Skills',
        items: [{
          name: 'test',
          description: 'Run checks',
          source: { kind: 'skill', skill_id: 'checks:test' },
          display: { primary: 'test', secondary: 'checks:test - Run checks' },
          match: { field: 'name', value: 'test', prefix: 'te' },
          completion: { replacement_input: '/skill checks:test ' },
        }],
      }],
    })));
    const result = await host.getCommandSuggestions({ draft_input: '/te' });
    expect(result.suggestions).toMatchObject({
      groups: [{ items: [{ displayInput: '/test ', submitInput: '/skill checks:test ' }] }],
    });
    expect(JSON.stringify(result)).not.toContain('replacement_input');
  });

  it('hydrates a session view with only active-path runs and run events', async () => {
    const message: TimelineMessage = {
      messageId: 'message-1',
      role: 'user',
      projectId: 'project-1',
      sessionId: 'session-1',
      runId: 'run-a',
      createdAt: '2026-07-10T01:00:00.000Z',
      blocks: [{
        blockId: 'user-text-1',
        kind: 'user_text',
        text: 'hello',
        format: 'plain',
      }],
    };
    const runA: AgentRun = {
      run_id: 'run-a',
      workspace_id: 'project-1',
      session_id: 'session-1',
      model_selection: { provider_id: 'deepseek', model_id: 'deepseek-chat' },
      trigger: { type: 'user_input', user_message_id: 'message-1' },
      status: 'completed',
      created_at: '2026-07-10T01:00:01.000Z',
      completed_at: '2026-07-10T01:00:02.000Z',
    };
    const runB: AgentRun = {
      run_id: 'run-b',
      workspace_id: 'project-1',
      session_id: 'session-1',
      model_selection: { provider_id: 'deepseek', model_id: 'deepseek-chat' },
      trigger: { type: 'user_input', user_message_id: 'message-2' },
      status: 'running',
      created_at: '2026-07-10T01:00:03.000Z',
    };
    const eventsByRun: Record<string, RuntimeEvent[]> = {
      'run-a': [{
        eventId: 'event-a',
        schemaVersion: 1,
        eventType: 'run.completed',
        runId: 'run-a',
        sessionId: 'session-1',
        sequence: 1,
        createdAt: '2026-07-10T01:00:02.000Z',
        source: 'core',
        visibility: 'user',
        persist: 'required',
        payload: {},
      }],
      'run-b': [{
        eventId: 'event-b',
        schemaVersion: 1,
        eventType: 'run.started',
        runId: 'run-b',
        sessionId: 'session-1',
        sequence: 1,
        createdAt: '2026-07-10T01:00:03.000Z',
        source: 'core',
        visibility: 'user',
        persist: 'required',
        payload: { runKind: 'agent' },
      }],
    };
    const listSessionTimeline = vi.fn(() => ({ messages: [message], diagnostics: [] }));
    const listRunsBySession = vi.fn(() => [runA, runB]);
    const listRuntimeEventsByRun = vi.fn((runId: string) =>
      eventsByRun[runId as keyof typeof eventsByRun] ?? []);
    const host = createChatHost({
      agentRunService: { startRun: vi.fn(), cancelRun: vi.fn() } as never,
      commandService: { getCommandSuggestions: vi.fn() } as never,
      sessionService: { getSession: vi.fn(() => ({ status: 'not_found' })) } as never,
      branchService: createSessionBranchService(),
      workspaceService: { listWorkspaces: vi.fn(async () => ({ workspaces: [] })) },
      sessionTimelineQuery: { listSessionTimeline },
      contextService: unavailableContextService,
    });

    await expect(host.getSessionHydration({
      projectId: 'project-1',
      sessionId: 'session-1',
    })).resolves.toEqual({
      messages: [message],
      diagnostics: [],
      runs: [],
      runtimeEvents: [],
    });

    expect(listSessionTimeline).toHaveBeenCalledWith({
      workspace_id: 'project-1',
      session_id: 'session-1',
    });
    expect(listRunsBySession).not.toHaveBeenCalled();
    expect(listRuntimeEventsByRun).not.toHaveBeenCalled();
  });
});

function createHost(
  startRun: ReturnType<typeof vi.fn>,
  getCommandSuggestions: ReturnType<typeof vi.fn> = vi.fn(),
  sessionOverrides: Partial<SessionService> = {},
  branchService = createSessionBranchService(),
) {
  return createChatHost({
    agentRunService: { startRun, cancelRun: vi.fn() } as never,
    commandService: { getCommandSuggestions } as never,
    sessionService: {
      createSession: vi.fn(),
      getSession: vi.fn(() => ({ status: 'not_found' })),
      ...sessionOverrides,
    } as never,
    branchService,
    workspaceService: { listWorkspaces: vi.fn(async () => ({ workspaces: [] })) },
    sessionTimelineQuery: { listSessionTimeline: vi.fn() as never },
    contextService: unavailableContextService,
  });
}

async function collectAsync<T>(events: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const event of events) result.push(event);
  return result;
}

function runtimeEvent(input: {
  eventId: string;
  eventType: RuntimeEvent['eventType'];
  payload: RuntimeEvent['payload'];
}): RuntimeEvent {
  return {
    eventId: input.eventId,
    schemaVersion: 1,
    eventType: input.eventType,
    runId: 'run:1',
    sessionId: 'session:1',
    sequence: 1,
    createdAt: '2026-07-10T00:00:00.000Z',
    source: 'core',
    visibility: 'user',
    persist: 'required',
    payload: input.payload,
  } as RuntimeEvent;
}

function agentRun(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    run_id: 'run:1',
    workspace_id: 'workspace:1',
    session_id: 'session:1',
    model_selection: { provider_id: 'deepseek', model_id: 'deepseek-chat' },
    trigger: { type: 'user_input', user_message_id: 'message:1' },
    status: 'running',
    created_at: '2026-07-10T00:00:00.000Z',
    ...overrides,
  };
}
