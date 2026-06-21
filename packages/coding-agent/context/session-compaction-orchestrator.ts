// Orchestrates Coding Agent session compaction through provider and persistence ports.
import {
  buildSessionCompactionSummaryInputContext,
  extractSessionCompactionFileMetadata,
  prepareSessionCompactionInput,
  shouldRunSessionCompaction,
} from './session-compaction';
import type { ModelStepCompletionResult } from '@megumi/agent';
import type { ContextBudgetPolicy } from '@megumi/shared/context';
import type { ModelId } from '@megumi/shared/model';
import type {
  ModelInputContext,
  ModelInputContextSourceKind,
} from '@megumi/shared/model';
import type { ModelStepRuntimeRequest } from '@megumi/shared/model';
import type { ProviderId } from '@megumi/shared/provider';
import type { RuntimeContext } from '@megumi/shared/runtime';
import type { RuntimeError } from '@megumi/shared/runtime';
import type { RuntimeEvent } from '@megumi/shared/runtime';
import {
  createContextCompactionCompletedEvent,
  createContextCompactionFailedEvent,
  createContextCompactionStartedEvent,
} from '@megumi/shared/runtime';
import type { SessionCompactionEntry } from '@megumi/shared/session';
import type { SessionContextInput } from '@megumi/shared/session';
import type { SessionActiveLeaf, SessionSourceEntry } from '@megumi/shared/session';

export interface SessionCompactionOrchestratorRepository {
  getLatestCompletedSessionCompaction(sessionId: string): SessionCompactionEntry | null;
  saveSessionCompaction(entry: SessionCompactionEntry): void;
  saveSessionCompactionWithActivePath?(input: {
    compaction: SessionCompactionEntry;
    sourceEntry: SessionSourceEntry;
    activeLeaf: SessionActiveLeaf;
    expectedCurrentLeafSourceEntryId?: string;
  }): {
    sourceEntry: SessionSourceEntry;
    activeLeafAdvanced: boolean;
  };
}

export interface SessionCompactionActivePathRepository {
  getActiveLeaf(sessionId: string): SessionActiveLeaf | undefined;
  appendSourceEntry(entry: SessionSourceEntry): SessionSourceEntry;
  setActiveLeaf(activeLeaf: SessionActiveLeaf): SessionActiveLeaf;
  getSourceEntryBySourceRef(
    sessionId: string,
    sourceRef: {
      sourceKind: ModelInputContextSourceKind;
      sourceId: string;
    },
  ): SessionSourceEntry | undefined;
}

export interface SessionCompactionOrchestratorModelStepProvider {
  completeModelStep(request: ModelStepRuntimeRequest): Promise<ModelStepCompletionResult>;
}

export interface SessionCompactionOrchestratorClock {
  now(): string;
}

export interface SessionCompactionOrchestratorIds {
  compactionId(): string;
  eventId(): string;
  sourceEntryId(): string;
}

export interface SessionCompactionOrchestratorOptions {
  repository: SessionCompactionOrchestratorRepository;
  activePathRepository?: SessionCompactionActivePathRepository;
  modelStepProvider: SessionCompactionOrchestratorModelStepProvider;
  clock: SessionCompactionOrchestratorClock;
  ids: SessionCompactionOrchestratorIds;
}

export interface CompactIfNeededInput {
  requestId: string;
  sessionId: string;
  runId: string;
  stepId: string;
  providerId: ProviderId;
  modelId: ModelId | string;
  runtimeContext?: RuntimeContext;
  createdAt: string;
  sessionContext: SessionContextInput;
  budgetProbeInputContext: ModelInputContext;
  budgetPolicy: ContextBudgetPolicy;
  startSequence: number;
}

export type SessionCompactionOrchestrationResult =
  | { status: 'skipped'; events: [] }
  | { status: 'completed'; events: RuntimeEvent[]; compaction: SessionCompactionEntry }
  | { status: 'failed'; events: RuntimeEvent[]; failure: RuntimeError };

export class SessionCompactionOrchestrator {
  constructor(private readonly options: SessionCompactionOrchestratorOptions) {}

