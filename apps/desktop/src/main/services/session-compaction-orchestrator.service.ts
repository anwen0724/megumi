import {
  buildSessionCompactionSummaryInputContext,
  extractSessionCompactionFileMetadata,
  prepareSessionCompactionInput,
  shouldRunSessionCompaction,
} from '@megumi/context-management/session-compaction';
import type { ContextBudgetPolicy } from '@megumi/shared/context-budget-contracts';
import type { ModelId } from '@megumi/shared/model-contracts';
import type { ModelInputContext } from '@megumi/shared/model-input-context-contracts';
import type { ModelStepRuntimeRequest } from '@megumi/shared/model-step-contracts';
import type { ProviderId } from '@megumi/shared/provider-contracts';
import type { RuntimeContext } from '@megumi/shared/runtime-context';
import type { RuntimeError } from '@megumi/shared/runtime-errors';
import type { RuntimeEvent } from '@megumi/shared/runtime-events';
import {
  createContextCompactionCompletedEvent,
  createContextCompactionFailedEvent,
  createContextCompactionStartedEvent,
} from '@megumi/shared/runtime-event-factory';
import type { SessionCompactionEntry } from '@megumi/shared/session-compaction-contracts';
import type { SessionContextInput } from '@megumi/shared/session-context-contracts';

export interface SessionCompactionOrchestratorRepository {
  getLatestCompletedSessionCompaction(sessionId: string): SessionCompactionEntry | null;
  saveSessionCompaction(entry: SessionCompactionEntry): void;
}

export interface SessionCompactionOrchestratorModelStepProvider {
  streamModelStep(request: ModelStepRuntimeRequest): AsyncIterable<RuntimeEvent>;
}

export interface SessionCompactionOrchestratorClock {
  now(): string;
}

export interface SessionCompactionOrchestratorIds {
  compactionId(): string;
  eventId(): string;
}

export interface SessionCompactionOrchestratorOptions {
  repository: SessionCompactionOrchestratorRepository;
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
  preflightInputContext: ModelInputContext;
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
      preflightInputContext: input.preflightInputContext,
      budgetPolicy: input.budgetPolicy,
    });

    if (!pressure.shouldCompact) {
      return { status: 'skipped', events: [] };
    }

    const previous = this.options.repository.getLatestCompletedSessionCompaction(input.sessionId);
    const prepared = prepareSessionCompactionInput({
      sessionId: input.sessionId,
      builtAt: input.createdAt,
      sessionContext: input.sessionContext,
      keepRecentTokens: input.budgetPolicy.keepRecentTokens,
      tokensBefore: pressure.tokensBefore,
    });
    const previousCompactionId = previous?.compactionId ?? latestPreviousSummaryId(input.sessionContext);

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
      this.options.repository.saveSessionCompaction(compaction);
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
    let completed = '';

    try {
      for await (const event of this.options.modelStepProvider.streamModelStep(request)) {
        if (event.eventType === 'assistant.output.completed') {
          const content = (event.payload as { content?: unknown }).content;
          if (typeof content === 'string') {
            completed = content.trim();
          }
        }
        if (event.eventType === 'run.failed') {
          return {
            ok: false,
            error: runtimeErrorFromPayload(event.payload),
          };
        }
      }
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

function runtimeErrorFromPayload(payload: object): RuntimeError {
  const error = (payload as { error?: unknown }).error;
  if (isRuntimeError(error)) {
    return error;
  }
  return runtimeError({
    code: 'runtime_unknown',
    message: 'Context compaction summary model call failed.',
    source: 'provider',
    retryable: true,
  });
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

function isRuntimeError(value: unknown): value is RuntimeError {
  return typeof value === 'object'
    && value !== null
    && typeof (value as RuntimeError).code === 'string'
    && typeof (value as RuntimeError).message === 'string'
    && typeof (value as RuntimeError).severity === 'string'
    && typeof (value as RuntimeError).retryable === 'boolean'
    && typeof (value as RuntimeError).source === 'string';
}
