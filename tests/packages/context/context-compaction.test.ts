/* Verifies automatic and manual compaction share one policy, commit path, and per-Session lock. */
import type { AssistantMessage } from '@megumi/ai';
import { createEventBus, type AnyEvent } from '@megumi/events';
import type { SessionHistoryItem } from '@megumi/session';
import { describe, expect, it, vi } from 'vitest';
import {
  createContext,
  type CreateContextOptions,
} from '../../../packages/context/src/index';
import {
  compactingModel,
  completedMessage,
  modelCall,
  runHistory,
  workspaceSource,
} from './context-test-fixtures';

function compactedHistory(history: SessionHistoryItem[]): SessionHistoryItem[] {
  const first = history[0]!;
  const kept = history.slice(2);
  const entry = {
    entry_id: 'entry:summary',
    session_id: 'session:1',
    parent_entry_id: first.entry.entry_id,
    entry_type: 'compaction' as const,
    compaction_id: 'compaction:1',
    created_at: 'now',
  };
  return [
    { type: 'compaction', entry, compaction: {
      compaction_id: 'compaction:1',
      session_id: 'session:1',
      summary_text: 'replacement summary',
      covered_until_entry_id: 'entry:user:2',
      first_kept_entry_id: 'entry:assistant:2',
      created_at: 'now',
    } },
    ...kept,
  ];
}

function fixture(
  completeSimple = vi.fn(async () => completedMessage('replacement summary')),
): CreateContextOptions {
  const history = [...runHistory(1), ...runHistory(2)];
  let reads = 0;
  return {
    sessionHistory: {
      // The first read returns the full history; after the committed Summary the
      // authoritative history is compacted (Summary replaces the prefix).
      getActiveHistory: vi.fn(() => {
        reads += 1;
        return {
          status: 'ok' as const,
          history: reads === 1 ? history : compactedHistory(history),
        };
      }),
      saveCompactionSummary: vi.fn((request) => ({
        status: 'saved' as const,
        compaction: {
          compaction_id: request.compaction_id,
          session_id: request.session_id,
          summary_text: request.summary_text,
          covered_until_entry_id: request.covered_until_entry_id,
          first_kept_entry_id: request.first_kept_entry_id,
          created_at: request.created_at,
        },
      })),
    },
    attachmentReader: { readAttachmentContent: vi.fn() },
    workspaceSource: workspaceSource(),
    instructionReader: {
      getSystemInstructions: vi.fn(() => []),
      getEffectiveInstructions: vi.fn(async () => ({
        status: 'ok' as const,
        instructions: { sources: [] },
      })),
    },
    skills: {
      createView: vi.fn(async () => ({ status: 'ok' as const, view: { catalog: [], diagnostics: [] } })),
    },
    models: { completeSimple },
    // Deterministic estimator: four original messages cost 40 tokens each, the
    // compacted Prompt (summary + one kept message) costs much less.
    contextTokenEstimator: vi.fn((context: { messages: unknown[]; systemPrompt?: string }) => (
      context.messages.length * 60 + (context.systemPrompt ? 10 : 0)
    )),
    policy: { enabled: true, reserveTokens: 32, keepRecentTokens: 1, minimumRecentMessages: 1 },
    clock: { now: () => '2026-07-12T00:00:00.000Z' },
    ids: { compactionId: () => 'compaction:1' },
  };
}

function manualRequest(overrides: Partial<Parameters<ReturnType<typeof createContext>['compact']>[0]> = {}) {
  return {
    sessionId: 'session:1',
    workspaceId: 'workspace:1',
    model: compactingModel,
    trigger: 'manual' as const,
    ...overrides,
  };
}

