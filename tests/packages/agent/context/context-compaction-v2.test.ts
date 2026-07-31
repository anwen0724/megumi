/*
 * Verifies automatic and manual compaction lifecycle through ContextService.
 */
import { describe, expect, it, vi } from 'vitest';
import { ContextServiceImpl } from '@megumi/agent/context/service/context-service-impl';
import type { ContextServiceDependencies } from '@megumi/agent/context/service/context-service-impl';
import type { SessionHistoryItem } from '@megumi/agent/session';
import type { Api, AssistantMessage, Model } from '@megumi/ai';

const model: Model<Api> = {
  id: 'm',
  name: 'Model',
  api: 'openai-completions',
  provider: 'p',
  baseUrl: 'https://api.example.com/v1',
  reasoning: false,
  input: ['text', 'image'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 100,
  maxTokens: 20,
};

function summaryMessage(content = 'short'): AssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text: content }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'stop',
    timestamp: 0,
  };
}

function completeHistory(turnCount = 1): SessionHistoryItem[] {
  return Array.from({ length: turnCount }, (_, index) => {
    const number = index + 1;
    const runId = `R-old-${number}`;
    const userEntryId = `EU-${number}`;
    const assistantEntryId = `EA-${number}`;
    return [
      { type: 'message' as const, entry: { entry_id: userEntryId, session_id: 'S1', ...(index > 0 ? { parent_entry_id: `EA-${index}` } : {}), entry_type: 'message' as const, message_id: `MU-${number}`, created_at: 'now' }, message: { message_id: `MU-${number}`, session_id: 'S1', run_id: runId, message_kind: 'user_message' as const, content: [{ type: 'text' as const, text: `old-${number}` }], created_at: 'now' }, attachments: [] },
      { type: 'message' as const, entry: { entry_id: assistantEntryId, session_id: 'S1', parent_entry_id: userEntryId, entry_type: 'message' as const, message_id: `MA-${number}`, created_at: 'now' }, message: { message_id: `MA-${number}`, session_id: 'S1', run_id: runId, message_kind: 'assistant_reply' as const, status: 'completed' as const, reason_code: 'normal_completion' as const, content: [{ type: 'text' as const, text: `answer-${number}` }], created_at: 'now', completed_at: 'now' }, attachments: [] },
    ];
  }).flat();
}

function historyWithSummary(turnCount: number): SessionHistoryItem[] {
  return [
    {
      type: 'compaction',
      entry: { entry_id: 'E-summary-old', session_id: 'S1', entry_type: 'compaction', compaction_id: 'C-old', created_at: 'now' },
      compaction: { compaction_id: 'C-old', session_id: 'S1', summary_text: 'previous rolling summary', covered_until_entry_id: 'EA-old', created_at: 'now' },
    },
    ...completeHistory(turnCount),
  ];
}

function fixture(counts: number[], options: { history?: SessionHistoryItem[]; historyCount?: number; useDefaultPolicy?: boolean } = {}) {
  const queue = [...counts];
  const deps = {
    sessionService: {
      readAttachmentContent: vi.fn(async () => ({ status: 'failed' as const, failure: { code: 'attachment_not_found', message: 'not found' } })),
      getActiveHistory: vi.fn(() => ({ status: 'ok', history: options.history ?? completeHistory(options.historyCount) })),
      saveCompactionSummary: vi.fn(() => ({ status: 'saved', compaction: { compaction_id: 'C1', session_id: 'S1', summary_text: 'short', covered_until_entry_id: 'EA', created_at: 'now' } })),
    },
    instructionScopeResolver: { resolve: vi.fn(() => ({ status: 'resolved', workspaceRoot: '/w', workingDirectory: '/w' })) },
    instructionService: { getSystemInstructions: vi.fn(() => []), getEffectiveAgentInstructions: vi.fn(async () => ({ status: 'ok', instructions: { sources: [] } })) },
    contextTokenEstimator: vi.fn(() => queue.shift() ?? counts.at(-1) ?? 0),
    models: { completeSimple: vi.fn(async () => summaryMessage()) },
    usageSnapshotCache: new Map(), ids: { preparationId: () => 'P1', compactionId: () => 'C1' }, clock: { now: () => 'now' },
    ...(options.useDefaultPolicy ? {} : { policy: { keepRecentRuns: 0 } }),
  } as ContextServiceDependencies;
  return { deps, service: new ContextServiceImpl(deps) };
}

