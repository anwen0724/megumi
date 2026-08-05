/*
 * Coordinates Threshold, Overflow and Manual compaction through one shared
 * implementation: planning, Summary generation, commit validation and Session
 * submission are identical for every trigger.
 */

import type { Api, Context as AiContext, Message, Model, Models, Usage } from '@megumi/ai';
import type { ObservabilityService } from '@megumi/observability';
import type { SessionHistory } from '@megumi/session';
import type { EventBus } from '@megumi/events';
import type { ContextFailure } from '../context';
import type { CompactionPolicy } from '../context-policy';
import type { ContextUsageEstimate } from '../context-usage';
import { cancelledFailure } from '../xml-escape';
import { generateCompactionSummary } from './compaction-summary';
import {
  planCompaction,
  validateCompactionReduction,
  type CompactionMessageSource,
  type CompactionPlan,
} from './compaction-planner';

export type CompactionTrigger = 'threshold' | 'overflow' | 'manual';

export interface ContextCompactionProgressStarted {
  readonly status: 'started' | 'completed';
  readonly compactionId: string;
  readonly tokensBefore: number;
  readonly summarizedMessageCount: number;
  readonly firstKeptEntryId?: string;
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
  readonly trigger: CompactionTrigger;
  readonly onProgress?: (progress: ContextCompactionProgress) => void;
  /** Optional bus: compaction lifecycle facts are published here. */
  readonly events?: EventBus;
  readonly signal?: AbortSignal;
}

export type CompactContextResult =
  | {
      readonly status: 'compacted';
      readonly compactionId: string;
      readonly usageBefore: ContextUsageEstimate;
      readonly usageAfter: ContextUsageEstimate;
    }
  | {
      readonly status: 'nothing_to_compact';
      readonly reason: 'no_historical_messages' | 'no_older_messages' | 'summary_not_reducing';
    }
  | { readonly status: 'failed'; readonly failure: ContextFailure };

export interface ContextCompactor {
  compact(request: CompactContextRequest): Promise<CompactContextResult>;
}

export interface ExecuteCompactionInput {
  readonly sessionId: string;
  readonly trigger: CompactionTrigger;
  readonly sources: readonly CompactionMessageSource[];
  /** The Prompt whose tokens are the before-baseline; compared like-for-like with the projection. */
  readonly beforeContext: AiContext;
  readonly expectedActiveEntryId: string;
  readonly previousSummary?: string;
  readonly policy: CompactionPolicy;
  readonly model: Model<Api>;
  readonly models: Pick<Models, 'completeSimple'>;
  readonly sessionHistory: Pick<SessionHistory, 'saveCompactionSummary'>;
  readonly observability?: ObservabilityService;
  readonly now: () => string;
  readonly createCompactionId: () => string;
  readonly estimateMessageTokens: (message: Message) => number;
  /** Builds the Prompt with the generated Summary placed at its history position. */
  readonly project: (plan: CompactionPlan, summaryText: string, signal?: AbortSignal) => Promise<
    | { readonly status: 'built'; readonly context: AiContext }
    | { readonly status: 'failed'; readonly failure: ContextFailure }
  >;
  readonly countUsage: (context: AiContext, signal?: AbortSignal) => ContextUsageEstimate;
  readonly onProgress?: (progress: ContextCompactionProgress) => void;
  /** Optional bus: compaction lifecycle facts are published here. */
  readonly events?: EventBus;
  readonly signal?: AbortSignal;
}

export type ExecuteCompactionResult =
  | {
      readonly status: 'compacted';
      readonly compactionId: string;
      readonly usageAfter: ContextUsageEstimate;
      readonly summaryUsage?: Usage;
    }
  | Extract<CompactContextResult, { status: 'nothing_to_compact' | 'failed' }>;

