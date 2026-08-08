/* Verifies automatic and manual compaction share one policy, commit path, and per-Session lock. */
import type { AssistantMessage } from '@megumi/ai';
import { createEventBus, type AnyEvent } from '@megumi/events';
import type { SessionHistoryItem } from '@megumi/session';
import { describe, expect, it, vi, type Mock } from 'vitest';
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
  // The committed Summary replaces the prefix up to the last summarized Turn;
  // the kept suffix starts at the Turn the budget cut moved to.
  const kept = history.slice(6);
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
      covered_until_entry_id: 'entry:assistant:3',
      first_kept_entry_id: 'entry:user:4',
      created_at: 'now',
    } },
    ...kept,
  ];
}

function fixture(
  completeSimple: Mock<(...args: any[]) => Promise<AssistantMessage>> = vi.fn(async () => completedMessage('replacement summary')),
): CreateContextOptions {
  // Five ordinary Turns: enough for two consecutive compactions without ever
  // cutting a Turn (each compaction keeps at least two Turns).
  const history = [
    ...runHistory(1),
    ...runHistory(2),
    ...runHistory(3),
    ...runHistory(4),
    ...runHistory(5),
  ];
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
      beginCompaction: vi.fn((request) => ({
        status: 'started' as const,
        compaction: {
          compactionId: request.compactionId,
          sessionId: request.sessionId,
          anchorEntryId: request.anchorEntryId,
          trigger: request.trigger,
          status: 'running' as const,
          startedAt: request.startedAt,
        },
      })),
      completeCompaction: vi.fn((request) => ({
        status: 'completed' as const,
        compaction: {
          compactionId: request.compactionId,
          sessionId: request.sessionId,
          anchorEntryId: request.coveredUntilEntryId,
          trigger: 'manual' as const,
          status: 'completed' as const,
          startedAt: '2026-07-12T00:00:00.000Z',
          completedAt: request.completedAt,
        },
      })),
      endCompaction: vi.fn((request) => ({
        status: 'ended' as const,
        compaction: {
          compactionId: request.compactionId,
          sessionId: request.sessionId,
          anchorEntryId: 'entry:assistant:3',
          trigger: 'manual' as const,
          status: request.status,
          ...(request.error ? { error: request.error } : {}),
          startedAt: '2026-07-12T00:00:00.000Z',
          completedAt: request.completedAt,
        },
      })),
    },
    attachmentReader: { readAttachmentContent: vi.fn() },
    workspaceSource: workspaceSource(),
    instructionReader: {
      getSystemInstructions: vi.fn(async () => []),
      getEffectiveInstructions: vi.fn(async () => ({
        status: 'ok' as const,
        instructions: { sources: [] },
      })),
    },
    skills: {
      createView: vi.fn(async () => ({ status: 'ok' as const, view: { catalog: [], diagnostics: [] } })),
    },
    models: { completeSimple },
    // Deterministic estimator: ten original messages cost 30 tokens each, the
    // compacted Prompt (summary + kept Turns) costs much less and still fits
    // the small Context Window after the commit.
    contextTokenEstimator: vi.fn((prompt: Prompt) => (
      prompt.messages.length * 30 + (prompt.systemPrompt ? 10 : 0)
    )),
    policy: { enabled: true, reserveTokens: 32, keepRecentTokens: 1, minimumRecentMessages: 3 },
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

  it('persists each lifecycle transition before publishing its matching event', async () => {
    const order: string[] = [];
    const events = createEventBus();
    events.subscribe({}, (event) => { order.push(`event:${event.type}`); });
    const options = fixture(vi.fn(async () => {
      throw new Error('summary provider unavailable');
    }));
    const begin = options.sessionHistory.beginCompaction;
    const end = options.sessionHistory.endCompaction;
    options.sessionHistory.beginCompaction = vi.fn((request) => {
      order.push('session:running');
      return begin(request);
    });
    options.sessionHistory.endCompaction = vi.fn((request) => {
      order.push(`session:${request.status}`);
      return end(request);
    });

    await expect(createContext({ ...options, events }).compact(manualRequest())).resolves.toMatchObject({
      status: 'failed',
      failure: { code: 'compaction_failed' },
    });
    expect(order).toEqual([
      'session:running',
      'event:session.compaction.started',
      'session:failed',
      'event:session.compaction.ended',
    ]);
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
    if ((options.sessionHistory.completeCompaction as ReturnType<typeof vi.fn>).mock.calls.length === 0) {
      throw new Error('completeCompaction was not called');
    }
    expect(options.sessionHistory.completeCompaction).toHaveBeenCalledWith(expect.objectContaining({
      compactionId: 'compaction:1',
      coveredUntilEntryId: 'entry:assistant:3',
      firstKeptEntryId: 'entry:user:4',
      expectedActiveEntryId: 'entry:assistant:5',
      appendToActivePath: true,
    }));
    // The rebuilt Prompt comes from a fresh Session read, not a pre-commit projection.
    expect(options.sessionHistory.getActiveHistory).toHaveBeenCalledTimes(2);
  });

  it('uses the same compactor for manual requests and preserves nothing-to-compact semantics', async () => {
    const compacted = await createContext(fixture()).compact(manualRequest());
    expect(compacted).toMatchObject({ status: 'compacted' });

    const invalidPolicy = fixture();
    (invalidPolicy as { policy: unknown }).policy = {
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
    // Only the first compaction's Summary call may be in flight: the second
    // waits on the same-Session gate.
    await vi.waitFor(() => expect(completeSimple).toHaveBeenCalledTimes(1));
    release(completedMessage('first summary'));
    await expect(one).resolves.toMatchObject({ status: 'compacted' });
    // The second compaction runs only after the first settled; with a single
    // kept Turn left it legitimately has nothing to compact.
    await expect(two).resolves.toMatchObject({ status: 'nothing_to_compact' });
  });

  it('does not start pre-cancelled work and accepts a committed Summary regardless of usage delta', async () => {
    const controller = new AbortController();
    controller.abort();
    const cancelledOptions = fixture();
    expect(await createContext(cancelledOptions).compact(manualRequest({
      signal: controller.signal,
    }))).toMatchObject({ status: 'failed', failure: { code: 'cancelled' } });
    expect(cancelledOptions.sessionHistory.beginCompaction).not.toHaveBeenCalled();

    const flatOptions: CreateContextOptions = {
      ...fixture(),
      contextTokenEstimator: vi.fn(() => 100),
    };
    expect(await createContext(flatOptions).compact(manualRequest())).toMatchObject({
      status: 'compacted',
    });
    expect(flatOptions.sessionHistory.completeCompaction).toHaveBeenCalledOnce();
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
    // The started log reports the messages that truly stay in the candidate
    // Prompt: the kept compactable history including the Turn Prefix.
    expect(observability.recordLog).toHaveBeenCalledWith(expect.objectContaining({
      event: 'context.compaction.started',
      attributes: expect.objectContaining({ keptMessages: 4 }),
    }));
    expect(observability.recordLog).toHaveBeenCalledWith(expect.objectContaining({
      event: 'context.compaction.completed',
    }));
    expect(observability.recordMeasurement).toHaveBeenCalledWith(expect.objectContaining({
      name: 'context.compaction.after_tokens',
    }));
  });

  it('records distinct lifecycle start and completion times', async () => {
    let tick = 0;
    const now = vi.fn(() => `2026-07-12T00:00:${String(10 + tick++).padStart(2, '0')}.000Z`);
    const options = { ...fixture(), clock: { now } };
    const context = createContext(options);

    const result = await context.compact(manualRequest());
    expect(result.status).toBe('compacted');
    expect(now).toHaveBeenCalledTimes(2);
    const startedAt = '2026-07-12T00:00:10.000Z';
    const completedAt = '2026-07-12T00:00:11.000Z';

    // The Summary model request timestamp comes from the same createdAt.
    const completeSimple = options.models.completeSimple as ReturnType<typeof vi.fn>;
    const summaryRequest = completeSimple.mock.calls[0]![1] as { messages: Array<{ timestamp: number }> };
    expect(summaryRequest.messages[0]!.timestamp).toBe(Date.parse(startedAt));

    expect(options.sessionHistory.beginCompaction).toHaveBeenCalledWith(expect.objectContaining({
      startedAt,
    }));
    expect(options.sessionHistory.completeCompaction).toHaveBeenCalledWith(expect.objectContaining({
      completedAt,
    }));

    // The projected candidate Prompt carries the Summary with the same timestamp.
    const estimator = options.contextTokenEstimator as ReturnType<typeof vi.fn>;
    const prompts = estimator.mock.calls.map((call) => call[0] as Prompt);
    const projected = prompts.find((prompt) => {
      const first = prompt.messages[0];
      return first !== undefined
        && first.role === 'user'
        && typeof first.content !== 'string'
        && first.content.some((block) => (
          block.type === 'text' && block.text.includes('compacted into the following summary')
        ));
    });
    expect(projected).toBeDefined();
    expect(projected!.messages[0]!.timestamp).toBe(Date.parse(startedAt));
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
      expect(options.sessionHistory.completeCompaction).toHaveBeenCalledWith(expect.objectContaining({
        coveredUntilEntryId: 'entry:assistant:3',
        firstKeptEntryId: 'entry:user:4',
        expectedActiveEntryId: 'entry:assistant:5',
        appendToActivePath: true,
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
      ...runHistory(3),
      ...runHistory(4),
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
          covered_until_entry_id: 'entry:assistant:3',
          first_kept_entry_id: 'entry:user:4',
          created_at: 'now',
        },
      },
      ...runHistory(4),
    ];
    let reads = 0;
    const base = fixture();
    const options: CreateContextOptions = {
      ...base,
      policy: { enabled: true, reserveTokens: 32, keepRecentTokens: 1, minimumRecentMessages: 2 },
      sessionHistory: {
        ...base.sessionHistory,
        getActiveHistory: vi.fn(() => {
          reads += 1;
          return {
            status: 'ok' as const,
            history: reads === 1 ? historyWithSummary : secondSummary,
          };
        }),
      },
    };
    const result = await createContext(options).build({
      modelCallContext: modelCall({ run: { ...modelCall().run, model: compactingModel } }),
    });
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    // The second compaction replaces the User 2 and User 3 Turns and keeps the
    // User 4 Turn: the Summary entry never shifts the mapping and the last
    // message survives.
    expect(options.sessionHistory.completeCompaction).toHaveBeenCalledWith(expect.objectContaining({
      coveredUntilEntryId: 'entry:assistant:3',
      firstKeptEntryId: 'entry:user:4',
    }));
    expect(result.prompt.messages.map((message) => message.role)).toEqual(['user', 'user', 'assistant']);
    expect(JSON.stringify(result.prompt.messages[2])).toContain('answer 4');
  });

  it('returns the rebuilt Prompt messages after the committed Summary', async () => {
    const options = fixture();
    const result = await createContext(options).build({
      modelCallContext: modelCall({ run: { ...modelCall().run, model: compactingModel } }),
    });
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    // The final Prompt is materialized from the authoritative compacted history:
    // Summary + the genuinely kept Turns.
    expect(result.prompt.messages.map((message) => message.role))
      .toEqual(['user', 'user', 'assistant', 'user', 'assistant']);
    expect(JSON.stringify(result.prompt.messages)).toContain('replacement summary');
    expect(JSON.stringify(result.prompt.messages)).toContain('answer 5');
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
    options.sessionHistory.completeCompaction = vi.fn(() => ({
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
    await expect(built).resolves.toMatchObject({ status: 'ready' });
    // The compact runs only after the build settled; with a single kept Turn
    // left it legitimately has nothing to compact.
    await expect(compacted).resolves.toMatchObject({ status: 'nothing_to_compact' });
  });

  it('releases the per-Session operation tail after operations settle', async () => {
    const options = fixture();
    const context = createContext(options);
    // Serialized operations settle cleanly one after another.
    await expect(context.compact(manualRequest())).resolves.toMatchObject({ status: 'compacted' });
    await expect(context.compact(manualRequest())).resolves.toMatchObject({ status: 'nothing_to_compact' });
    // The Session is free again: a mixed build + compact pair starts without
    // any residue from the earlier operations.
    const buildResult = context.build({
      modelCallContext: modelCall({ run: { ...modelCall().run, model: compactingModel } }),
    });
    const compactResult = context.compact(manualRequest());
    await expect(Promise.all([buildResult, compactResult])).resolves.toEqual([
      expect.objectContaining({ status: 'ready' }),
      expect.objectContaining({ status: 'nothing_to_compact' }),
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
    // Session 2's operation settles while Session 1's Summary call is still
    // blocked: different Sessions are never serialized by a global lock.
    await expect(two).resolves.toMatchObject({ status: 'nothing_to_compact' });
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
    // The only successful Session Summary commit across both operations is the first compaction.
    expect(options.sessionHistory.completeCompaction).toHaveBeenCalledTimes(1);
    const historyReads = (options.sessionHistory.getActiveHistory as ReturnType<typeof vi.fn>).mock.calls;
    expect(historyReads).toHaveLength(2);
  });
});
