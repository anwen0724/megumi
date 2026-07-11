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
    persisted.deps.sessionService.saveCompactionSummary = vi.fn(() => ({ status: 'failed' as const, failure: { code: 'write_failed', message: 'no write' } }));
    expect(await persisted.service.prepareModelCall(request)).toMatchObject({ status: 'failed', failure: { code: 'compaction_persist_failed' } });
  });

  it('manual compact uses the same internals without a fake current turn', async () => {
    const { deps, service } = fixture([80, 0, 10, 25]);
    expect(await service.compactSession({ sessionId: 'S1', workspaceId: 'W1', modelContext })).toMatchObject({ status: 'compacted', usageBefore: { usedTokens: 80 }, usageAfter: { usedTokens: 25 } });
    expect(deps.promptTokenCounter.count).toHaveBeenCalledWith(expect.objectContaining({ prompt: expect.objectContaining({ conversation: expect.not.arrayContaining([expect.objectContaining({ type: 'user_message', content: [] })]) }) }));
  });
});
