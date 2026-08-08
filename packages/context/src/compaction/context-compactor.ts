/*
 * Owns one compaction transaction for Threshold, Overflow and Manual triggers:
 * planning, Summary generation, the in-memory projected ResolvedContext, the
 * candidate Prompt through PromptBuilder, full-Prompt Usage comparison, the
 * optimistic Session commit, Events and Observability all live here. The
 * projection is never returned or persisted: only the committed Summary is a
 * Session fact, and ContextBuilder re-reads the authoritative history after.
 */

import type { Api, Model, Models, Usage } from '@megumi/ai';
import { estimateMessageTokens } from '@megumi/ai/utils/estimate';
import type { EventBus } from '@megumi/events';
import type { ObservabilityService } from '@megumi/observability';
import type { SessionHistory } from '@megumi/session';
import type { ContextFailure, ContextCompactionProgress, CompactionTrigger, CompactContextResult } from '../context';
import type { CompactionPolicy } from '../context-policy';
import type { ContextUsageEstimate } from '../context-usage-calculator';
import {
  buildCancelledContextFailure,
  buildCompactionPersistContextFailure,
  buildFailedContextResult,
  buildSummaryModelContextFailure,
  buildUnexpectedContextFailure,
} from '../context-failure-factory';
import type { ResolvedContext } from '../context-resolver';
import type { MaterializedHistory } from '../prompt/context-message-builder';
import type { PromptBuilder } from '../prompt/prompt-builder';
import type { Prompt } from '../context';
import {
  planCompaction,
  type CompactionPlan,
} from './compaction-planner';
import { generateCompactionSummary } from './compaction-summary-generator';