export async function executeContextCompaction(
  input: ExecuteCompactionInput,
): Promise<ExecuteCompactionResult> {
  const plan = planCompaction({
    sources: input.sources,
    policy: input.policy,
    estimateMessageTokens: input.estimateMessageTokens,
  });
  if (plan.status === 'nothing_to_compact') return plan;
  if (input.signal?.aborted) return failed(cancelledFailure('Context compaction was cancelled.'));

  const compactionId = input.createCompactionId();
  const beforeTokens = input.countUsage(input.beforeContext, input.signal).tokens;
  const progressBase = {
    compactionId,
    tokensBefore: beforeTokens,
    summarizedMessageCount: plan.plan.summarizedMessages.length,
    ...(plan.plan.firstKeptEntryId ? { firstKeptEntryId: plan.plan.firstKeptEntryId } : {}),
  };
  reportProgress(input.onProgress, { status: 'started', ...progressBase }, input.sessionId, input.trigger, input.events);
  input.observability?.recordLog({
    level: 'info',
    event: 'context.compaction.started',
    correlation: { sessionId: input.sessionId },
    attributes: {
      beforeTokens,
      trigger: input.trigger,
      keptMessages: plan.plan.summarizedMessages.length,
      firstKeptEntryId: plan.plan.firstKeptEntryId,
    },
  });
  const failCompaction = (failure: ContextFailure): Extract<ExecuteCompactionResult, { status: 'failed' }> => {
    reportProgress(input.onProgress, {
      status: 'failed',
      compactionId,
      tokensBefore: progressBase.tokensBefore,
      code: failure.code,
      message: failure.message,
    }, input.sessionId, input.trigger, input.events);
    return failed(failure);
  };

  const generated = await generateCompactionSummary({
    models: input.models,
    model: input.model,
    sessionId: input.sessionId,
    previousSummary: input.previousSummary,
    messages: plan.plan.summarizedMessages,
    timestamp: Date.parse(input.now()),
    ...(input.signal ? { signal: input.signal } : {}),
  });
  if (generated.status === 'cancelled') return failCompaction(cancelledFailure('Context compaction was cancelled.'));
  if (generated.status === 'failed') return failCompaction(modelFailure(generated.failure));

  const projected = await input.project(plan.plan, generated.content, input.signal);
  if (projected.status === 'failed') return failCompaction(projected.failure);
  // The countUsage callback throws on abort; check the signal first so both the
  // build and compact paths settle on the same cancelled result.
  if (input.signal?.aborted) return failCompaction(cancelledFailure('Context compaction was cancelled.'));
  const projectedUsage = input.countUsage(projected.context, input.signal);
  const reduction = validateCompactionReduction({
    usageBeforeInputTokens: beforeTokens,
    usageAfterInputTokens: projectedUsage.tokens,
  });
  if (reduction.status === 'nothing_to_compact') {
    reportProgress(input.onProgress, {
      status: 'failed',
      compactionId,
      tokensBefore: beforeTokens,
      code: reduction.reason,
      message: 'Generated summary did not reduce Context usage.',
    }, input.sessionId, input.trigger, input.events);
    return reduction;
  }
  if (input.signal?.aborted) return failCompaction(cancelledFailure('Context compaction was cancelled.'));

  const saved = input.sessionHistory.saveCompactionSummary({
    compaction_id: compactionId,
    session_id: input.sessionId,
    summary_text: generated.content,
    covered_until_entry_id: plan.plan.coveredUntilEntryId,
    first_kept_entry_id: plan.plan.firstKeptEntryId,
    usage: generated.usage,
    expected_active_entry_id: input.expectedActiveEntryId,
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
  reportProgress(input.onProgress, { status: 'completed', ...progressBase }, input.sessionId, input.trigger, input.events);
  input.observability?.recordLog({
    level: 'info',
    event: 'context.compaction.completed',
    correlation: { sessionId: input.sessionId },
    attributes: { beforeTokens, afterTokens: projectedUsage.tokens, trigger: input.trigger },
  });
  input.observability?.recordMeasurement({
    name: 'context.compaction.after_tokens',
    value: projectedUsage.tokens,
    unit: 'token',
    correlation: { sessionId: input.sessionId },
  });
  return {
    status: 'compacted',
    compactionId,
    usageAfter: projectedUsage,
    summaryUsage: generated.usage,
  };
}

function modelFailure(error: unknown): ContextFailure {
  const candidate = typeof error === 'object' && error !== null
    ? error as { code?: unknown; message?: unknown; retryable?: unknown }
    : undefined;
  return {
    code: 'compaction_failed',
    message: resolveFailureMessage(error, candidate),
    retryable: typeof candidate?.retryable === 'boolean' ? candidate.retryable : true,
    cause: {
      owner: 'ai',
      ...(typeof candidate?.code === 'string' ? { code: candidate.code } : {}),
    },
  };
}

function resolveFailureMessage(
  error: unknown,
  candidate: { readonly message?: unknown } | undefined,
): string {
  if (typeof candidate?.message === 'string') return candidate.message;
  if (typeof error === 'string') return error;
  return 'Compaction summary model call failed.';
}

function failed(failure: ContextFailure): Extract<ExecuteCompactionResult, { status: 'failed' }> {
  return { status: 'failed', failure };
}

function reportProgress(
  reporter: ((progress: ContextCompactionProgress) => void) | undefined,
  progress: ContextCompactionProgress,
  sessionId: string,
  trigger: CompactionTrigger,
  events?: EventBus,
): void {
  try {
    reporter?.(progress);
  } catch {
    // Progress is diagnostic output and must not change Context business execution.
  }
  if (!events) return;
  // Compaction is a session-scoped fact: publish the lifecycle pair so the UI
  // can render the activity item. Best-effort, like every bus publish.
  if (progress.status === 'started') {
    events.publish({
      type: 'session.compaction.started',
      payload: { trigger, compactionId: progress.compactionId },
      sessionId,
    });
  } else if (progress.status === 'completed') {
    events.publish({
      type: 'session.compaction.ended',
      payload: { status: 'completed', compactionId: progress.compactionId },
      sessionId,
    });
  } else {
    // ContextCompactionProgressStarted.status includes 'completed', so narrow
    // by the failed variant's own fields instead of the status union.
    const failed = progress as ContextCompactionProgressFailed;
    events.publish({
      type: 'session.compaction.ended',
      payload: {
        status: 'failed',
        compactionId: failed.compactionId,
        error: { message: failed.message, code: failed.code },
      },
      sessionId,
    });
  }
}
