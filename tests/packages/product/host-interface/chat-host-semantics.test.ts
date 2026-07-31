/*
 * Protects Product-owned Chat orchestration around Input, Commands, Session,
 * model resolution, branch drafts, and the Engine boundary.
 */
import { describe, expect, it, vi } from 'vitest';
import type { RuntimeEvent } from '@megumi/agent/events';
import type { Run } from '@megumi/engine';
import { createSessionBranchService, type SessionService } from '@megumi/agent/session';
import { createChatHost } from '@megumi/product/host-interface/chat-host';

const model = {
  id: 'deepseek-chat',
  name: 'DeepSeek Chat',
  provider: 'deepseek',
  api: 'openai-responses',
  contextWindow: 128_000,
} as never;

const unavailableContextService = {
  getSessionUsageSnapshot: () => ({ status: 'not_available' as const }),
};

describe('ChatHost product semantics', () => {
  it('delegates explicit session creation and owner failures to Session', async () => {
    const createSession = vi.fn(() => ({
      status: 'created' as const,
      session: sessionFixture({ session_id: 'session:created', title: 'Planning' }),
    }));
    const host = createHost({ sessionService: { createSession } as never }).host;

    await expect(host.createSession({
      projectId: 'workspace:1',
      title: 'Planning',
    })).resolves.toMatchObject({
      status: 'created',
      session: { id: 'session:created', projectId: 'workspace:1', title: 'Planning' },
    });
    expect(createSession).toHaveBeenCalledWith({
      workspace_id: 'workspace:1',
      title: 'Planning',
    });

    const failed = createHost({
      sessionService: {
        createSession: vi.fn(() => ({
          status: 'failed',
          failure: { code: 'session_repository_error', message: 'Session store failed.' },
        })),
      } as never,
    }).host;
    await expect(failed.createSession({ projectId: 'workspace:1' })).resolves.toEqual({
      status: 'failed',
      failure: { code: 'session_repository_error', message: 'Session store failed.' },
    });
  });

  it('normalizes input, creates a Session, resolves a Model, then starts Engine', async () => {
    const processUserInput = vi.fn(async () => ({
      status: 'ok' as const,
      parsed_user_input: {
        type: 'message' as const,
        text: 'normalized',
        attachments: [],
      },
    }));
    const createSession = vi.fn(() => ({
      status: 'created' as const,
      session: sessionFixture({ session_id: 'session:new' }),
    }));
    const resolveModel = vi.fn(async () => ({ status: 'ok' as const, model }));
    const startRun = vi.fn(async (request) => startedResult(request));
    const { host } = createHost({
      processUserInput,
      sessionService: { createSession } as never,
      resolveModel,
      startRun,
    });

    const result = await host.sendUserInput({
      requestId: 'request:1',
      projectId: 'workspace:1',
      text: ' raw ',
      modelSelection: { provider_id: 'deepseek', model_id: 'deepseek-chat' },
    });

    expect(processUserInput).toHaveBeenCalledWith({
      user_input: { text: ' raw ' },
    });
    expect(createSession).toHaveBeenCalledWith({
      workspace_id: 'workspace:1',
      initial_user_text: ' raw ',
    });
    expect(resolveModel).toHaveBeenCalledWith({
      provider_id: 'deepseek',
      model_id: 'deepseek-chat',
    });
    expect(startRun).toHaveBeenCalledWith({
      requestId: 'request:1',
      workspaceId: 'workspace:1',
      sessionId: 'session:new',
      input: { type: 'message', text: 'normalized', attachments: [] },
      model,
      permissionMode: 'ask',
    });
    expect(result.payload).toMatchObject({
      type: 'agent_run',
      requestId: 'request:1',
      session: { id: 'session:new' },
      userMessageId: 'message:1',
      run: { runId: 'run:1', status: 'running' },
    });
    await expect(collectAsync(result.events!)).resolves.toEqual([
      expect.objectContaining({ eventType: 'run.started' }),
    ]);
  });

  it('resolves a branch parent before start and commits the draft only after Engine starts', async () => {
    const getSession = vi.fn(() => ({
      status: 'found' as const,
      session: sessionFixture({ session_id: 'session:existing' }),
    }));
    const resolveBranchDraft = vi.fn(() => ({
      status: 'resolved' as const,
      branch_draft: {
        branch_marker_id: 'branch:1',
        session_id: 'session:existing',
        source_message_id: 'message:source',
        source_entry_id: 'entry:source',
        created_at: '2026-07-10T00:00:00.000Z',
      },
    }));
    const commitBranchDraft = vi.fn(() => ({
      status: 'committed' as const,
      branch_draft: resolveBranchDraft().branch_draft,
    }));
    const startRun = vi.fn(async (request) => startedResult(request));
    const { host } = createHost({
      sessionService: { getSession } as never,
      branchService: {
        createBranchDraft: vi.fn(),
        cancelBranchDraft: vi.fn(),
        resolveBranchDraft,
        commitBranchDraft,
      } as never,
      startRun,
    });

    await host.sendUserInput({
      requestId: 'request:branch',
      projectId: 'workspace:1',
      sessionId: 'session:existing',
      branchMarkerId: 'branch:1',
      text: 'continue',
      modelSelection: { provider_id: 'deepseek', model_id: 'deepseek-chat' },
    });

    expect(getSession).toHaveBeenCalledWith({ session_id: 'session:existing' });
    expect(resolveBranchDraft).toHaveBeenCalledWith({
      request_id: 'request:branch',
      session_id: 'session:existing',
      branch_marker_id: 'branch:1',
    });
    expect(startRun).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session:existing',
      parentEntryId: 'entry:source',
    }));
    expect(commitBranchDraft).toHaveBeenCalledWith({
      request_id: 'request:branch',
      session_id: 'session:existing',
      branch_marker_id: 'branch:1',
    });
  });

  it('preserves an active branch draft when Engine rejects the start as session busy', async () => {
    const branchService = createSessionBranchService({
      ids: {
        branchMarkerId: () => 'branch:busy',
        eventId: () => 'event:branch',
      },
    });
    branchService.createBranchDraft({
      request_id: 'request:draft',
      session_id: 'session:1',
      source_message_id: 'message:source',
    });
    const { host } = createHost({
      branchService,
      startRun: vi.fn(async () => ({
        status: 'session_busy',
        activeRun: runFixture(),
      })),
    });

    await host.sendUserInput({
      requestId: 'request:busy',
      projectId: 'workspace:1',
      sessionId: 'session:1',
      branchMarkerId: 'branch:busy',
      text: 'continue',
      modelSelection: { provider_id: 'deepseek', model_id: 'deepseek-chat' },
    });

    expect(branchService.resolveBranchDraft({
      request_id: 'request:retry',
      session_id: 'session:1',
      branch_marker_id: 'branch:busy',
    }).status).toBe('resolved');
  });

  it('rejects a Session owned by another Workspace before starting Engine', async () => {
    const startRun = vi.fn();
    const { host } = createHost({
      startRun,
      sessionService: {
        getSession: vi.fn(() => ({
          status: 'found',
          session: sessionFixture({
            session_id: 'session:other-workspace',
            workspace_id: 'workspace:other',
          }),
        })),
      } as never,
    });

    await expect(host.sendUserInput({
      requestId: 'request:mismatch',
      projectId: 'workspace:1',
      sessionId: 'session:other-workspace',
      text: 'hello',
      modelSelection: { provider_id: 'deepseek', model_id: 'deepseek-chat' },
    })).resolves.toMatchObject({
      payload: {
        type: 'error',
        message: 'Session does not belong to the requested Workspace.',
      },
    });
    expect(startRun).not.toHaveBeenCalled();
  });

  it.each([
    [
      { type: 'host_interaction_request' as const, request: { kind: 'status_panel' } },
      'host_interaction_request',
    ],
    [{ type: 'completed' as const, message: 'done' }, 'completed'],
    [{ type: 'error' as const, message: 'bad command' }, 'error'],
  ])('returns direct Command result %s without starting Engine', async (commandResult, expectedType) => {
    const startRun = vi.fn();
    const handleCommandInput = vi.fn(async () => commandResult);
    const createSession = vi.fn();
    const { host } = createHost({
      startRun,
      handleCommandInput,
      sessionService: { createSession } as never,
    });

    const result = await host.sendUserInput({
      requestId: 'request:command',
      projectId: 'workspace:1',
      text: '/command',
      modelSelection: { provider_id: 'deepseek', model_id: 'deepseek-chat' },
    });

    expect(result.payload.type).toBe(expectedType);
    expect(handleCommandInput).toHaveBeenCalledWith(expect.objectContaining({
      raw_input: '/command',
      execution_context: expect.objectContaining({
        workspace_id: 'workspace:1',
      }),
    }));
    expect(createSession).not.toHaveBeenCalled();
    expect(startRun).not.toHaveBeenCalled();
  });

  it('routes an Agent Command to Engine with its requested Skill', async () => {
    const selectedSkill = {
      type: 'skill' as const,
      name: 'research',
      skillPath: 'C:/skills/research/SKILL.md',
    };
    const handleCommandInput = vi.fn(async () => ({
      type: 'agent_run' as const,
      input: {
        raw_input: '/research topic',
        requestedSkill: selectedSkill,
        command: {
          name: 'research',
          source: { kind: 'skill' as const, name: 'research', skillPath: selectedSkill.skillPath },
          arguments_input: 'topic',
        },
      },
    }));
    const startRun = vi.fn(async (request) => startedResult(request));
    const { host } = createHost({ handleCommandInput, startRun });

    await host.sendUserInput({
      requestId: 'request:skill',
      projectId: 'workspace:1',
      text: '/research topic',
      modelSelection: { provider_id: 'deepseek', model_id: 'deepseek-chat' },
    });

    expect(startRun).toHaveBeenCalledWith(expect.objectContaining({
      input: { type: 'message', text: '/research topic', attachments: [] },
      selectedSkill,
    }));
  });

  it('does not start Engine when model resolution fails', async () => {
    const startRun = vi.fn();
    const { host } = createHost({
      startRun,
      resolveModel: vi.fn(async () => ({
        status: 'failed',
        failure: { code: 'model_unavailable', message: 'Model is unavailable.' },
      })),
    });

    await expect(host.sendUserInput({
      requestId: 'request:model-failed',
      projectId: 'workspace:1',
      text: 'hello',
      modelSelection: { provider_id: 'missing', model_id: 'missing' },
    })).resolves.toMatchObject({
      payload: { type: 'error', message: 'Model is unavailable.' },
    });
    expect(startRun).not.toHaveBeenCalled();
  });

  it.each([
    [
      { status: 'not_found' as const, runId: 'run:missing' },
      { status: 'not_found', runId: 'run:missing' },
    ],
    [
      { status: 'already_cancelling' as const, run: runFixture({ status: 'cancelling' }) },
      { status: 'cancelling', run: { status: 'cancelling' } },
    ],
    [
      { status: 'already_terminal' as const, run: runFixture({ status: 'completed' }) },
      { status: 'not_cancellable', reason: 'already_terminal' },
    ],
  ])('projects Engine cancellation result %s', async (ownerResult, expectedPayload) => {
    const { host } = createHost({
      cancelRun: vi.fn(async () => ownerResult) as never,
    });
    await expect(host.cancelUserInput({ runId: 'run:1' })).resolves.toMatchObject({
      payload: expectedPayload,
    });
  });

  it('returns cancellation events for a newly requested cancellation', async () => {
    const event = runtimeEvent('run.cancel.requested');
    const { host } = createHost({
      cancelRun: vi.fn(async () => ({
        status: 'cancellation_requested',
        run: runFixture({ status: 'cancelling' }),
        events: asyncEvents([event]),
      })) as never,
    });

    const result = await host.cancelUserInput({ runId: 'run:1' });
    expect(result.payload).toEqual({
      status: 'cancellation_requested',
      run: expect.objectContaining({ runId: 'run:1', status: 'cancelling' }),
    });
    await expect(collectAsync(result.events!)).resolves.toEqual([event]);
  });

  it('hydrates bounded Run and Event facts from the injected Product read model', async () => {
    const message = {
      messageId: 'message:1',
      role: 'user' as const,
      projectId: 'workspace:1',
      sessionId: 'session:1',
      runId: 'run:1',
      createdAt: '2026-07-10T00:00:00.000Z',
      blocks: [{
        blockId: 'block:1',
        kind: 'user_text' as const,
        text: 'hello',
        format: 'plain' as const,
      }],
    };
    const listSessionTimeline = vi.fn(() => ({ messages: [message], diagnostics: [] }));
    const run = runFixture({ sessionId: 'session:1', status: 'waiting' });
    const event = runtimeEvent('run.waiting');
    const { host } = createHost({
      listSessionTimeline,
      runReadModel: {
        listRunsBySession: () => [run],
        listEventsByRun: () => [event],
      },
    });

    await expect(host.listRuns({ sessionId: 'session:1' })).resolves.toEqual({
      runs: [expect.objectContaining({ runId: 'run:1', status: 'waiting' })],
    });
    await expect(host.listRunEvents({ runId: 'run:1' })).resolves.toEqual({ events: [event] });
    await expect(host.getSessionHydration({
      projectId: 'workspace:1',
      sessionId: 'session:1',
    })).resolves.toEqual({
      messages: [message],
      diagnostics: [],
      runs: [expect.objectContaining({ runId: 'run:1', status: 'waiting' })],
      runtimeEvents: [event],
    });
  });

  it('projects branch draft lifecycle and Command suggestions', async () => {
    const branchService = createSessionBranchService({
      ids: {
        branchMarkerId: () => 'branch:1',
        eventId: () => 'event:1',
      },
      clock: { now: () => '2026-07-10T00:00:00.000Z' },
    });
    const getCommandSuggestions = vi.fn(async () => ({
      type: 'suggestions' as const,
      draft_input: '/te',
      command_prefix: 'te',
      groups: [{
        id: 'skills',
        label: 'Skills',
        items: [{
          name: 'test',
          description: 'Run checks',
          source: { kind: 'skill' as const, name: 'test', skillPath: 'C:/skills/test/SKILL.md' },
          display: { primary: 'test', secondary: 'Run checks' },
          match: { field: 'name' as const, value: 'test', prefix: 'te' },
          completion: {
            replacement_input: '',
            selection: {
              type: 'skill' as const,
              name: 'test',
              skillPath: 'C:/skills/test/SKILL.md',
            },
          },
        }],
      }],
    }));
    const { host } = createHost({ branchService, getCommandSuggestions });

    const created = host.createBranchDraft({
      requestId: 'request:branch',
      sessionId: 'session:1',
      messageId: 'message:source',
    });
    expect(created.payload.branchDraft).toEqual({
      branchMarkerId: 'branch:1',
      sessionId: 'session:1',
      sourceMessageId: 'message:source',
      createdAt: '2026-07-10T00:00:00.000Z',
    });
    expect(host.cancelBranchDraft({
      requestId: 'request:cancel',
      sessionId: 'session:1',
      branchMarkerId: 'branch:1',
    }).payload).toEqual({ cancelled: true });

    const suggestions = await host.getCommandSuggestions({ draft_input: '/te' });
    expect(suggestions.suggestions).toMatchObject({
      groups: [{
        items: [{
          displayInput: '/test ',
          submitInput: '',
          selection: { type: 'skill', name: 'test' },
        }],
      }],
    });
    expect(JSON.stringify(suggestions)).not.toContain('replacement_input');
  });
});

