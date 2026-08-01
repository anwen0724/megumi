/* Coordinates automatic and manual Context compaction through one serializable operation. */
import type { Api, Context as AiContext, Model, Models } from '@megumi/ai';
import type { ObservabilityService } from '@megumi/observability';
import type { SessionHistory } from '@megumi/session';
import type { ActiveContextFacts } from '../active-context';
import type { ContextFailure } from '../context-builder';
import type { ContextPolicy } from '../context-policy';
import type { ContextUsage } from '../context-usage';
import { generateCompactionSummary } from './compaction-summary';
import { planCompaction, validateCompactionReduction } from './compaction-planner';

export interface ContextCompactionProgressStarted {
  readonly status: 'started' | 'completed';
  readonly compactionId: string;
  readonly tokensBefore: number;
  readonly summarizedSourceCount: number;
  readonly firstKeptSourceId?: string;
  readonly previousCompactionId?: string;
}

export interface ContextCompactionProgressFailed {
  readonly status: 'failed';
  readonly compactionId: string;
  readonly tokensBefore: number;
  readonly code: string;
  readonly message: string;
  readonly previousCompactionId?: string;
}

export type ContextCompactionProgress =
  | ContextCompactionProgressStarted
  | ContextCompactionProgressFailed;

export interface CompactContextRequest {
  readonly sessionId: string;
  readonly workspaceId: string;
  readonly model: Model<Api>;
  readonly onProgress?: (progress: ContextCompactionProgress) => void;
  readonly signal?: AbortSignal;
}

export type CompactContextResult =
  | {
      readonly status: 'compacted';
      readonly compactionId: string;
      readonly usageBefore: ContextUsage;
      readonly usageAfter: ContextUsage;
    }
  | {
      readonly status: 'nothing_to_compact';
      readonly reason: 'no_historical_runs' | 'no_older_runs' | 'summary_not_reducing';
    }
  | { readonly status: 'failed'; readonly failure: ContextFailure };

export interface ContextCompactor {
  compact(request: CompactContextRequest): Promise<CompactContextResult>;
}

export interface ExecuteCompactionInput {
  readonly facts: ActiveContextFacts;
  readonly usageBefore: ContextUsage;
  readonly model: Model<Api>;
  readonly policy: ContextPolicy;
  readonly automatic: boolean;
  readonly models: Pick<Models, 'completeSimple'>;
  readonly sessionHistory: Pick<SessionHistory, 'saveCompactionSummary'>;
  readonly observability?: ObservabilityService;
  readonly now: () => string;
  readonly createCompactionId: () => string;
  readonly project: (facts: ActiveContextFacts, signal?: AbortSignal) => Promise<
    | { readonly status: 'built'; readonly context: AiContext }
    | { readonly status: 'failed'; readonly failure: ContextFailure }
  >;
  readonly countUsage: (
    context: AiContext,
    model: Model<Api>,
    policy: ContextPolicy,
    signal?: AbortSignal,
  ) => { readonly status: 'counted'; readonly usage: ContextUsage }
    | { readonly status: 'failed'; readonly failure: ContextFailure };
  readonly onProgress?: (progress: ContextCompactionProgress) => void;
  readonly signal?: AbortSignal;
}

export type ExecuteCompactionResult =
  | {
      readonly status: 'compacted';
      readonly compactionId: string;
      readonly usageAfter: ContextUsage;
      readonly facts: ActiveContextFacts;
    }
  | Extract<CompactContextResult, { status: 'nothing_to_compact' | 'failed' }>;

export async function executeContextCompaction(
  input: ExecuteCompactionInput,
): Promise<ExecuteCompactionResult> {
  const observability = input.observability;
  const traced = Boolean(observability?.getCurrentTrace());
  const span = traced
    ? observability?.startSpan({
        name: 'context.compact',
        correlation: { sessionId: input.facts.sessionId },
      })
    : undefined;
  if (!traced) {
    observability?.recordLog({
      level: 'info',
      event: 'context.compaction.started',
      correlation: { sessionId: input.facts.sessionId },
      attributes: { beforeTokens: input.usageBefore.usedTokens, automatic: input.automatic },
    });
  }
  const operation = async () => {
    const result = await executeCore(input);
    const status = result.status === 'failed'
      ? result.failure.code === 'cancelled' ? 'cancelled' : 'error'
      : 'ok';
    if (span) {
      observability?.endSpan({
        span,
        status,
        attributes: {
          beforeTokens: input.usageBefore.usedTokens,
          automatic: input.automatic,
          ...(result.status === 'compacted' ? { afterTokens: result.usageAfter.usedTokens } : {}),
        },
      });
    }
    if (!traced) {
      observability?.recordLog({
        level: result.status === 'failed' ? 'warn' : 'info',
        event: result.status === 'compacted'
          ? 'context.compaction.completed'
          : 'context.compaction.finished',
        correlation: { sessionId: input.facts.sessionId },
        attributes: { status: result.status, automatic: input.automatic },
      });
      if (result.status === 'compacted') {
        observability?.recordMeasurement({
          name: 'context.compaction.after_tokens',
          value: result.usageAfter.usedTokens,
          unit: 'token',
          correlation: { sessionId: input.facts.sessionId },
        });
      }
    }
    return result;
  };
  return span ? observability!.runInSpanContext(span, operation) : operation();
}

