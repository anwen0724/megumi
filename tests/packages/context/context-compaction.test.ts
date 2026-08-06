/* Verifies automatic and manual compaction share one policy, commit path, and per-Session lock. */
import type { AssistantMessage } from '@megumi/ai';
import { createEventBus, type AnyEvent } from '@megumi/events';
import type { SessionHistoryItem } from '@megumi/session';
import { describe, expect, it, vi } from 'vitest';
import {
  createContext,
  type CreateContextOptions,
  type Prompt,
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
    contextTokenEstimator: vi.fn((prompt: Prompt) => (
      prompt.messages.length * 60 + (prompt.systemPrompt ? 10 : 0)
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
    // Manual compaction always compacts the tools-less Prompt.
    tools: [] as const,
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

    const invalidPolicy = fixture();
    invalidPolicy.policy = {
      enabled: true,
      reserveTokens: 101,
      keepRecentTokens: 1,
      minimumRecentMessages: 1,
    };
    expect(await createContext(invalidPolicy).compact(manualRequest({
      model: { ...compactingModel, contextWindow: 100 },
    }))).toMatchObject({
      status: 'failed',
      failure: { code: 'policy_invalid' },
    });
    expect(invalidPolicy.models.completeSimple).not.toHaveBeenCalled();

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

  it('runs Overflow, Threshold and Manual compaction through the same transaction', async () => {
    // Every trigger settles through the same commit shape: same Summary fields,
    // same optimistic entry and same progress events.
    for (const trigger of ['manual', 'overflow', 'threshold'] as const) {
      const options = fixture();
      const result = trigger === 'threshold'
        ? await createContext(options).build({
            modelCallContext: modelCall({ run: { ...modelCall().run, model: compactingModel } }),
          })
        : await createContext(options).compact(manualRequest({ trigger }));
      expect(result.status, trigger).toBe(trigger === 'threshold' ? 'ready' : 'compacted');
      expect(options.sessionHistory.saveCompactionSummary).toHaveBeenCalledWith(expect.objectContaining({
        covered_until_entry_id: 'entry:user:2',
        first_kept_entry_id: 'entry:assistant:2',
        expected_active_entry_id: 'entry:assistant:2',
        append_to_active_path: true,
      }));
    }
  });

  it('compacts again after an existing Summary without shifting Entry to Message mapping', async () => {
    const historyWithSummary: SessionHistoryItem[] = [
      {
        type: 'compaction',
        entry: {
          entry_id: 'entry:summary:1',
          session_id: 'session:1',
          parent_entry_id: 'entry:assistant:1',
          entry_type: 'compaction',
          compaction_id: 'compaction:0',
          created_at: 'now',
        },
        compaction: {
          compaction_id: 'compaction:0',
          session_id: 'session:1',
          summary_text: 'earlier summary',
          covered_until_entry_id: 'entry:assistant:1',
          first_kept_entry_id: 'entry:user:2',
          created_at: 'now',
        },
      },
      ...runHistory(2),
    ];
    const secondSummary: SessionHistoryItem[] = [
      {
        type: 'compaction',
        entry: {
          entry_id: 'entry:summary:2',
          session_id: 'session:1',
          parent_entry_id: 'entry:user:2',
          entry_type: 'compaction',
          compaction_id: 'compaction:1',
          created_at: 'now',
        },
        compaction: {
          compaction_id: 'compaction:1',
          session_id: 'session:1',
          summary_text: 'replacement summary',
          covered_until_entry_id: 'entry:user:2',
          first_kept_entry_id: 'entry:assistant:2',
          created_at: 'now',
        },
      },
      ...runHistory(2).slice(1),
    ];
    let reads = 0;
    const options: CreateContextOptions = {
      ...fixture(),
      sessionHistory: {
        getActiveHistory: vi.fn(() => {
          reads += 1;
          return {
            status: 'ok' as const,
            history: reads === 1 ? historyWithSummary : secondSummary,
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
    };
    const result = await createContext(options).build({
      modelCallContext: modelCall({ run: { ...modelCall().run, model: compactingModel } }),
    });
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    // The second compaction replaces only User 3 and keeps Assistant 3: the
    // Summary entry never shifts the mapping and the last message survives.
    expect(options.sessionHistory.saveCompactionSummary).toHaveBeenCalledWith(expect.objectContaining({
      covered_until_entry_id: 'entry:user:2',
      first_kept_entry_id: 'entry:assistant:2',
    }));
    expect(result.prompt.messages.map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(JSON.stringify(result.prompt.messages[1])).toContain('answer 2');
  });

  it('returns the rebuilt Prompt messages after the committed Summary', async () => {
    const options = fixture();
    const result = await createContext(options).build({
      modelCallContext: modelCall({ run: { ...modelCall().run, model: compactingModel } }),
    });
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    // The final Prompt is materialized from the authoritative compacted history:
    // Summary + the genuinely kept messages.
    expect(result.prompt.messages.map((message) => message.role)).toEqual(['user', 'user', 'assistant']);
    expect(JSON.stringify(result.prompt.messages)).toContain('replacement summary');
    expect(JSON.stringify(result.prompt.messages)).toContain('answer 2');
  });

  it('builds candidate and final Prompts through the same System Prompt and Tool rules', async () => {
    const options = fixture();
    const estimator = options.contextTokenEstimator as ReturnType<typeof vi.fn>;
    const result = await createContext(options).build({
      modelCallContext: modelCall({ run: { ...modelCall().run, model: compactingModel } }),
    });
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    const systemPrompt = result.prompt.systemPrompt;
    // Every usage estimate (before, candidate and final) was computed from a
    // Prompt sharing the same System Prompt and the same Tool list.
    const prompts = estimator.mock.calls.map((call) => call[0] as Prompt);
    expect(prompts.length).toBeGreaterThanOrEqual(2);
    for (const prompt of prompts) {
      expect(prompt.systemPrompt).toBe(systemPrompt);
      expect(prompt.tools).toEqual(result.prompt.tools);
    }
  });

  it('never overwrites new history when the optimistic entry conflicts', async () => {
    const options = fixture();
    options.sessionHistory.saveCompactionSummary = vi.fn(() => ({
      status: 'failed' as const,
      failure: { code: 'active_entry_conflict', message: 'history changed' },
    }));
    expect(await createContext(options).compact(manualRequest())).toMatchObject({
      status: 'failed',
      failure: {
        code: 'compaction_persist_failed',
        cause: { owner: 'session', code: 'active_entry_conflict' },
      },
    });
  });

  it('serializes build() and compact() for the same Session', async () => {
    let release!: (message: AssistantMessage) => void;
    const first = new Promise<AssistantMessage>((resolve) => { release = resolve; });
    const completeSimple = vi.fn()
      .mockImplementationOnce(() => first)
      .mockImplementation(async () => completedMessage('second summary'));
    const context = createContext(fixture(completeSimple));

    const built = context.build({
      modelCallContext: modelCall({ run: { ...modelCall().run, model: compactingModel } }),
    });
    const compacted = context.compact(manualRequest());
    // Only the build's compaction Summary call may be in flight; the compact
    // waits on the same-Session gate.
    await vi.waitFor(() => expect(completeSimple).toHaveBeenCalledTimes(1));
    release(completedMessage('first summary'));
    await vi.waitFor(() => expect(completeSimple).toHaveBeenCalledTimes(2));
    await expect(Promise.all([built, compacted])).resolves.toEqual([
      expect.objectContaining({ status: 'ready' }),
      expect.objectContaining({ status: 'compacted' }),
    ]);
  });

  it('releases the per-Session operation tail after operations settle', async () => {
    const options = fixture();
    const context = createContext(options);
    // Serialized operations settle cleanly one after another.
    await expect(context.compact(manualRequest())).resolves.toMatchObject({ status: 'compacted' });
    await expect(context.compact(manualRequest())).resolves.toMatchObject({ status: 'compacted' });
    // The Session is free again: a mixed build + compact pair starts without
    // any residue from the earlier operations.
    const buildResult = context.build({
      modelCallContext: modelCall({ run: { ...modelCall().run, model: compactingModel } }),
    });
    const compactResult = context.compact(manualRequest());
    await expect(Promise.all([buildResult, compactResult])).resolves.toEqual([
      expect.objectContaining({ status: 'ready' }),
      expect.objectContaining({ status: 'compacted' }),
    ]);
  });

  it('runs operations for different Sessions in parallel', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const completeSimple = vi.fn(async (_model: unknown, _context: unknown, options: { sessionId: string }) => {
      if (options.sessionId === 'session:1') {
        await gate;
        return completedMessage('first summary');
      }
      return completedMessage('second summary');
    });
    const context = createContext(fixture(completeSimple));

    const one = context.compact(manualRequest({ sessionId: 'session:1' }));
    const two = context.compact(manualRequest({ sessionId: 'session:2' }));
    // Session 2's compaction completes while Session 1's Summary call is still
    // blocked: different Sessions are never serialized by a global lock.
    await expect(two).resolves.toMatchObject({ status: 'compacted' });
    release();
    await expect(one).resolves.toMatchObject({ status: 'compacted' });
  });

  it('does not keep cross-operation Prompt, history or plan state', async () => {
    const options = fixture();
    const context = createContext(options);
    await context.compact(manualRequest());
    // A fresh build after manual compaction re-reads the authoritative history
    // and settles with its own state; no prior Prompt or plan leaks in.
    const result = await context.build({ modelCallContext: modelCall() });
    expect(result.status).toBe('ready');
    // The only Session write across both operations is the Summary commit.
    expect(options.sessionHistory.saveCompactionSummary).toHaveBeenCalledTimes(1);
    const historyReads = (options.sessionHistory.getActiveHistory as ReturnType<typeof vi.fn>).mock.calls;
    expect(historyReads).toHaveLength(2);
  });
});