function createHost(overrides: {
  startRun?: ReturnType<typeof vi.fn>;
  cancelRun?: ReturnType<typeof vi.fn>;
  processUserInput?: ReturnType<typeof vi.fn>;
  handleCommandInput?: ReturnType<typeof vi.fn>;
  getCommandSuggestions?: ReturnType<typeof vi.fn>;
  sessionService?: Partial<SessionService>;
  branchService?: ReturnType<typeof createSessionBranchService>;
  resolveModel?: ReturnType<typeof vi.fn>;
  listSessionTimeline?: ReturnType<typeof vi.fn>;
  runReadModel?: {
    listRunsBySession(sessionId: string): readonly Run[];
    listEventsByRun(runId: string): readonly RuntimeEvent[];
  };
} = {}) {
  const defaultSession = sessionFixture();
  const startRun = overrides.startRun ?? vi.fn(async (request) => startedResult(request));
  return {
    host: createChatHost({
      runReadModel: overrides.runReadModel
        ?? { listRunsBySession: () => [], listEventsByRun: () => [] },
      engine: {
        startRun,
        cancelRun: overrides.cancelRun ?? vi.fn(async ({ runId }) => ({ status: 'not_found', runId })),
      } as never,
      inputService: {
        processUserInput: overrides.processUserInput ?? vi.fn(async ({ user_input }) => ({
          status: 'ok',
          parsed_user_input: user_input.text.startsWith('/')
            ? { type: 'command', text: user_input.text }
            : { type: 'message', text: user_input.text, attachments: [] },
        })),
      } as never,
      commandService: {
        getCommandSuggestions: overrides.getCommandSuggestions ?? vi.fn(async () => ({ type: 'inactive' })),
        handleCommandInput: overrides.handleCommandInput
          ?? vi.fn(async ({ raw_input }) => ({ type: 'not_command', raw_input })),
      } as never,
      sessionService: {
        createSession: vi.fn(() => ({ status: 'created', session: defaultSession })),
        getSession: vi.fn(() => ({ status: 'found', session: defaultSession })),
        listSessions: vi.fn(() => ({ status: 'ok', sessions: [] })),
        ...overrides.sessionService,
      } as never,
      workspaceService: { listWorkspaces: vi.fn(async () => ({ workspaces: [] })) },
      branchService: overrides.branchService ?? createSessionBranchService(),
      sessionTimelineQuery: {
        listSessionTimeline: overrides.listSessionTimeline
          ?? vi.fn(() => ({ messages: [], diagnostics: [] })),
      } as never,
      contextService: unavailableContextService,
      createSkillService: vi.fn(() => ({ listSkills: vi.fn() })) as never,
      resolveModel: (overrides.resolveModel
        ?? vi.fn(async () => ({ status: 'ok', model }))) as never,
    }),
    startRun,
  };
}

