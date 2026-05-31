// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { ContextBudgetPolicy } from '@megumi/shared/context-budget-contracts';
import type { ModelStepRuntimeRequest } from '@megumi/shared/model-step-contracts';
import type { RuntimeEvent } from '@megumi/shared/runtime-events';
import type { SessionCompactionEntry } from '@megumi/shared/session-compaction-contracts';
import type { SessionContextInput } from '@megumi/shared/session-context-contracts';
import { buildModelStepInputContextFromSources } from '@megumi/context-management/model-step-input-context';
import {
  SessionCompactionOrchestrator,
  type SessionCompactionOrchestratorRepository,
} from '@megumi/desktop/main/services/session-compaction-orchestrator.service';

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

function preflightInputContext(input: SessionContextInput = sessionContext()) {
  return buildModelStepInputContextFromSources({
    contextId: 'model-input-context:preflight',
    sessionId: 'session-1',
    runId: 'run-1',
    stepId: 'step-1',
    buildReason: 'initial_model_step_preflight',
    builtAt,
    sessionContext: input,
    budgetPolicy: {
      modelContextWindow: 1_000_000,
      reservedOutputTokens: 0,
      keepRecentTokens: 1_000_000,
    },
  });
}

function completedSummaryEvent(request: ModelStepRuntimeRequest): RuntimeEvent {
  return {
    eventId: 'event-summary-completed',
    schemaVersion: 1,
    eventType: 'assistant.output.completed',
    sessionId: request.sessionId,
    runId: request.runId,
    stepId: request.stepId,
    requestId: request.requestId,
    sequence: 1,
    createdAt: builtAt,
    source: 'provider',
    visibility: 'user',
    persist: 'required',
    payload: {
      content: [
        '## Goal',
        'Continue the 09 work.',
        '<read-files>',
        'packages/context-management/session-compaction.ts',
        '</read-files>',
        '<modified-files>',
        'apps/desktop/src/main/services/session-run.service.ts',
        '</modified-files>',
      ].join('\n'),
    },
  };
}

describe('SessionCompactionOrchestrator', () => {
  it('runs an internal summary model call and persists a completed compaction row', async () => {
    const repo = repository();
    const requests: ModelStepRuntimeRequest[] = [];
    const orchestrator = new SessionCompactionOrchestrator({
      repository: repo,
      modelStepProvider: {
        streamModelStep: async function* (request) {
          requests.push(request);
          yield completedSummaryEvent(request);
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
      preflightInputContext: preflightInputContext(),
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
          readFiles: ['packages/context-management/session-compaction.ts'],
          modifiedFiles: ['apps/desktop/src/main/services/session-run.service.ts'],
        },
      }),
    ]);
  });

  it('returns skipped when preflight tokens fit the budget', async () => {
    const repo = repository();
    const orchestrator = new SessionCompactionOrchestrator({
      repository: repo,
      modelStepProvider: {
        streamModelStep: async function* () {
          throw new Error('summary provider should not be called');
        },
      },
      clock: { now: () => builtAt },
      ids: {
        compactionId: () => 'compaction-1',
        eventId: () => 'event-compaction-1',
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
      preflightInputContext: preflightInputContext({
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
        streamModelStep: async function* (request) {
          yield {
            eventId: 'event-summary-failed',
            schemaVersion: 1,
            eventType: 'run.failed',
            sessionId: request.sessionId,
            runId: request.runId,
            stepId: request.stepId,
            requestId: request.requestId,
            sequence: 1,
            createdAt: builtAt,
            source: 'provider',
            visibility: 'user',
            persist: 'required',
            payload: {
              error: {
                code: 'provider_network_error',
                message: 'Provider failed.',
                severity: 'error',
                retryable: true,
                source: 'provider',
              },
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
      preflightInputContext: preflightInputContext(),
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
        streamModelStep: async function* (request) {
          yield completedSummaryEvent(request);
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
      preflightInputContext: preflightInputContext(),
      budgetPolicy,
      startSequence: 1,
    });

    if (result.status !== 'failed') {
      throw new Error(`Expected compaction to fail, got ${result.status}.`);
    }
    expect(result.failure?.code).toBe('database_error');
    expect(repo.entries).toEqual([]);
  });
});
