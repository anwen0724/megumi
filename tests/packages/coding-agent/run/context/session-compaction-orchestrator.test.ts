// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { ContextBudgetPolicy } from '@megumi/shared/context';
import type { ModelStepRuntimeRequest } from '@megumi/shared/model';
import type { SessionCompactionEntry } from '@megumi/shared/session';
import type { SessionContextInput } from '@megumi/shared/session';
import type { SessionActiveLeaf, SessionSourceEntry } from '@megumi/shared/session';
import { buildModelStepInputContextFromSources } from '@megumi/coding-agent/run/context/model-step-input-context';
import {
  SessionCompactionOrchestrator,
  type SessionCompactionOrchestratorRepository,
} from '@megumi/coding-agent/run/context';

const builtAt = '2026-05-31T12:00:00.000Z';
const budgetPolicy: ContextBudgetPolicy = {
  modelContextWindow: 40,
  reservedOutputTokens: 10,
  keepRecentTokens: 3,
};

function repository(): SessionCompactionOrchestratorRepository & {
  entries: SessionCompactionEntry[];
  failSave: boolean;
} {
  return {
    entries: [],
    failSave: false,
    getLatestCompletedSessionCompaction() {
      return this.entries[0] ?? null;
    },
    saveSessionCompaction(entry) {
      if (this.failSave) {
        throw new Error('database unavailable');
      }
      this.entries.unshift(entry);
    },
  };
}

function activePathRepository() {
  const sourceEntries = new Map<string, SessionSourceEntry>();
  let activeLeaf: SessionActiveLeaf | undefined = {
    sessionId: 'session-1',
    leafSourceEntryId: 'source-entry-leaf-at-start',
    updatedAt: builtAt,
    reason: 'source_appended',
  };
  sourceEntries.set('source-entry-leaf-at-start', {
    sourceEntryId: 'source-entry-leaf-at-start',
    sessionId: 'session-1',
    sourceRef: {
      sourceKind: 'session_message',
      sourceId: 'message-leaf-at-start',
      sourceUri: 'session-message://message-leaf-at-start',
      loadedAt: builtAt,
    },
    createdAt: builtAt,
  });

  return {
    sourceEntries,
    getActiveLeaf(sessionId: string) {
      return activeLeaf?.sessionId === sessionId ? activeLeaf : undefined;
    },
    appendSourceEntry(entry: SessionSourceEntry) {
      sourceEntries.set(entry.sourceEntryId, entry);
      return entry;
    },
    setActiveLeaf(next: SessionActiveLeaf) {
      activeLeaf = next;
      return next;
    },
    getSourceEntryBySourceRef(
      sessionId: string,
      sourceRef: Pick<SessionSourceEntry['sourceRef'], 'sourceKind' | 'sourceId'>,
    ) {
      return [...sourceEntries.values()].find(
        (entry) =>
          entry.sessionId === sessionId
          && entry.sourceRef.sourceKind === sourceRef.sourceKind
          && entry.sourceRef.sourceId === sourceRef.sourceId,
      );
    },
  };
}

function installTransactionalActivePathSave(
  repo: ReturnType<typeof repository>,
  activePathRepo: ReturnType<typeof activePathRepository>,
  options: { failSourceWrite?: boolean } = {},
): void {
  repo.saveSessionCompactionWithActivePath = ({ compaction, sourceEntry, activeLeaf, expectedCurrentLeafSourceEntryId }) => {
    const entrySnapshot = [...repo.entries];
    const sourceEntrySnapshot = new Map(activePathRepo.sourceEntries);
    const activeLeafSnapshot = activePathRepo.getActiveLeaf(compaction.sessionId);

    try {
      repo.saveSessionCompaction(compaction);
      if (options.failSourceWrite) {
        throw new Error('source write failed');
      }
      const appended = activePathRepo.appendSourceEntry(sourceEntry);
      const currentLeaf = activePathRepo.getActiveLeaf(compaction.sessionId)?.leafSourceEntryId;
      let activeLeafAdvanced = false;

      if (currentLeaf === expectedCurrentLeafSourceEntryId) {
        activePathRepo.setActiveLeaf(activeLeaf);
        activeLeafAdvanced = true;
      }

      return { sourceEntry: appended, activeLeafAdvanced };
    } catch (error) {
      repo.entries.splice(0, repo.entries.length, ...entrySnapshot);
      activePathRepo.sourceEntries.clear();
      for (const [sourceEntryId, entry] of sourceEntrySnapshot) {
        activePathRepo.sourceEntries.set(sourceEntryId, entry);
      }
      if (activeLeafSnapshot) {
        activePathRepo.setActiveLeaf(activeLeafSnapshot);
      }
      throw error;
    }
  };
}

