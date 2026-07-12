/*
 * Verifies automatic and manual compaction lifecycle through ContextService.
 */
import { describe, expect, it, vi } from 'vitest';
import { ContextServiceImpl } from '@megumi/coding-agent/context/service/context-service-impl';
import type { ContextServiceDependencies } from '@megumi/coding-agent/context/service/context-service-impl';
import type { SessionHistoryItem } from '@megumi/coding-agent/session';

function completeHistory(): SessionHistoryItem[] {
  return [
    { type: 'message', entry: { entry_id: 'EU', session_id: 'S1', entry_type: 'message', message_id: 'MU', created_at: 'now' }, message: { message_id: 'MU', session_id: 'S1', run_id: 'R-old', role: 'user', content_text: 'old', created_at: 'now' }, attachments: [] },
    { type: 'message', entry: { entry_id: 'EA', session_id: 'S1', parent_entry_id: 'EU', entry_type: 'message', message_id: 'MA', created_at: 'now' }, message: { message_id: 'MA', session_id: 'S1', run_id: 'R-old', role: 'assistant', content_text: 'answer', created_at: 'now' }, attachments: [] },
  ];
}

function fixture(counts: number[]) {
  const queue = [...counts];
  const deps = {
    sessionService: {
      getActiveHistory: vi.fn(() => ({ status: 'ok', history: completeHistory() })),
      saveCompactionSummary: vi.fn(() => ({ status: 'saved', compaction: { compaction_id: 'C1', session_id: 'S1', summary_text: 'short', covered_until_entry_id: 'EA', created_at: 'now' } })),
    },
    runTranscriptQuery: { getRunTranscript: vi.fn(() => ({ status: 'found', transcript: { runId: 'R-old', items: [] } })) },
    instructionScopeResolver: { resolve: vi.fn(() => ({ status: 'resolved', workspaceRoot: '/w', workingDirectory: '/w' })) },
    instructionService: { getSystemInstructions: vi.fn(() => []), getEffectiveAgentInstructions: vi.fn(async () => ({ status: 'ok', instructions: { sources: [] } })) },
    skillService: { getSkillCatalog: vi.fn(async () => ({ status: 'ok', skills: [] })) },
    promptTokenCounter: { count: vi.fn(async () => ({ status: 'counted', inputTokens: queue.shift() ?? counts.at(-1) ?? 0, accuracy: 'estimated' })) },
    summaryModelCall: { complete: vi.fn(async () => ({ status: 'completed', content: 'short' })) },
    usageSnapshotCache: new Map(), ids: { preparationId: () => 'P1', compactionId: () => 'C1' }, clock: { now: () => 'now' },
  } as ContextServiceDependencies;
  return { deps, service: new ContextServiceImpl(deps) };
}

const modelContext = { providerId: 'p', modelId: 'm', contextWindowTokens: 100 };
const currentTurn = { runId: 'R-current', userEntry: { entryId: 'EC', parentEntryId: 'EA' }, userMessage: { type: 'user_message' as const, content: [{ type: 'text' as const, text: 'now' }] }, runItems: [] };
const request = { sessionId: 'S1', workspaceId: 'W1', currentTurn, activatedSkills: [], tools: [], modelContext };

