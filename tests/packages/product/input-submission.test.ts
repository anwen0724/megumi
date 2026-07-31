// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createInputSubmission } from '../../../packages/product/src/input-submission';

describe('Product InputSubmission', () => {
  it('calls Input exactly once and does not create Session or Run for a completed Command', async () => {
    const process = vi.fn(async () => ({ status: 'command_result' as const, result: { type: 'completed' as const, message: 'done' } }));
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
    const process = vi.fn(async () => { order.push('input'); return { status: 'accepted' as const, input: { text: 'hello', attachments: [] } }; });
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
