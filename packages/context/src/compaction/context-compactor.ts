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
import type { ContextFailure, ContextCompactionProgress, ContextCompactionProgressFailed, CompactionTrigger, CompactContextResult } from '../context';
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
  validateCompactionReduction,
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
  readonly sessionHistory: Pick<SessionHistory, 'saveCompactionSummary'>;
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
  const beforeTokens = input.calculatePromptUsage(input.prompt).tokens;
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
    previousSummary: input.materialized.previousSummary,
    messages: plan.plan.summarizedMessages,
    turnPrefixMessages: plan.plan.turnPrefixMessages,
    timestamp: Date.parse(input.now()),
    ...(input.signal ? { signal: input.signal } : {}),
  });
  if (generated.status === 'cancelled') return failCompaction(buildCancelledContextFailure('Context compaction was cancelled.'));
  if (generated.status === 'failed') return failCompaction(buildSummaryModelContextFailure(generated.failure));

  const projected = await projectCandidate(input, compactionId, plan.plan, generated.content, generated.usage);
  if (projected.status === 'failed') return failCompaction(projected.failure);
  // The countUsage path throws on abort; check the signal first so both the
  // build and compact paths settle on the same cancelled result.
  if (input.signal?.aborted) return failCompaction(buildCancelledContextFailure('Context compaction was cancelled.'));
  const projectedUsage = input.calculatePromptUsage(projected.prompt);
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
  if (input.signal?.aborted) return failCompaction(buildCancelledContextFailure('Context compaction was cancelled.'));

  const saved = input.sessionHistory.saveCompactionSummary({
    compaction_id: compactionId,
    session_id: input.sessionId,
    summary_text: generated.content,
    covered_until_entry_id: plan.plan.coveredUntilEntryId,
    first_kept_entry_id: plan.plan.firstKeptEntryId,
    usage: generated.usage,
    expected_active_entry_id: input.materialized.expectedActiveEntryId,
    created_at: input.now(),
    append_to_active_path: true,
  });
  if (saved.status === 'failed') {
    return failCompaction(buildCompactionPersistContextFailure({
      message: saved.failure.message,
      sourceCode: saved.failure.code,
    }));
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
    activeSessionHistory: [
      {
        type: 'compaction',
        entry: {
          entry_id: `compaction-entry:${compactionId}`,
          session_id: input.sessionId,
          parent_entry_id: history[coveredIndex]!.entry.entry_id,
          entry_type: 'compaction',
          compaction_id: compactionId,
          created_at: input.now(),
        },
        compaction: {
          compaction_id: compactionId,
          session_id: input.sessionId,
          summary_text: summaryText,
          covered_until_entry_id: plan.coveredUntilEntryId,
          first_kept_entry_id: plan.firstKeptEntryId,
          created_at: input.now(),
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
    const failedProgress = progress as ContextCompactionProgressFailed;
    events.publish({
      type: 'session.compaction.ended',
      payload: {
        status: 'failed',
        compactionId: failedProgress.compactionId,
        error: { message: failedProgress.message, code: failedProgress.code },
      },
      sessionId,
    });
  }
}