function sessionContext(): SessionContextInput {
  return {
    summaryEntries: [{
      summaryId: 'summary-1',
      summaryKind: 'compaction',
      text: 'Previous compacted summary.',
      sourceRef: {
        sourceId: 'session-summary:compaction-0',
        sourceKind: 'session_summary',
      },
      createdAt: '2026-05-31T11:00:00.000Z',
    }],
    historyEntries: [
      {
        entryId: 'message-1',
        role: 'user',
        text: 'a'.repeat(80),
        status: 'completed',
        sourceRef: {
          sourceId: 'session-message:message-1',
          sourceKind: 'session_message',
          sourceUri: 'session-message://message-1',
        },
        createdAt: '2026-05-31T11:01:00.000Z',
      },
      {
        entryId: 'message-2',
        role: 'assistant',
        text: 'b'.repeat(80),
        status: 'completed',
        sourceRef: {
          sourceId: 'session-message:message-2',
          sourceKind: 'session_message',
          sourceUri: 'session-message://message-2',
        },
        createdAt: '2026-05-31T11:02:00.000Z',
      },
      {
        entryId: 'message-3',
        role: 'user',
        text: 'keep me',
        status: 'completed',
        sourceRef: {
          sourceId: 'session-message:message-3',
          sourceKind: 'session_message',
          sourceUri: 'session-message://message-3',
        },
        createdAt: '2026-05-31T11:03:00.000Z',
      },
    ],
    runtimeFacts: [{
      factId: 'tool-1',
      factKind: 'tool_result',
      text: 'tool result summary',
      sourceRef: {
        sourceId: 'runtime-event:tool-1',
        sourceKind: 'tool_result',
      },
      createdAt: '2026-05-31T11:02:30.000Z',
    }],
  };
}

function budgetProbeInputContext(input: SessionContextInput = sessionContext()) {
  return buildModelStepInputContextFromSources({
    contextId: 'model-input-context:compaction-probe',
    sessionId: 'session-1',
    runId: 'run-1',
    stepId: 'step-1',
    buildReason: 'model_step_compaction_probe',
    builtAt,
    sessionContext: input,
    budgetPolicy: {
      modelContextWindow: 1_000_000,
      reservedOutputTokens: 0,
      keepRecentTokens: 1_000_000,
    },
  });
}

function completedSummaryText(): string {
  return [
    '## Goal',
    'Continue the 09 work.',
    '<read-files>',
    'packages/coding-agent/run/context/session-compaction.ts',
    '</read-files>',
    '<modified-files>',
    'apps/desktop/src/main/services/session/session-run.service.ts',
    '</modified-files>',
  ].join('\n');
}