  async compactIfNeeded(input: CompactIfNeededInput): Promise<SessionCompactionOrchestrationResult> {
    const pressure = shouldRunSessionCompaction({
      budgetProbeInputContext: input.budgetProbeInputContext,
      budgetPolicy: input.budgetPolicy,
    });

    if (!pressure.shouldCompact) {
      return { status: 'skipped', events: [] };
    }

    const prepared = prepareSessionCompactionInput({
      sessionId: input.sessionId,
      builtAt: input.createdAt,
      sessionContext: input.sessionContext,
      keepRecentTokens: input.budgetPolicy.keepRecentTokens,
      tokensBefore: pressure.tokensBefore,
    });
    const previousCompactionId = latestPreviousSummaryId(input.sessionContext);

    if (!prepared) {
      const error = runtimeError({
        code: 'runtime_protocol_violation',
        message: 'Context compaction was required but no completed session history could be summarized.',
        source: 'main',
        retryable: false,
      });
      return this.failedResult(input, pressure.tokensBefore, previousCompactionId, error, input.startSequence);
    }

    const compactionId = this.options.ids.compactionId();
    const started = createContextCompactionStartedEvent({
      eventId: this.options.ids.eventId(),
      runId: input.runId,
      sessionId: input.sessionId,
      stepId: input.stepId,
      requestId: input.requestId,
      sequence: input.startSequence + 1,
      createdAt: this.options.clock.now(),
      runtimeContext: input.runtimeContext,
      payload: {
        compactionId,
        triggerReason: pressure.triggerReason,
        tokensBefore: pressure.tokensBefore,
        firstKeptSourceRef: prepared.firstKeptSourceRef,
        summarizedSourceCount: summarizedSourceCount(prepared),
        ...(previousCompactionId ? { previousCompactionId } : {}),
      },
    });

    const summaryStepId = `${input.stepId}:compaction:${compactionId}`;
    const summaryRequest: ModelStepRuntimeRequest = {
      requestId: `${input.requestId}:compaction:${compactionId}`,
      sessionId: input.sessionId,
      runId: input.runId,
      stepId: summaryStepId,
      modelStepId: `model-step:compaction:${compactionId}`,
      providerId: input.providerId,
      modelId: input.modelId,
      inputContext: buildSessionCompactionSummaryInputContext({
        contextId: `model-input-context:compaction:${compactionId}`,
        sessionId: input.sessionId,
        runId: input.runId,
        stepId: summaryStepId,
        builtAt: input.createdAt,
        prepared,
        budgetPolicy: input.budgetPolicy,
      }),
      toolDefinitions: undefined,
      runtimeContext: input.runtimeContext,
      createdAt: input.createdAt,
    };

    const activePathRepository = this.options.activePathRepository;
    const parentLeafAtStart = activePathRepository?.getActiveLeaf(input.sessionId)?.leafSourceEntryId ?? undefined;
    const compactionSourceEntryId = activePathRepository ? this.options.ids.sourceEntryId() : undefined;
    const summary = await this.collectSummary(summaryRequest);
    if (!summary.ok) {
      return {
        status: 'failed',
        events: [
          started,
          this.failedEvent(input, pressure.tokensBefore, previousCompactionId, summary.error, started.sequence + 1),
        ],
        failure: summary.error,
      };
    }

    const fileMetadata = extractSessionCompactionFileMetadata(summary.value);
    const compaction: SessionCompactionEntry = {
      compactionId,
      sessionId: input.sessionId,
      summary: summary.value,
      summaryKind: 'compaction',
      firstKeptSourceRef: prepared.firstKeptSourceRef,
      tokensBefore: pressure.tokensBefore,
      triggerReason: pressure.triggerReason,
      status: 'completed',
      createdAt: this.options.clock.now(),
      metadata: {
        ...(previousCompactionId ? { previousCompactionId } : {}),
        summarizedSourceCount: summarizedSourceCount(prepared),
        ...fileMetadata,
      },
    };

    try {
      if (activePathRepository && compactionSourceEntryId) {
        const sourceEntry: SessionSourceEntry = {
          sourceEntryId: compactionSourceEntryId,
          sessionId: input.sessionId,
          ...(parentLeafAtStart ? { parentSourceEntryId: parentLeafAtStart } : {}),
          sourceRef: {
            sourceKind: 'session_summary',
            sourceId: compaction.compactionId,
            sourceUri: `session-compaction://${compaction.compactionId}`,
            loadedAt: compaction.createdAt,
          },
          createdAt: compaction.createdAt,
          metadata: {
            runId: input.runId,
            stepId: input.stepId,
            triggerReason: compaction.triggerReason,
          },
        };
        const activeLeaf: SessionActiveLeaf = {
          sessionId: input.sessionId,
          leafSourceEntryId: compactionSourceEntryId,
          updatedAt: compaction.createdAt,
          reason: 'source_appended',
          metadata: {
            runId: input.runId,
            stepId: input.stepId,
            triggerReason: compaction.triggerReason,
          },
        };

        if (this.options.repository.saveSessionCompactionWithActivePath) {
          this.options.repository.saveSessionCompactionWithActivePath({
            compaction,
            sourceEntry,
            activeLeaf,
            ...(parentLeafAtStart ? { expectedCurrentLeafSourceEntryId: parentLeafAtStart } : {}),
          });
        } else {
          this.options.repository.saveSessionCompaction(compaction);
          activePathRepository.appendSourceEntry(sourceEntry);

          const currentLeaf = activePathRepository.getActiveLeaf(input.sessionId)?.leafSourceEntryId ?? undefined;
          if (currentLeaf === parentLeafAtStart) {
            activePathRepository.setActiveLeaf(activeLeaf);
          }
        }
      } else {
        this.options.repository.saveSessionCompaction(compaction);
      }
    } catch {
      const error = runtimeError({
        code: 'database_error',
        message: 'Context compaction summary was generated but could not be persisted.',
        source: 'database',
        retryable: true,
      });
      return {
        status: 'failed',
        events: [
          started,
          this.failedEvent(input, pressure.tokensBefore, previousCompactionId, error, started.sequence + 1),
        ],
        failure: error,
      };
    }

    const completed = createContextCompactionCompletedEvent({
      eventId: this.options.ids.eventId(),
      runId: input.runId,
      sessionId: input.sessionId,
      stepId: input.stepId,
      requestId: input.requestId,
      sequence: started.sequence + 1,
      createdAt: this.options.clock.now(),
      runtimeContext: input.runtimeContext,
      payload: {
        compactionId,
        triggerReason: pressure.triggerReason,
        tokensBefore: pressure.tokensBefore,
        firstKeptSourceRef: prepared.firstKeptSourceRef,
        summarizedSourceCount: summarizedSourceCount(prepared),
        ...(previousCompactionId ? { previousCompactionId } : {}),
        ...fileMetadata,
      },
    });

    return {
      status: 'completed',
      events: [started, completed],
      compaction,
    };
  }