const currentRun = { runId: 'R-current', userEntry: { entryId: 'EC', parentEntryId: 'EA' }, userMessage: { type: 'user_message' as const, content: [{ type: 'text' as const, text: 'now' }] }, runItems: [] };
const request = { sessionId: 'S1', workspaceId: 'W1', currentRun, tools: [], model };

describe('ContextServiceImpl compaction', () => {
  it('defaults to retaining three completed Runs and summarizes every older Run', async () => {
    const retainedOnly = fixture([80], { historyCount: 3, useDefaultPolicy: true });
    expect(await retainedOnly.service.build(request)).toMatchObject({ status: 'ready' });
    expect(retainedOnly.deps.models.completeSimple).not.toHaveBeenCalled();

    const withOlderHistory = fixture([80, 30, 30], { historyCount: 4, useDefaultPolicy: true });
    expect(await withOlderHistory.service.build(request)).toMatchObject({ status: 'ready' });
    expect(withOlderHistory.deps.models.completeSimple).toHaveBeenCalledTimes(1);
    expect(withOlderHistory.deps.sessionService.saveCompactionSummary).toHaveBeenCalledWith(expect.objectContaining({
      covered_until_entry_id: 'EA-1',
      first_kept_entry_id: 'EU-2',
    }));
    const summaryContext = vi.mocked(withOlderHistory.deps.models.completeSimple).mock.calls[0][1];
    expect(JSON.stringify(summaryContext)).toContain('old-1');
    expect(JSON.stringify(summaryContext)).not.toContain('old-2');
  });

  it('replaces the rolling Summary with the old Summary plus only Runs older than the retained three', async () => {
    const { deps, service } = fixture([80, 30, 30], {
      history: historyWithSummary(4),
      useDefaultPolicy: true,
    });

    expect(await service.build(request)).toMatchObject({ status: 'ready' });
    expect(deps.models.completeSimple).toHaveBeenCalledTimes(1);
    const summaryPrompt = JSON.stringify(vi.mocked(deps.models.completeSimple).mock.calls[0][1]);
    expect(summaryPrompt).toContain('previous rolling summary');
    expect(summaryPrompt).toContain('old-1');
    expect(summaryPrompt).not.toContain('old-2');
    expect(deps.sessionService.saveCompactionSummary).toHaveBeenCalledWith(expect.objectContaining({
      covered_until_entry_id: 'EA-1',
      first_kept_entry_id: 'EU-2',
    }));
  });

  it('uses the default three-Run retention for manual compaction', async () => {
    const retainedOnly = fixture([80], { historyCount: 3, useDefaultPolicy: true });
    await expect(retainedOnly.service.compactSession({ sessionId: 'S1', workspaceId: 'W1', model }))
      .resolves.toEqual({ status: 'nothing_to_compact', reason: 'no_older_runs' });
    expect(retainedOnly.deps.models.completeSimple).not.toHaveBeenCalled();

    const withOlderHistory = fixture([80, 30], { historyCount: 4, useDefaultPolicy: true });
    await expect(withOlderHistory.service.compactSession({ sessionId: 'S1', workspaceId: 'W1', model }))
      .resolves.toMatchObject({ status: 'compacted' });
    expect(withOlderHistory.deps.models.completeSimple).toHaveBeenCalledTimes(1);
    expect(withOlderHistory.deps.sessionService.saveCompactionSummary).toHaveBeenCalledWith(expect.objectContaining({
      covered_until_entry_id: 'EA-1',
      first_kept_entry_id: 'EU-2',
    }));
  });

  it('attempts automatic compaction once, persists only a reducing summary, and rebuilds usage', async () => {
    const { deps, service } = fixture([80, 30, 30]);
    const onCompactionProgress = vi.fn();
    const result = await service.build({ ...request, onCompactionProgress });
    expect(deps.models.completeSimple).toHaveBeenCalledTimes(1);
    expect(deps.sessionService.saveCompactionSummary).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: 'ready', prepared: { usage: { usedTokens: 30 }, compaction: { compactionId: 'C1' } } });
    expect(onCompactionProgress.mock.calls.map(([progress]) => progress.status)).toEqual(['started', 'completed']);
    expect(onCompactionProgress).toHaveBeenLastCalledWith(expect.objectContaining({
      status: 'completed',
      compactionId: 'C1',
      tokensBefore: 80,
      summarizedSourceCount: 1,
    }));
  });

  it('discards a non-reducing summary below the window and fails above the hard window', async () => {
    const below = fixture([80, 80]);
    expect(await below.service.build(request)).toMatchObject({ status: 'ready', prepared: { usage: { usedTokens: 80 } } });
    expect(below.deps.sessionService.saveCompactionSummary).not.toHaveBeenCalled();

    const hard = fixture([100, 100]);
    expect(await hard.service.build(request)).toMatchObject({ status: 'failed', failure: { code: 'context_window_exceeded' } });
  });

  it('fails the current prepare when summary generation or persistence fails without retrying', async () => {
    const generated = fixture([80]);
    generated.deps.models.completeSimple = vi.fn(async () => ({
      ...summaryMessage(''),
      stopReason: 'error' as const,
      failure: { code: 'provider_failed' as const, message: 'no summary', retryable: true },
    }));
    expect(await generated.service.build(request)).toMatchObject({ status: 'failed', failure: { code: 'compaction_failed' } });
    expect(generated.deps.sessionService.saveCompactionSummary).not.toHaveBeenCalled();

    const persisted = fixture([80, 30]);
    persisted.deps.sessionService.saveCompactionSummary = vi.fn(() => ({ status: 'failed' as const, failure: { code: 'active_entry_changed', message: 'stale head' } }));
    expect(await persisted.service.build(request)).toMatchObject({
      status: 'failed',
      failure: { code: 'compaction_persist_failed', cause: { owner: 'session', code: 'active_entry_changed' } },
    });
  });

  it('manual compact uses the same internals without a fake current run', async () => {
    const { deps, service } = fixture([80, 25]);
    expect(await service.compactSession({ sessionId: 'S1', workspaceId: 'W1', model })).toMatchObject({ status: 'compacted', usageBefore: { usedTokens: 80 }, usageAfter: { usedTokens: 25 } });
    expect(deps.contextTokenEstimator).toHaveBeenCalledWith(expect.objectContaining({ messages: expect.not.arrayContaining([expect.objectContaining({ role: 'user', content: [] })]) }));
  });

  it.each([
    ['automatic', '   '],
    ['manual', '\n\t'],
  ] as const)('rejects an empty %s compaction summary without persisting it', async (mode, content) => {
    const { deps, service } = fixture([80]);
    deps.models.completeSimple = vi.fn(async () => summaryMessage(content));

    const result = mode === 'automatic'
      ? await service.build(request)
      : await service.compactSession({ sessionId: 'S1', workspaceId: 'W1', model });

    expect(result).toMatchObject({ status: 'failed', failure: { code: 'compaction_failed' } });
    expect(deps.sessionService.saveCompactionSummary).not.toHaveBeenCalled();
  });

  it('passes the loaded active head to Session when persisting a compaction', async () => {
    const { deps, service } = fixture([80, 30, 30]);

    await service.build(request);

    expect(deps.sessionService.saveCompactionSummary).toHaveBeenCalledWith(expect.objectContaining({
      expected_active_entry_id: 'EC',
    }));
  });

  it('does not persist when cancellation arrives after an owner count or summary await', async () => {
    const countController = new AbortController();
    const afterCount = fixture([80]);
    afterCount.deps.contextTokenEstimator = vi.fn(() => {
      countController.abort();
      return 80;
    });
    expect(await afterCount.service.build({ ...request, signal: countController.signal })).toMatchObject({
      status: 'failed', failure: { code: 'cancelled' },
    });
    expect(afterCount.deps.models.completeSimple).not.toHaveBeenCalled();

    const summaryController = new AbortController();
    const afterSummary = fixture([80]);
    afterSummary.deps.models.completeSimple = vi.fn(async () => {
      summaryController.abort();
      return summaryMessage();
    });
    expect(await afterSummary.service.build({ ...request, signal: summaryController.signal })).toMatchObject({
      status: 'failed', failure: { code: 'cancelled' },
    });
    expect(afterSummary.deps.sessionService.saveCompactionSummary).not.toHaveBeenCalled();
  });

  it('serializes compaction work for the same session within one ContextService', async () => {
    let releaseFirst!: () => void;
    const firstSummary = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const { deps, service } = fixture([80, 25, 80, 25]);
    deps.models.completeSimple = vi.fn()
      .mockImplementationOnce(async () => {
        await firstSummary;
        return summaryMessage('first');
      })
      .mockResolvedValueOnce(summaryMessage('second'));

    const first = service.compactSession({ sessionId: 'S1', workspaceId: 'W1', model });
    const second = service.compactSession({ sessionId: 'S1', workspaceId: 'W1', model });
    await vi.waitFor(() => expect(deps.models.completeSimple).toHaveBeenCalledTimes(1));
    releaseFirst();

    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(deps.models.completeSimple).toHaveBeenCalledTimes(2);
  });
});
