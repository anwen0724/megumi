// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createInputSubmission } from '../../../packages/product/src/input-submission';

describe('Product InputSubmission', () => {
  it('calls Input exactly once and does not create Session or Run for a completed result', async () => {
    const process = vi.fn(async () => ({ status: 'completed' as const, result: { type: 'completed' as const, message: 'done' } }));
    const createSession = vi.fn();
    const startRun = vi.fn();
    const submission = createInputSubmission({
      input: { process },
      sessions: { getSession: vi.fn(), createSession },
      branches: { resolveBranchDraft: vi.fn(), commitBranchDraft: vi.fn() },
      engine: { startRun },
      resolveModel: vi.fn(async () => ({ status: 'ok' as const, model: model() })),
    });

    const result = await submission.submit(request());

    expect(result.payload).toMatchObject({ type: 'completed', message: 'done' });
    expect(process).toHaveBeenCalledTimes(1);
    expect(createSession).not.toHaveBeenCalled();
    expect(startRun).not.toHaveBeenCalled();
  });

  it('resolves Model before Input and creates a new Session only after accepted', async () => {
    const order: string[] = [];
    const resolveModel = vi.fn(async () => { order.push('model'); return { status: 'ok' as const, model: model() }; });
    const process = vi.fn(async () => {
      order.push('input');
      return {
        status: 'accepted' as const,
        input: {
          displayContent: [{ type: 'text' as const, text: 'hello' }],
          modelContent: [{ type: 'text' as const, text: 'hello' }],
          attachments: [],
        },
      };
    });
    const createSession = vi.fn(() => {
      order.push('session');
      return { status: 'created' as const, session: session() };
    });
    const startRun = vi.fn(async () => {
      order.push('engine');
      return { status: 'failed' as const, failure: { code: 'internal_error' as const, message: 'stop after boundary check' } };
    });
    const submission = createInputSubmission({
      input: { process },
      sessions: { getSession: vi.fn(), createSession },
      branches: { resolveBranchDraft: vi.fn(), commitBranchDraft: vi.fn() },
      engine: { startRun },
      resolveModel,
    });

    await submission.submit(request());

    expect(order).toEqual(['model', 'input', 'session', 'engine']);
    expect(process).toHaveBeenCalledTimes(1);
  });

  it('forwards an explicit Skill selection into the raw input without any side channel', async () => {
    const skillSelection = { type: 'skill' as const, name: 'review', skillPath: 'C:/skills/review/SKILL.md' };
    const process = vi.fn(async () => ({
      status: 'accepted' as const,
      input: {
        displayContent: [{ type: 'text' as const, text: 'task' }],
        modelContent: [{ type: 'text' as const, text: 'expanded task' }],
        attachments: [],
        skillSelection,
      },
    }));
    const startRun = vi.fn(async () => ({
      status: 'started' as const,
      run: { runId: 'run:1', sessionId: 'session:1', status: 'running' as const, createdAt: 'now' },
      userMessage: {
        message: {
          message_id: 'm:1',
          session_id: 'session:1',
          run_id: 'run:1',
          message_kind: 'user_message' as const,
          display_content: [{ type: 'text' as const, text: 'task' }],
          model_content: [{ type: 'text' as const, text: 'expanded task' }],
          skill_selection: { name: 'review', skill_path: 'C:/skills/review/SKILL.md' },
          created_at: 'now',
          completed_at: 'now',
        },
        attachments: [],
      },
      userEntry: { entry_id: 'e:1' },
      events: { [Symbol.asyncIterator]: async function* () {} },
    }));
    const submission = createInputSubmission({
      input: { process },
      sessions: { getSession: vi.fn(), createSession: vi.fn(() => ({ status: 'created' as const, session: session() })) },
      branches: { resolveBranchDraft: vi.fn(() => ({ status: 'resolved' as const, branch_draft: { source_entry_id: undefined } })), commitBranchDraft: vi.fn() },
      engine: { startRun },
      resolveModel: vi.fn(async () => ({ status: 'ok' as const, model: model() })),
    });

    await submission.submit({ ...request(), skillSelection });

    expect(process).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ skillSelection }),
        context: expect.not.objectContaining({ selectedSkill: expect.anything() }),
      }),
    );
    expect(startRun).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({ skillSelection, modelContent: [{ type: 'text', text: 'expanded task' }] }),
    }));
    expect(startRun.mock.calls[0]?.[0]).not.toHaveProperty('selectedSkill');

    // The immediate submit response carries the structured selection so the
    // freshly saved message shows the Skill badge without a Timeline re-query.
    const response = await submission.submit({ ...request(), skillSelection });
    if (response.payload.type !== 'agent_run') throw new Error('Expected agent_run payload.');
    expect(response.payload.userMessage.skillSelection).toEqual({
      name: 'review',
      skillPath: 'C:/skills/review/SKILL.md',
    });
  });
});

function request() {
  return {
    projectId: 'workspace:1',
    text: 'hello',
    modelSelection: { provider_id: 'provider', model_id: 'model' },
    permissionMode: 'ask' as const,
  };
}

function model() {
  return {
    id: 'model', name: 'Model', api: 'openai-completions' as const, provider: 'provider', baseUrl: 'https://example.com',
    reasoning: false, input: ['text' as const], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 1000, maxTokens: 100,
  };
}

function session() {
  return {
    session_id: 'session:1', workspace_id: 'workspace:1', title: 'hello', status: 'active' as const,
    created_at: '2026-07-31T00:00:00.000Z', updated_at: '2026-07-31T00:00:00.000Z',
  };
}