function sessionFixture(overrides: Record<string, unknown> = {}) {
  return {
    session_id: 'session:1',
    workspace_id: 'workspace:1',
    title: 'Session',
    status: 'active' as const,
    created_at: '2026-07-10T00:00:00.000Z',
    updated_at: '2026-07-10T00:00:00.000Z',
    ...overrides,
  };
}

function runFixture(overrides: Record<string, unknown> = {}) {
  return {
    runId: 'run:1',
    requestId: 'request:1',
    workspaceId: 'workspace:1',
    sessionId: 'session:1',
    userMessageId: 'message:1',
    model,
    permissionMode: 'ask',
    status: 'running',
    createdAt: '2026-07-10T00:00:00.000Z',
    startedAt: '2026-07-10T00:00:00.000Z',
    ...overrides,
  } as never;
}

function startedResult(request: {
  requestId: string;
  workspaceId: string;
  sessionId: string;
  input: { text: string };
}) {
  return {
    status: 'started' as const,
    run: runFixture({
      requestId: request.requestId,
      workspaceId: request.workspaceId,
      sessionId: request.sessionId,
    }),
    userMessage: {
      message: {
        message_id: 'message:1',
        session_id: request.sessionId,
        run_id: 'run:1',
        message_kind: 'user_message' as const,
        content: [{ type: 'text' as const, text: request.input.text }],
        created_at: '2026-07-10T00:00:00.000Z',
      },
      attachments: [],
    },
    userEntry: {
      entry_id: 'entry:1',
      session_id: request.sessionId,
      source_type: 'message' as const,
      source_id: 'message:1',
      created_at: '2026-07-10T00:00:00.000Z',
    },
    events: asyncEvents([runtimeEvent('run.started')]),
  };
}

function runtimeEvent(eventType: RuntimeEvent['eventType']): RuntimeEvent {
  return {
    eventId: 'event:1',
    schemaVersion: 1,
    eventType,
    runId: 'run:1',
    sessionId: 'session:1',
    sequence: 1,
    createdAt: '2026-07-10T00:00:00.000Z',
    source: 'core',
    visibility: 'user',
    persist: 'transient',
    payload: eventType === 'run.started' ? { runKind: 'agent' } : {},
  } as RuntimeEvent;
}

async function* asyncEvents<T>(events: readonly T[]): AsyncIterable<T> {
  yield* events;
}

async function collectAsync<T>(events: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const event of events) result.push(event);
  return result;
}