export interface ExecuteCompactionInput {
  readonly sessionId: string;
  readonly trigger: CompactionTrigger;
  /** The resolved facts the pre-compaction Prompt was built from. */
  readonly context: ResolvedContext;
  /** The pre-compaction full Prompt; its Usage is the before-baseline. */
  readonly prompt: Prompt;
  /** The materialized mapping of the same history. */
  readonly materialized: MaterializedHistory;
  readonly policy: CompactionPolicy;
  readonly model: Model<Api>;
  readonly models: Pick<Models, 'completeSimple'>;
  readonly sessionHistory: Pick<
    SessionHistory,
    'beginCompaction' | 'completeCompaction' | 'endCompaction'
  >;
  /** Builds the candidate Prompt from the in-memory projected ResolvedContext. */
  readonly promptBuilder: PromptBuilder;
  /** The one complete-Prompt usage entry shared with ContextBuilder. */
  readonly calculatePromptUsage: (prompt: Prompt) => ContextUsageEstimate;
  readonly observability?: ObservabilityService;
  readonly now: () => string;
  readonly createCompactionId: () => string;
  /** Bus injected once at Context creation; compaction lifecycle facts are published here. */
  readonly events?: EventBus;
  readonly onProgress?: (progress: ContextCompactionProgress) => void;
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

/**
 * Executes one planned compaction and preserves the lifecycle write-before-event
 * invariant for every started, completed, failed, or cancelled outcome.
 */
export async function executeContextCompaction(
  input: ExecuteCompactionInput,
): Promise<ExecuteCompactionResult> {
  const plan = planCompaction({
    sources: input.materialized.compactableSources,
    policy: input.policy,
    estimateMessageTokens,
  });
  if (plan.status === 'nothing_to_compact') return plan;
  if (input.signal?.aborted) return failed(buildCancelledContextFailure('Context compaction was cancelled.'));

  const compactionId = input.createCompactionId();
  const startedAt = input.now();
  const beforeTokens = input.calculatePromptUsage(input.prompt).tokens;
  const progressBase = {
    compactionId,
    tokensBefore: beforeTokens,
    summarizedMessageCount: plan.plan.summarizedMessages.length,
    ...(plan.plan.firstKeptEntryId ? { firstKeptEntryId: plan.plan.firstKeptEntryId } : {}),
  };
  const started = input.sessionHistory.beginCompaction({
    compactionId,
    sessionId: input.sessionId,
    anchorEntryId: plan.plan.coveredUntilEntryId,
    trigger: input.trigger,
    startedAt,
  });
  if (started.status === 'failed') {
    return failed(buildCompactionPersistContextFailure({
      message: started.failure.message,
      sourceCode: started.failure.code,
    }));
  }
  reportProgress(input.onProgress, { status: 'started', ...progressBase });
  publishCompactionStarted(input.events, input.sessionId, input.trigger, compactionId);
  recordCompactionLog(input.observability, {
    level: 'info',
    event: 'context.compaction.started',
    correlation: { sessionId: input.sessionId },
    attributes: {
      beforeTokens,
      trigger: input.trigger,
      keptMessages: keptCompactableMessageCount(input, plan.plan),
      firstKeptEntryId: plan.plan.firstKeptEntryId,
    },
  });
  const settleFailure = (
    failure: ContextFailure,
    status: 'failed' | 'cancelled',
  ): Extract<ExecuteCompactionResult, { status: 'failed' }> => {
    const ended = input.sessionHistory.endCompaction({
      compactionId,
      sessionId: input.sessionId,
      status,
      ...(status === 'failed'
        ? { error: { code: failure.code, message: failure.message } }
        : {}),
      completedAt: input.now(),
    });
    if (ended.status === 'failed') {
      return failed(buildCompactionPersistContextFailure({
        message: ended.failure.message,
        sourceCode: ended.failure.code,
      }));
    }
    reportProgress(input.onProgress, status === 'cancelled'
      ? { status: 'cancelled', compactionId, tokensBefore: beforeTokens }
      : {
          status: 'failed',
          compactionId,
          tokensBefore: beforeTokens,
          code: failure.code,
          message: failure.message,
        });
    if (status === 'cancelled') {
      publishCompactionEnded(input.events, input.sessionId, { status, compactionId });
    } else {
      publishCompactionEnded(input.events, input.sessionId, {
        status,
        compactionId,
        error: { code: failure.code, message: failure.message },
      });
    }
    return failed(failure);
  };

  try {
    const generated = await generateCompactionSummary({
      models: input.models,
      model: input.model,
      sessionId: input.sessionId,
      previousSummary: input.materialized.previousSummary,
      messages: plan.plan.summarizedMessages,
      turnPrefixMessages: plan.plan.turnPrefixMessages,
      timestamp: Date.parse(startedAt),
      ...(input.signal ? { signal: input.signal } : {}),
    });
    if (generated.status === 'cancelled') {
      return settleFailure(
        buildCancelledContextFailure('Context compaction was cancelled.'),
        'cancelled',
      );
    }
    if (generated.status === 'failed') {
      return settleFailure(buildSummaryModelContextFailure(generated.failure), 'failed');
    }

    const projected = await projectCandidate(
      input,
      compactionId,
      startedAt,
      plan.plan,
      generated.content,
      generated.usage,
    );
    if (projected.status === 'failed') {
      return settleFailure(
        projected.failure,
        projected.failure.code === 'cancelled' ? 'cancelled' : 'failed',
      );
    }
    if (input.signal?.aborted) {
      return settleFailure(
        buildCancelledContextFailure('Context compaction was cancelled.'),
        'cancelled',
      );
    }
    const projectedUsage = input.calculatePromptUsage(projected.prompt);
    const completedAt = input.now();
    const saved = input.sessionHistory.completeCompaction({
      compactionId,
      sessionId: input.sessionId,
      summaryText: generated.content,
      coveredUntilEntryId: plan.plan.coveredUntilEntryId,
      firstKeptEntryId: plan.plan.firstKeptEntryId,
      usage: generated.usage,
      expectedActiveEntryId: input.materialized.expectedActiveEntryId,
      completedAt,
      appendToActivePath: true,
    });
    if (saved.status === 'failed') {
      return settleFailure(buildCompactionPersistContextFailure({
        message: saved.failure.message,
        sourceCode: saved.failure.code,
      }), 'failed');
    }
    reportProgress(input.onProgress, { status: 'completed', ...progressBase });
    publishCompactionEnded(input.events, input.sessionId, { status: 'completed', compactionId });
    recordCompactionLog(input.observability, {
      level: 'info',
      event: 'context.compaction.completed',
      correlation: { sessionId: input.sessionId },
      attributes: { beforeTokens, afterTokens: projectedUsage.tokens, trigger: input.trigger },
    });
    recordCompactionMeasurement(input.observability, {
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
  } catch (error) {
    const cancelled = input.signal?.aborted || isAbortError(error);
    return settleFailure(
      cancelled
        ? buildCancelledContextFailure('Context compaction was cancelled.')
        : buildUnexpectedContextFailure({
            code: 'compaction_failed',
            message: error instanceof Error ? error.message : 'Context compaction failed.',
          }),
      cancelled ? 'cancelled' : 'failed',
    );
  }
}

/**
 * Forms the in-memory projected ResolvedContext whose activeSessionHistory is
 * the to-be-committed Summary plus the genuinely kept entries, then builds the
 * candidate Prompt through the same PromptBuilder and rules as the final build.
 * The projection is a pre-commit validation only: it is never returned to
 * callers and never written to long-term state.
 */
async function projectCandidate(
  input: ExecuteCompactionInput,
  compactionId: string,
  createdAt: string,
  plan: CompactionPlan,
  summaryText: string,
  summaryUsage: Usage | undefined,
): Promise<{ readonly status: 'built'; readonly prompt: Prompt } | { readonly status: 'failed'; readonly failure: ContextFailure }> {
  if (input.signal?.aborted) {
    return buildFailedContextResult(buildCancelledContextFailure('Context operation was cancelled.'));
  }
  const history = input.context.activeSessionHistory;
  const coveredIndex = history.findIndex((item) => item.entry.entry_id === plan.coveredUntilEntryId);
  if (coveredIndex < 0) {
    return buildFailedContextResult(buildUnexpectedContextFailure({
      code: 'compaction_failed',
      message: 'Compaction plan covers an unknown Session Entry.',
    }));
  }
  const projectedContext: ResolvedContext = {
    ...input.context,
    // The projection mirrors the to-be-committed facts exactly: same id, time
    // and coverage. It is a pre-commit validation only and is never returned
    // or written to long-term state.
    activeSessionHistory: [
      {
        type: 'compaction',
        entry: {
          entry_id: `compaction-entry:${compactionId}`,
          session_id: input.sessionId,
          parent_entry_id: history[coveredIndex]!.entry.entry_id,
          entry_type: 'compaction',
          compaction_id: compactionId,
          created_at: createdAt,
        },
        compaction: {
          compaction_id: compactionId,
          session_id: input.sessionId,
          summary_text: summaryText,
          covered_until_entry_id: plan.coveredUntilEntryId,
          first_kept_entry_id: plan.firstKeptEntryId,
          created_at: createdAt,
          ...(summaryUsage ? { usage: summaryUsage } : {}),
        },
      },
      ...history.slice(coveredIndex + 1),
    ],
  };
  const built = await input.promptBuilder.build({ context: projectedContext, signal: input.signal });
  if (built.status === 'failed') return built;
  return { status: 'built', prompt: built.prompt };
}

/** The compactable history messages that genuinely stay in the candidate Prompt. */
function keptCompactableMessageCount(
  input: ExecuteCompactionInput,
  plan: CompactionPlan,
): number {
  return input.materialized.compactableSources.length - plan.summarizedMessages.length;
}

function failed(failure: ContextFailure): Extract<ExecuteCompactionResult, { status: 'failed' }> {
  return { status: 'failed', failure };
}

// Observability is diagnostic: compaction logs and measurements are best-effort
// and must never change the compaction outcome.

function recordCompactionLog(
  observability: ObservabilityService | undefined,
  request: Parameters<ObservabilityService['recordLog']>[0],
): void {
  if (!observability) return;
  try {
    observability.recordLog(request);
  } catch {
    // Diagnostics never own the compaction outcome.
  }
}

function recordCompactionMeasurement(
  observability: ObservabilityService | undefined,
  request: Parameters<ObservabilityService['recordMeasurement']>[0],
): void {
  if (!observability) return;
  try {
    observability.recordMeasurement(request);
  } catch {
    // Diagnostics never own the compaction outcome.
  }
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

function publishCompactionStarted(
  events: EventBus | undefined,
  sessionId: string,
  trigger: CompactionTrigger,
  compactionId: string,
): void {
  events?.publish({
    type: 'session.compaction.started',
    payload: { trigger, compactionId },
    sessionId,
  });
}

function publishCompactionEnded(
  events: EventBus | undefined,
  sessionId: string,
  payload:
    | { readonly status: 'completed'; readonly compactionId: string }
    | { readonly status: 'cancelled'; readonly compactionId: string }
    | { readonly status: 'failed'; readonly compactionId: string; readonly error: { readonly message: string; readonly code?: string } }
    | { readonly status: 'interrupted'; readonly compactionId: string; readonly error: { readonly message: string; readonly code?: string } },
): void {
  if (!events) return;
  if (payload.status === 'completed' || payload.status === 'cancelled') {
    events.publish({
      type: 'session.compaction.ended',
      payload: { status: payload.status, compactionId: payload.compactionId },
      sessionId,
    });
    return;
  }
  if (payload.status === 'failed') {
    events.publish({
      type: 'session.compaction.ended',
      payload: {
        status: 'failed',
        compactionId: payload.compactionId,
        error: payload.error,
      },
      sessionId,
    });
    return;
  }
  events.publish({
    type: 'session.compaction.ended',
    payload: {
      status: 'interrupted',
      compactionId: payload.compactionId,
      error: payload.error,
    },
    sessionId,
  });
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