describe('ContextServiceImpl compaction', () => {
  it('attempts automatic compaction once, persists only a reducing summary, and rebuilds usage', async () => {
    const { deps, service } = fixture([80, 5, 10, 30]);
    const result = await service.prepareModelCall(request);
    expect(deps.summaryModelCall.complete).toHaveBeenCalledTimes(1);
    expect(deps.sessionService.saveCompactionSummary).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: 'ready', prepared: { usage: { usedTokens: 30 }, compaction: { compactionId: 'C1' } } });
  });

  it('discards a non-reducing summary below the window and fails above the hard window', async () => {
    const below = fixture([80, 5, 10, 80]);
    expect(await below.service.prepareModelCall(request)).toMatchObject({ status: 'ready', prepared: { usage: { usedTokens: 80 } } });
    expect(below.deps.sessionService.saveCompactionSummary).not.toHaveBeenCalled();

    const hard = fixture([100, 5, 10, 100]);
    expect(await hard.service.prepareModelCall(request)).toMatchObject({ status: 'failed', failure: { code: 'context_window_exceeded' } });
  });

  it('fails the current prepare when summary generation or persistence fails without retrying', async () => {
    const generated = fixture([80, 5, 10]);
    generated.deps.summaryModelCall.complete = vi.fn(async () => ({ status: 'failed' as const, failure: { code: 'compaction_failed' as const, message: 'no summary', retryable: true, cause: { owner: 'ai' as const } } }));
    expect(await generated.service.prepareModelCall(request)).toMatchObject({ status: 'failed', failure: { code: 'compaction_failed' } });
    expect(generated.deps.sessionService.saveCompactionSummary).not.toHaveBeenCalled();

    const persisted = fixture([80, 5, 10, 30]);
    persisted.deps.sessionService.saveCompactionSummary = vi.fn(() => ({ status: 'failed' as const, failure: { code: 'active_entry_changed', message: 'stale head' } }));
    expect(await persisted.service.prepareModelCall(request)).toMatchObject({
      status: 'failed',
      failure: { code: 'compaction_persist_failed', cause: { owner: 'session', code: 'active_entry_changed' } },
    });
  });

  it('manual compact uses the same internals without a fake current turn', async () => {
    const { deps, service } = fixture([80, 0, 10, 25]);
    expect(await service.compactSession({ sessionId: 'S1', workspaceId: 'W1', modelContext })).toMatchObject({ status: 'compacted', usageBefore: { usedTokens: 80 }, usageAfter: { usedTokens: 25 } });
    expect(deps.promptTokenCounter.count).toHaveBeenCalledWith(expect.objectContaining({ prompt: expect.objectContaining({ conversation: expect.not.arrayContaining([expect.objectContaining({ type: 'user_message', content: [] })]) }) }));
  });

  it.each([
    ['automatic', '   '],
    ['manual', '\n\t'],
  ] as const)('rejects an empty %s compaction summary without persisting it', async (mode, content) => {
    const { deps, service } = fixture(mode === 'automatic' ? [80, 5, 10] : [80, 0, 10]);
    deps.summaryModelCall.complete = vi.fn(async () => ({ status: 'completed' as const, content }));

    const result = mode === 'automatic'
      ? await service.prepareModelCall(request)
      : await service.compactSession({ sessionId: 'S1', workspaceId: 'W1', modelContext });

    expect(result).toMatchObject({ status: 'failed', failure: { code: 'compaction_failed' } });
    expect(deps.sessionService.saveCompactionSummary).not.toHaveBeenCalled();
  });

  it('passes the loaded active head to Session when persisting a compaction', async () => {
    const { deps, service } = fixture([80, 5, 10, 30]);

    await service.prepareModelCall(request);

    expect(deps.sessionService.saveCompactionSummary).toHaveBeenCalledWith(expect.objectContaining({
      expected_active_entry_id: 'EC',
    }));
  });

  it('does not persist when cancellation arrives after an owner count or summary await', async () => {
    const countController = new AbortController();
    const afterCount = fixture([80, 5, 10]);
    afterCount.deps.promptTokenCounter.count = vi.fn(async () => {
      countController.abort();
      return { status: 'counted' as const, inputTokens: 80, accuracy: 'estimated' as const };
    });
    expect(await afterCount.service.prepareModelCall({ ...request, signal: countController.signal })).toMatchObject({
      status: 'failed', failure: { code: 'cancelled' },
    });
    expect(afterCount.deps.summaryModelCall.complete).not.toHaveBeenCalled();

    const summaryController = new AbortController();
    const afterSummary = fixture([80, 5, 10, 30]);
    afterSummary.deps.summaryModelCall.complete = vi.fn(async () => {
      summaryController.abort();
      return { status: 'completed' as const, content: 'short' };
    });
    expect(await afterSummary.service.prepareModelCall({ ...request, signal: summaryController.signal })).toMatchObject({
      status: 'failed', failure: { code: 'cancelled' },
    });
    expect(afterSummary.deps.sessionService.saveCompactionSummary).not.toHaveBeenCalled();
  });

  it('serializes compaction work for the same session within one ContextService', async () => {
    let releaseFirst!: () => void;
    const firstSummary = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const { deps, service } = fixture([80, 0, 10, 25, 80, 0, 10, 25]);
    deps.summaryModelCall.complete = vi.fn()
      .mockImplementationOnce(async () => {
        await firstSummary;
        return { status: 'completed' as const, content: 'first' };
      })
      .mockResolvedValueOnce({ status: 'completed' as const, content: 'second' });

    const first = service.compactSession({ sessionId: 'S1', workspaceId: 'W1', modelContext });
    const second = service.compactSession({ sessionId: 'S1', workspaceId: 'W1', modelContext });
    await vi.waitFor(() => expect(deps.summaryModelCall.complete).toHaveBeenCalledTimes(1));
    releaseFirst();

    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(deps.summaryModelCall.complete).toHaveBeenCalledTimes(2);
  });
});
