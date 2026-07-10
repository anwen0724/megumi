import { describe, expect, it, vi } from 'vitest';
import { createChatHost, createSessionBranchHost } from '@megumi/product/host-interface/chat-host';

describe('ChatHost product semantics', () => {
  it('owns request, title, and permission defaults', async () => {
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
      session: { type: 'new', title: 'New session' },
      permission_mode: 'default',
    }));
    expect(result.payload).toMatchObject({ type: 'completed', message: 'done' });
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

  it('creates and cancels opaque branch draft references', async () => {
    const branch = createSessionBranchHost();
    const created = branch.createBranchDraft({
      requestId: 'request:branch',
      sessionId: 'session:1',
      messageId: 'message:1',
      intent: 'branch',
      createdAt: '2026-07-10T00:00:00.000Z',
    });
    expect(created.payload.branchDraft.branchMarkerId).toMatch(/^branch:/);
    const cancelled = branch.cancelBranchDraft({
      requestId: 'request:cancel',
      sessionId: 'session:1',
      branchMarkerId: created.payload.branchDraft.branchMarkerId,
      createdAt: '2026-07-10T00:01:00.000Z',
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
});

function createHost(
  startRun: ReturnType<typeof vi.fn>,
  getCommandSuggestions: ReturnType<typeof vi.fn> = vi.fn(),
) {
  return createChatHost({
    agentRunService: { startRun, cancelRun: vi.fn() } as never,
    commandService: { getCommandSuggestions } as never,
    sessionService: {
      getSession: vi.fn(() => ({ status: 'not_found' })),
    } as never,
    branchService: createSessionBranchHost(),
    workspaceService: { listWorkspaces: vi.fn(async () => ({ workspaces: [] })) },
    sessionTimelineQuery: { listSessionTimeline: vi.fn() as never },
    agentRunQueries: { listRunsBySession: () => [], listRuntimeEventsByRun: () => [] },
  });
}