async function executeCore(input: ExecuteCompactionInput): Promise<ExecuteCompactionResult> {
  const plan = planCompaction({
    historicalRuns: input.facts.historicalRuns,
    keepRecentRuns: input.policy.keepRecentRuns,
    ...(input.facts.currentRun ? { currentRun: input.facts.currentRun } : {}),
  });
  if (plan.status === 'nothing_to_compact') return plan;
  if (input.signal?.aborted) return failed(cancelled());

  const compactionId = input.createCompactionId();
  const progressBase = {
    compactionId,
    tokensBefore: input.usageBefore.usedTokens,
    summarizedSourceCount: plan.plan.runs.length,
    ...(plan.plan.firstKeptEntryId
      ? { firstKeptSourceId: plan.plan.firstKeptEntryId }
      : {}),
    ...(input.facts.compactionSummary
      ? { previousCompactionId: input.facts.compactionSummary.compactionId }
      : {}),
  };
  reportProgress(input.onProgress, { status: 'started', ...progressBase });
  const failCompaction = (failure: ContextFailure): Extract<ExecuteCompactionResult, { status: 'failed' }> => {
    reportProgress(input.onProgress, {
      status: 'failed',
      compactionId,
      tokensBefore: input.usageBefore.usedTokens,
      code: failure.code,
      message: failure.message,
      ...(input.facts.compactionSummary
        ? { previousCompactionId: input.facts.compactionSummary.compactionId }
        : {}),
    });
    return failed(failure);
  };

  const generated = await generateCompactionSummary({
    models: input.models,
    model: input.model,
    sessionId: input.facts.sessionId,
    previousSummary: input.facts.compactionSummary?.content,
    runs: plan.plan.runs,
    timestamp: Date.parse(input.now()),
    ...(input.signal ? { signal: input.signal } : {}),
  });
  if (generated.status === 'cancelled') return failCompaction(cancelled());
  if (generated.status === 'failed') return failCompaction(modelFailure(generated.failure));

  const compactedFacts: ActiveContextFacts = {
    ...input.facts,
    historicalRuns: input.facts.historicalRuns.slice(plan.plan.runs.length),
    compactionSummary: { compactionId, content: generated.content },
  };
  const projected = await input.project(compactedFacts, input.signal);
  if (projected.status === 'failed') return failCompaction(projected.failure);
  const projectedUsage = input.countUsage(
    projected.context,
    input.model,
    input.policy,
    input.signal,
  );
  if (projectedUsage.status === 'failed') return failCompaction(projectedUsage.failure);
  const reduction = validateCompactionReduction({
    usageBeforeInputTokens: input.usageBefore.usedTokens,
    usageAfterInputTokens: projectedUsage.usage.usedTokens,
  });
  if (reduction.status === 'nothing_to_compact') {
    reportProgress(input.onProgress, {
      status: 'failed',
      compactionId,
      tokensBefore: input.usageBefore.usedTokens,
      code: reduction.reason,
      message: 'Generated summary did not reduce Context usage.',
    });
    return reduction;
  }
  if (input.signal?.aborted) return failCompaction(cancelled());

  const saved = input.sessionHistory.saveCompactionSummary({
    compaction_id: compactionId,
    session_id: input.facts.sessionId,
    summary_text: generated.content,
    covered_until_entry_id: plan.plan.coveredUntilEntryId,
    ...(plan.plan.firstKeptEntryId ? { first_kept_entry_id: plan.plan.firstKeptEntryId } : {}),
    expected_active_entry_id: input.facts.expectedActiveEntryId,
    created_at: input.now(),
    append_to_active_path: true,
  });
  if (saved.status === 'failed') {
    return failCompaction({
      code: 'compaction_persist_failed',
      message: saved.failure.message,
      retryable: true,
      cause: { owner: 'session', code: saved.failure.code },
    });
  }
  reportProgress(input.onProgress, { status: 'completed', ...progressBase });
  return {
    status: 'compacted',
    compactionId,
    usageAfter: projectedUsage.usage,
    facts: compactedFacts,
  };
}

function modelFailure(error: unknown): ContextFailure {
  const candidate = typeof error === 'object' && error !== null
    ? error as { code?: unknown; message?: unknown; retryable?: unknown }
    : undefined;
  return {
    code: 'compaction_failed',
    message: typeof candidate?.message === 'string'
      ? candidate.message
      : typeof error === 'string' ? error : 'Compaction summary model call failed.',
    retryable: typeof candidate?.retryable === 'boolean' ? candidate.retryable : true,
    cause: {
      owner: 'ai',
      ...(typeof candidate?.code === 'string' ? { code: candidate.code } : {}),
    },
  };
}

function cancelled(): ContextFailure {
  return {
    code: 'cancelled',
    message: 'Context compaction was cancelled.',
    retryable: true,
  };
}

function failed(failure: ContextFailure): Extract<ExecuteCompactionResult, { status: 'failed' }> {
  return { status: 'failed', failure };
}

function reportProgress(
  reporter: ((progress: ContextCompactionProgress) => void) | undefined,
  progress: ContextCompactionProgress,
): void {
  try {
    reporter?.(progress);
  } catch {
    // Progress is diagnostic output and must not change Context business execution.
  }
}