  private async collectSummary(request: ModelStepRuntimeRequest): Promise<
    | { ok: true; value: string }
    | { ok: false; error: RuntimeError }
  > {
    try {
      const completion = await this.options.modelStepProvider.completeModelStep(request);
      if (!completion.ok) {
        return {
          ok: false,
          error: completion.error,
        };
      }
      const completed = completion.text.trim();
      if (completed.length === 0) {
        return {
          ok: false,
          error: runtimeError({
            code: 'runtime_protocol_violation',
            message: 'Context compaction summary model call did not produce summary text.',
            source: 'provider',
            retryable: true,
          }),
        };
      }
      return { ok: true, value: completed };
    } catch {
      return {
        ok: false,
        error: runtimeError({
          code: 'runtime_unknown',
          message: 'Context compaction summary model call failed.',
          source: 'main',
          retryable: true,
        }),
      };
    }
  }

  private failedResult(
    input: CompactIfNeededInput,
    tokensBefore: number,
    previousCompactionId: string | undefined,
    error: RuntimeError,
    startSequence: number,
  ): SessionCompactionOrchestrationResult {
    return {
      status: 'failed',
      events: [
        this.failedEvent(input, tokensBefore, previousCompactionId, error, startSequence + 1),
      ],
      failure: error,
    };
  }

  private failedEvent(
    input: CompactIfNeededInput,
    tokensBefore: number,
    previousCompactionId: string | undefined,
    error: RuntimeError,
    sequence: number,
  ): RuntimeEvent {
    return createContextCompactionFailedEvent({
      eventId: this.options.ids.eventId(),
      runId: input.runId,
      sessionId: input.sessionId,
      stepId: input.stepId,
      requestId: input.requestId,
      sequence,
      createdAt: this.options.clock.now(),
      runtimeContext: input.runtimeContext,
      payload: {
        triggerReason: 'context_budget_pressure',
        tokensBefore,
        ...(previousCompactionId ? { previousCompactionId } : {}),
        error,
      },
    });
  }
}

function summarizedSourceCount(prepared: {
  historyEntriesToSummarize: unknown[];
  runtimeFactsToSummarize: unknown[];
}): number {
  return prepared.historyEntriesToSummarize.length + prepared.runtimeFactsToSummarize.length;
}

function latestPreviousSummaryId(input: SessionContextInput): string | undefined {
  return input.summaryEntries
    ?.filter((entry) => entry.summaryKind === 'compaction')
    .at(-1)
    ?.summaryId;
}

function runtimeError(input: {
  code: RuntimeError['code'];
  message: string;
  source: RuntimeError['source'];
  retryable: boolean;
}): RuntimeError {
  return {
    code: input.code,
    message: input.message,
    severity: 'error',
    retryable: input.retryable,
    source: input.source,
  };
}