describe('Context compaction', () => {
  it('publishes compaction lifecycle events to the bus when an events bus is wired', async () => {
    const events = createEventBus();
    const published: AnyEvent[] = [];
    events.subscribe({}, (event) => { published.push(event); });
    const options = { ...fixture(), events };

    const result = await createContext(options).compact(manualRequest());
    expect(result.status).toBe('compacted');

    const types = published.map((event) => event.type);
    expect(types).toEqual(['session.compaction.started', 'session.compaction.ended']);
    expect(published[0]?.payload).toMatchObject({
      trigger: 'manual',
      compactionId: 'compaction:1',
    });
    expect(published[0]?.sessionId).toBe('session:1');
    expect(published[0]?.runId).toBeUndefined();
    expect(published[1]?.payload).toMatchObject({
      status: 'completed',
      compactionId: 'compaction:1',
    });
  });

  it('automatically compacts above the threshold and rebuilds from the committed Summary', async () => {
    const options = fixture();
    const result = await createContext(options).build({
      // The small Context Window keeps the threshold below the fixture history.
      modelCallContext: modelCall({ run: { ...modelCall().run, model: compactingModel } }),
    });

    if (result.status !== 'ready') {
      throw new Error(`Expected ready, got ${result.status}: ${result.status === 'failed' ? result.failure.code : ''}`);
    }
    if ((options.sessionHistory.saveCompactionSummary as ReturnType<typeof vi.fn>).mock.calls.length === 0) {
      throw new Error('saveCompactionSummary was not called');
    }
    expect(options.sessionHistory.saveCompactionSummary).toHaveBeenCalledWith(expect.objectContaining({
      compaction_id: 'compaction:1',
      covered_until_entry_id: 'entry:user:2',
      first_kept_entry_id: 'entry:assistant:2',
      expected_active_entry_id: 'entry:assistant:2',
      append_to_active_path: true,
    }));
    // The rebuilt Prompt comes from a fresh Session read, not a pre-commit projection.
    expect(options.sessionHistory.getActiveHistory).toHaveBeenCalledTimes(2);
  });

  it('uses the same compactor for manual requests and preserves nothing-to-compact semantics', async () => {
    const compacted = await createContext(fixture()).compact(manualRequest());
    expect(compacted).toMatchObject({ status: 'compacted' });

    const options: CreateContextOptions = {
      ...fixture(),
      policy: { enabled: true, reserveTokens: 16, keepRecentTokens: 1000, minimumRecentMessages: 100 },
    };
    expect(await createContext(options).compact(manualRequest())).toEqual({
      status: 'nothing_to_compact',
      reason: 'no_older_messages',
    });
  });

  it('serializes concurrent compaction for the same Session', async () => {
    let release!: (message: AssistantMessage) => void;
    const first = new Promise<AssistantMessage>((resolve) => { release = resolve; });
    const completeSimple = vi.fn()
      .mockImplementationOnce(() => first)
      .mockImplementation(async () => completedMessage('second summary'));
    const context = createContext(fixture(completeSimple));

    const one = context.compact(manualRequest());
    const two = context.compact(manualRequest());
    await vi.waitFor(() => expect(completeSimple).toHaveBeenCalledTimes(1));
    release(completedMessage('first summary'));
    await vi.waitFor(() => expect(completeSimple).toHaveBeenCalledTimes(2));
    await expect(Promise.all([one, two])).resolves.toEqual([
      expect.objectContaining({ status: 'compacted' }),
      expect.objectContaining({ status: 'compacted' }),
    ]);
  });

  it('does not persist cancelled or non-reducing summaries', async () => {
    const controller = new AbortController();
    controller.abort();
    const cancelledOptions = fixture();
    expect(await createContext(cancelledOptions).compact(manualRequest({
      signal: controller.signal,
    }))).toMatchObject({ status: 'failed', failure: { code: 'cancelled' } });
    expect(cancelledOptions.sessionHistory.saveCompactionSummary).not.toHaveBeenCalled();

    const flatOptions: CreateContextOptions = {
      ...fixture(),
      contextTokenEstimator: vi.fn(() => 100),
    };
    expect(await createContext(flatOptions).compact(manualRequest())).toEqual({
      status: 'nothing_to_compact',
      reason: 'summary_not_reducing',
    });
    expect(flatOptions.sessionHistory.saveCompactionSummary).not.toHaveBeenCalled();
  });

  it('converts unexpected dependency exceptions into a stable compaction failure', async () => {
    const options = fixture();
    options.sessionHistory.getActiveHistory = vi.fn(() => {
      throw new Error('database unavailable');
    });

    await expect(createContext(options).compact(manualRequest())).resolves.toEqual({
      status: 'failed',
      failure: {
        code: 'compaction_failed',
        message: 'database unavailable',
        retryable: false,
      },
    });
  });

  it('records manual compaction lifecycle and resulting token usage', async () => {
    const observability = {
      getCurrentTrace: vi.fn(() => undefined),
      recordLog: vi.fn(),
      recordMeasurement: vi.fn(),
    } as unknown as NonNullable<CreateContextOptions['observability']>;
    const options: CreateContextOptions = { ...fixture(), observability };

    await expect(createContext(options).compact(manualRequest())).resolves.toMatchObject({ status: 'compacted' });
    expect(observability.recordLog).toHaveBeenCalledWith(expect.objectContaining({
      event: 'context.compaction.started',
    }));
    expect(observability.recordLog).toHaveBeenCalledWith(expect.objectContaining({
      event: 'context.compaction.completed',
    }));
    expect(observability.recordMeasurement).toHaveBeenCalledWith(expect.objectContaining({
      name: 'context.compaction.after_tokens',
    }));
  });
});