describe('SessionCompactionOrchestrator', () => {
  it('runs an internal summary model call and persists a completed compaction row', async () => {
    const repo = repository();
    const requests: ModelStepRuntimeRequest[] = [];
    const orchestrator = new SessionCompactionOrchestrator({
      repository: repo,
      modelStepProvider: {
        async completeModelStep(request) {
          requests.push(request);
          return { ok: true, text: completedSummaryText(), finishReason: 'stop' };
        },
      },
      clock: { now: () => builtAt },
      ids: {
        compactionId: () => 'compaction-1',
        eventId: (() => {
          let index = 0;
          return () => {
            index += 1;
            return `event-compaction-${index}`;
          };
        })(),
        sourceEntryId: () => 'source-entry-compaction-1',
      },
    });

    const result = await orchestrator.compactIfNeeded({
      requestId: 'request-1',
      sessionId: 'session-1',
      runId: 'run-1',
      stepId: 'step-1',
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
      createdAt: builtAt,
      sessionContext: sessionContext(),
      budgetProbeInputContext: budgetProbeInputContext(),
      budgetPolicy,
      startSequence: 1,
    });

    expect(result.status).toBe('completed');
    expect(result.events.map((event) => event.eventType)).toEqual([
      'context.compaction.started',
      'context.compaction.completed',
    ]);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      requestId: 'request-1:compaction:compaction-1',
      stepId: 'step-1:compaction:compaction-1',
      toolDefinitions: undefined,
    });
    expect(requests[0]?.inputContext.trace.buildReason).toBe('session_compaction_summary');
    expect(repo.entries).toEqual([
      expect.objectContaining({
        compactionId: 'compaction-1',
        sessionId: 'session-1',
        summaryKind: 'compaction',
        triggerReason: 'context_budget_pressure',
        status: 'completed',
        firstKeptSourceRef: expect.objectContaining({
          sourceId: 'session-message:message-3',
          sourceKind: 'session_message',
        }),
        metadata: {
          previousCompactionId: 'summary-1',
          summarizedSourceCount: 3,
          readFiles: ['packages/coding-agent/run/context/session-compaction.ts'],
          modifiedFiles: ['apps/desktop/src/main/services/session/session-run.service.ts'],
        },
      }),
    ]);
  });

  it('writes a session summary source on the leaf captured before the summary model call', async () => {
    const repo = repository();
    const activePathRepo = activePathRepository();
    const orchestrator = new SessionCompactionOrchestrator({
      repository: repo,
      activePathRepository: activePathRepo,
      modelStepProvider: {
        async completeModelStep(_request: ModelStepRuntimeRequest) {
          return { ok: true, text: completedSummaryText(), finishReason: 'stop' };
        },
      },
      clock: { now: () => builtAt },
      ids: {
        compactionId: () => 'compaction-1',
        eventId: (() => {
          let index = 0;
          return () => {
            index += 1;
            return `event-compaction-${index}`;
          };
        })(),
        sourceEntryId: () => 'source-entry-compaction-1',
      },
    });

    const result = await orchestrator.compactIfNeeded({
      requestId: 'request-1',
      sessionId: 'session-1',
      runId: 'run-1',
      stepId: 'step-1',
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
      createdAt: builtAt,
      sessionContext: sessionContext(),
      budgetProbeInputContext: budgetProbeInputContext(),
      budgetPolicy,
      startSequence: 1,
    });

    expect(result.status).toBe('completed');
    expect(activePathRepo.getSourceEntryBySourceRef('session-1', {
      sourceKind: 'session_summary',
      sourceId: 'compaction-1',
    })?.parentSourceEntryId).toBe('source-entry-leaf-at-start');
    expect(activePathRepo.getSourceEntryBySourceRef('session-1', {
      sourceKind: 'session_summary',
      sourceId: 'compaction-1',
    })?.metadata).toEqual({
      runId: 'run-1',
      stepId: 'step-1',
      triggerReason: 'context_budget_pressure',
    });
    expect(activePathRepo.getActiveLeaf('session-1')?.leafSourceEntryId).toBe('source-entry-compaction-1');
  });

  it('uses the active context summary instead of session-wide latest row as previous compaction', async () => {
    const repo = repository();
    repo.entries.unshift({
      compactionId: 'compaction-old-path',
      sessionId: 'session-1',
      summary: 'Old path summary.',
      summaryKind: 'compaction',
      firstKeptSourceRef: {
        sourceId: 'message-old-path',
        sourceKind: 'session_message',
        sourceUri: 'session-message://message-old-path',
        loadedAt: '2026-05-31T10:00:00.000Z',
      },
      tokensBefore: 9000,
      triggerReason: 'context_budget_pressure',
      status: 'completed',
      createdAt: '2026-05-31T10:01:00.000Z',
    });
    const orchestrator = new SessionCompactionOrchestrator({
      repository: repo,
      modelStepProvider: {
        async completeModelStep(_request: ModelStepRuntimeRequest) {
          return { ok: true, text: completedSummaryText(), finishReason: 'stop' };
        },
      },
      clock: { now: () => builtAt },
      ids: {
        compactionId: () => 'compaction-1',
        eventId: (() => {
          let index = 0;
          return () => {
            index += 1;
            return `event-compaction-${index}`;
          };
        })(),
        sourceEntryId: () => 'source-entry-compaction-1',
      },
    });

    const result = await orchestrator.compactIfNeeded({
      requestId: 'request-1',
      sessionId: 'session-1',
      runId: 'run-1',
      stepId: 'step-1',
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
      createdAt: builtAt,
      sessionContext: sessionContext(),
      budgetProbeInputContext: budgetProbeInputContext(),
      budgetPolicy,
      startSequence: 1,
    });

    expect(result.status).toBe('completed');
    expect(repo.entries[0]?.metadata?.previousCompactionId).toBe('summary-1');
    expect(repo.entries[0]?.metadata?.previousCompactionId).not.toBe('compaction-old-path');
  });

  it('does not move the active leaf when it changed during the summary model call', async () => {
    const repo = repository();
    const activePathRepo = activePathRepository();
    const orchestrator = new SessionCompactionOrchestrator({
      repository: repo,
      activePathRepository: activePathRepo,
      modelStepProvider: {
        async completeModelStep(_request: ModelStepRuntimeRequest) {
          activePathRepo.appendSourceEntry({
            sourceEntryId: 'source-entry-new-branch',
            sessionId: 'session-1',
            parentSourceEntryId: 'source-entry-leaf-at-start',
            sourceRef: {
              sourceKind: 'session_message',
              sourceId: 'message-new-branch',
              sourceUri: 'session-message://message-new-branch',
              loadedAt: builtAt,
            },
            createdAt: builtAt,
          });
          activePathRepo.setActiveLeaf({
            sessionId: 'session-1',
            leafSourceEntryId: 'source-entry-new-branch',
            updatedAt: builtAt,
            reason: 'source_appended',
          });
          return { ok: true, text: completedSummaryText(), finishReason: 'stop' };
        },
      },
      clock: { now: () => builtAt },
      ids: {
        compactionId: () => 'compaction-1',
        eventId: (() => {
          let index = 0;
          return () => {
            index += 1;
            return `event-compaction-${index}`;
          };
        })(),
        sourceEntryId: () => 'source-entry-compaction-1',
      },
    });

    const result = await orchestrator.compactIfNeeded({
      requestId: 'request-1',
      sessionId: 'session-1',
      runId: 'run-1',
      stepId: 'step-1',
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
      createdAt: builtAt,
      sessionContext: sessionContext(),
      budgetProbeInputContext: budgetProbeInputContext(),
      budgetPolicy,
      startSequence: 1,
    });

    expect(result.status).toBe('completed');
    expect(activePathRepo.getSourceEntryBySourceRef('session-1', {
      sourceKind: 'session_summary',
      sourceId: 'compaction-1',
    })?.parentSourceEntryId).toBe('source-entry-leaf-at-start');
    expect(activePathRepo.getActiveLeaf('session-1')?.leafSourceEntryId).toBe('source-entry-new-branch');
  });

  it('returns skipped when budget probe tokens fit the budget', async () => {
    const repo = repository();
    const orchestrator = new SessionCompactionOrchestrator({
      repository: repo,
      modelStepProvider: {
        async completeModelStep() {
          throw new Error('summary provider should not be called');
        },
      },
      clock: { now: () => builtAt },
      ids: {
        compactionId: () => 'compaction-1',
        eventId: () => 'event-compaction-1',
        sourceEntryId: () => 'source-entry-compaction-1',
      },
    });

    const result = await orchestrator.compactIfNeeded({
      requestId: 'request-1',
      sessionId: 'session-1',
      runId: 'run-1',
      stepId: 'step-1',
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
      createdAt: builtAt,
      sessionContext: { historyEntries: [sessionContext().historyEntries![2]!] },
      budgetProbeInputContext: budgetProbeInputContext({
        historyEntries: [sessionContext().historyEntries![2]!],
      }),
      budgetPolicy: {
        modelContextWindow: 8192,
        reservedOutputTokens: 1024,
        keepRecentTokens: 4096,
      },
      startSequence: 1,
    });

    expect(result).toEqual({ status: 'skipped', events: [] });
    expect(repo.entries).toEqual([]);
  });

  it('does not persist a compaction row when summary model call fails', async () => {
    const repo = repository();
    const orchestrator = new SessionCompactionOrchestrator({
      repository: repo,
      modelStepProvider: {
        async completeModelStep() {
          return {
            ok: false,
            error: {
              code: 'provider_network_error',
              message: 'Provider failed.',
              severity: 'error',
              retryable: true,
              source: 'provider',
            },
          };
        },
      },
      clock: { now: () => builtAt },
      ids: {
        compactionId: () => 'compaction-1',
        eventId: (() => {
          let index = 0;
          return () => {
            index += 1;
            return `event-compaction-${index}`;
          };
        })(),
        sourceEntryId: () => 'source-entry-compaction-1',
      },
    });

    const result = await orchestrator.compactIfNeeded({
      requestId: 'request-1',
      sessionId: 'session-1',
      runId: 'run-1',
      stepId: 'step-1',
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
      createdAt: builtAt,
      sessionContext: sessionContext(),
      budgetProbeInputContext: budgetProbeInputContext(),
      budgetPolicy,
      startSequence: 1,
    });

    expect(result.status).toBe('failed');
    expect(result.events.map((event) => event.eventType)).toEqual([
      'context.compaction.started',
      'context.compaction.failed',
    ]);
    expect(repo.entries).toEqual([]);
  });

  it('does not persist a compaction row when database write fails', async () => {
    const repo = repository();
    repo.failSave = true;
    const orchestrator = new SessionCompactionOrchestrator({
      repository: repo,
      modelStepProvider: {
        async completeModelStep(_request: ModelStepRuntimeRequest) {
          return { ok: true, text: completedSummaryText(), finishReason: 'stop' };
        },
      },
      clock: { now: () => builtAt },
      ids: {
        compactionId: () => 'compaction-1',
        eventId: (() => {
          let index = 0;
          return () => {
            index += 1;
            return `event-compaction-${index}`;
          };
        })(),
        sourceEntryId: () => 'source-entry-compaction-1',
      },
    });

    const result = await orchestrator.compactIfNeeded({
      requestId: 'request-1',
      sessionId: 'session-1',
      runId: 'run-1',
      stepId: 'step-1',
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
      createdAt: builtAt,
      sessionContext: sessionContext(),
      budgetProbeInputContext: budgetProbeInputContext(),
      budgetPolicy,
      startSequence: 1,
    });

    if (result.status !== 'failed') {
      throw new Error(`Expected compaction to fail, got ${result.status}.`);
    }
    expect(result.failure?.code).toBe('database_error');
    expect(repo.entries).toEqual([]);
  });

  it('rolls back the compaction row when active path source persistence fails', async () => {
    const repo = repository();
    const activePathRepo = activePathRepository();
    installTransactionalActivePathSave(repo, activePathRepo, { failSourceWrite: true });
    const orchestrator = new SessionCompactionOrchestrator({
      repository: repo,
      activePathRepository: activePathRepo,
      modelStepProvider: {
        async completeModelStep(_request: ModelStepRuntimeRequest) {
          return { ok: true, text: completedSummaryText(), finishReason: 'stop' };
        },
      },
      clock: { now: () => builtAt },
      ids: {
        compactionId: () => 'compaction-1',
        eventId: (() => {
          let index = 0;
          return () => {
            index += 1;
            return `event-compaction-${index}`;
          };
        })(),
        sourceEntryId: () => 'source-entry-compaction-1',
      },
    });

    const result = await orchestrator.compactIfNeeded({
      requestId: 'request-1',
      sessionId: 'session-1',
      runId: 'run-1',
      stepId: 'step-1',
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
      createdAt: builtAt,
      sessionContext: sessionContext(),
      budgetProbeInputContext: budgetProbeInputContext(),
      budgetPolicy,
      startSequence: 1,
    });

    if (result.status !== 'failed') {
      throw new Error(`Expected compaction to fail, got ${result.status}.`);
    }
    expect(result.failure?.code).toBe('database_error');
    expect(repo.entries).toEqual([]);
    expect(activePathRepo.getSourceEntryBySourceRef('session-1', {
      sourceKind: 'session_summary',
      sourceId: 'compaction-1',
    })).toBeUndefined();
    expect(activePathRepo.getActiveLeaf('session-1')?.leafSourceEntryId).toBe('source-entry-leaf-at-start');
  });
});


