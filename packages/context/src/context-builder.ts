/*
 * Coordinates one Context build: resolves the complete ResolvedContext through
 * the ContextResolver, builds the Prompt through the PromptBuilder, estimates
 * usage, applies the Compaction Policy and drives the shared compaction path.
 * Session serial control, Observability and final failure settlement stay here;
 * source reads, Prompt details and Token formulas are owned by their modules.
 */

import crypto from 'node:crypto';
import type { Api, Context as AiContext, Message, Model, Models } from '@megumi/ai';
import { estimateContextTokens, estimateMessageTokens } from '@megumi/ai/utils/estimate';
import type { EventBus } from '@megumi/events';
import type { ObservabilityService } from '@megumi/observability';
import type { SessionHistory, SessionAttachmentReader } from '@megumi/session';
import type { Skills } from '@megumi/skills';
import type {
  BuildContextRequest,
  BuildContextResult,
  ContextBuilder,
  ContextFailure,
  ContextWorkspaceSource,
  Prompt,
} from './context';
import {
  buildCancelledContextFailure,
  buildFailedContextResult,
} from './context-failure-factory';
import {
  compactionPolicyFailure,
  contextCapacityFromModel,
  resolveCompactionPolicy,
  type CompactionPolicy,
} from './context-policy';
import { createContextResolver, type ContextResolver } from './context-resolver';
import type { ContextUsageEstimate } from './context-usage-calculator';
import { createPromptBuilder, type PromptBuilder } from './prompt/prompt-builder';
import { buildCompactionSummaryMessage, type MaterializedHistory } from './prompt/context-message-builder';
import {
  executeContextCompaction,
  type CompactContextRequest,
  type CompactContextResult,
  type CompactionTrigger,
  type ContextCompactionProgress,
  type ContextCompactor,
  type ExecuteCompactionResult,
} from './compaction/context-compactor';
import type { CompactionPlan } from './compaction/compaction-planner';

export interface CreateContextOptions {
  readonly sessionHistory: Pick<SessionHistory, 'getActiveHistory' | 'saveCompactionSummary'>;
  readonly attachmentReader: Pick<SessionAttachmentReader, 'readAttachmentContent'>;
  /** Workspace seam: Context resolves the Workspace root and execution environment itself. */
  readonly workspaceSource: ContextWorkspaceSource;
  readonly instructionReader: import('@megumi/instructions').InstructionReader;
  /** Skills seam: Context creates the SkillView it needs for one build. */
  readonly skills: Pick<Skills, 'createView'>;
  readonly models: Pick<Models, 'completeSimple'>;
  readonly contextTokenEstimator?: (prompt: Prompt | AiContext) => number;
  readonly observability?: ObservabilityService;
  readonly policy?: Partial<CompactionPolicy>;
  readonly policyProvider?: { getPolicy(): Partial<CompactionPolicy> };
  readonly clock?: { now(): string };
  readonly ids?: { compactionId(): string };
  /** Optional bus: compaction lifecycle facts are published here. */
  readonly events?: EventBus;
}

export type ContextCapabilities = ContextBuilder & ContextCompactor;

export function createContext(options: CreateContextOptions): ContextCapabilities {
  return new DefaultContext(options);
}

class DefaultContext implements ContextCapabilities {
  private readonly clock: { now(): string };
  private readonly ids: { compactionId(): string };
  private readonly resolver: ContextResolver;
  private readonly promptBuilder: PromptBuilder;
  private readonly sessionOperationTails = new Map<string, Promise<void>>();

  constructor(private readonly options: CreateContextOptions) {
    this.clock = options.clock ?? { now: () => new Date().toISOString() };
    this.ids = options.ids ?? {
      compactionId: () => `context-compaction:${crypto.randomUUID()}`,
    };
    this.resolver = createContextResolver({
      sessionHistory: options.sessionHistory,
      workspaceSource: options.workspaceSource,
      instructionReader: options.instructionReader,
      skills: options.skills,
    });
    this.promptBuilder = createPromptBuilder({ attachmentReader: options.attachmentReader });
  }

  async build(request: BuildContextRequest): Promise<BuildContextResult> {
    const span = this.options.observability?.startSpan({
      name: 'context.build',
      correlation: { sessionId: request.modelCallContext.run.sessionId },
    });
    const operation = async (): Promise<BuildContextResult> => {
      let result: BuildContextResult;
      try {
        result = await this.withSessionOperation(
          request.modelCallContext.run.sessionId,
          () => this.buildExclusive(request),
        );
      } catch (error) {
        result = buildFailedContextResult({
          code: 'context_build_failed',
          message: error instanceof Error ? error.message : 'Context build failed.',
          retryable: false,
        });
      }
      if (span) {
        this.options.observability?.endSpan({
          span,
          status: spanStatus(result),
        });
      }
      if (result.status === 'ready') {
        this.options.observability?.recordMeasurement({
          name: 'context.used_tokens',
          value: estimateContextTokens(result.prompt.messages).tokens,
          unit: 'token',
          correlation: { sessionId: request.modelCallContext.run.sessionId },
        });
      }
      return result;
    };
    return span
      ? this.options.observability!.runInSpanContext(span, operation)
      : operation();
  }

  async compact(request: CompactContextRequest): Promise<CompactContextResult> {
    try {
      return await this.withSessionOperation(request.sessionId, async () => {
        if (request.signal?.aborted) {
          return buildFailedContextResult(buildCancelledContextFailure('Context operation was cancelled.'));
        }
        const resolved = await this.resolver.resolve({
          sessionId: request.sessionId,
          workspaceId: request.workspaceId,
          model: request.model,
          tools: [],
          signal: request.signal,
        });
        if (resolved.status === 'failed') return resolved;
        const policy = this.resolvePolicy();
        const capacity = contextCapacityFromModel(request.model);
        const policyProblem = compactionPolicyFailure(policy, capacity);
        if (policyProblem) {
          return buildFailedContextResult({ code: 'policy_invalid', message: policyProblem, retryable: false });
        }
        const built = await this.promptBuilder.build({ context: resolved.context, signal: request.signal });
        if (built.status === 'failed') return built;
        const usageBefore = this.countUsage(built.prompt);
        const compacted = await this.executeCompaction({
          sessionId: request.sessionId,
          materialized: built.materializedHistory,
          prompt: built.prompt,
          policy,
          model: request.model,
          trigger: request.trigger,
          onProgress: request.onProgress,
          signal: request.signal,
        });
        return compacted.status === 'compacted'
          ? {
              status: 'compacted',
              compactionId: compacted.compactionId,
              usageBefore,
              usageAfter: compacted.usageAfter,
            }
          : compacted;
      });
    } catch (error) {
      if (request.signal?.aborted || isAbortError(error)) {
        return buildFailedContextResult(buildCancelledContextFailure('Context operation was cancelled.'));
      }
      return buildFailedContextResult({
        code: 'compaction_failed',
        message: error instanceof Error ? error.message : 'Context compaction failed.',
        retryable: false,
      });
    }
  }

  private async buildExclusive(request: BuildContextRequest): Promise<BuildContextResult> {
    if (request.signal?.aborted) {
      return buildFailedContextResult(buildCancelledContextFailure('Context operation was cancelled.'));
    }
    const modelCall = request.modelCallContext;
    const resolved = await this.resolver.resolve({
      sessionId: modelCall.run.sessionId,
      workspaceId: modelCall.run.workspaceId,
      model: modelCall.run.model,
      tools: modelCall.tools,
      signal: request.signal,
    });
    if (resolved.status === 'failed') return resolved;
    const policy = this.resolvePolicy();
    const capacity = contextCapacityFromModel(modelCall.run.model);
    const policyProblem = compactionPolicyFailure(policy, capacity);
    if (policyProblem) {
      return buildFailedContextResult({ code: 'policy_invalid', message: policyProblem, retryable: false });
    }

    const built = await this.promptBuilder.build({ context: resolved.context, signal: request.signal });
    if (built.status === 'failed') return built;

    let estimate = this.countUsage(built.prompt);
    if (policy.enabled
      && estimate.tokens > capacity.contextWindowTokens - policy.reserveTokens) {
      const compacted = await this.executeCompaction({
        sessionId: modelCall.run.sessionId,
        materialized: built.materializedHistory,
        prompt: built.prompt,
        policy,
        model: modelCall.run.model,
        trigger: 'threshold',
        signal: request.signal,
      });
      if (compacted.status === 'failed') return compacted;
      if (compacted.status === 'compacted') {
        // The Summary is now a Session fact: re-read the authoritative history
        // and rebuild the Prompt from it, never from a pre-commit projection.
        const refreshed = await this.resolver.resolve({
          sessionId: modelCall.run.sessionId,
          workspaceId: modelCall.run.workspaceId,
          model: modelCall.run.model,
          tools: modelCall.tools,
          signal: request.signal,
        });
        if (refreshed.status === 'failed') return refreshed;
        const rebuilt = await this.promptBuilder.build({ context: refreshed.context, signal: request.signal });
        if (rebuilt.status === 'failed') return rebuilt;
        estimate = this.countUsage(rebuilt.prompt);
        return this.finalizePrompt(rebuilt.prompt, capacity, estimate);
      }
    }
    return this.finalizePrompt(built.prompt, capacity, estimate);
  }

  private finalizePrompt(
    prompt: Prompt,
    capacity: { contextWindowTokens: number },
    estimate: ContextUsageEstimate,
  ): BuildContextResult {
    if (estimate.tokens >= capacity.contextWindowTokens) {
      return buildFailedContextResult({
        code: 'context_window_exceeded',
        message: `Context uses ${estimate.tokens} tokens for a ${capacity.contextWindowTokens}-token Context Window.`,
        retryable: false,
      });
    }
    return { status: 'ready', prompt };
  }

  private countUsage(prompt: Prompt | AiContext): ContextUsageEstimate {
    const estimator = this.options.contextTokenEstimator;
    if (estimator) {
      const tokens = estimator(prompt);
      return { tokens, usageTokens: 0, trailingTokens: tokens, lastUsageIndex: null };
    }
    return estimateContextTokens(prompt.messages);
  }

  private executeCompaction(input: {
    readonly sessionId: string;
    readonly materialized: MaterializedHistory;
    readonly prompt: Prompt;
    readonly policy: CompactionPolicy;
    readonly model: Model<Api>;
    readonly trigger: CompactionTrigger;
    readonly onProgress?: (progress: ContextCompactionProgress) => void;
    readonly signal?: AbortSignal;
  }): Promise<ExecuteCompactionResult> {
    const project = async (plan: CompactionPlan, summaryText: string, signal?: AbortSignal) => {
      if (signal?.aborted) {
        return { status: 'failed' as const, failure: buildCancelledContextFailure('Context operation was cancelled.') };
      }
      const keptMessages = input.materialized.compactableSources
        .slice(plan.summarizedMessages.length)
        .map((source) => source.message);
      return {
        status: 'built' as const,
        // Shallow copies at the AI boundary: the compaction projection is a
        // mutable Context for the summary call, never the readonly Prompt.
        context: {
          systemPrompt: input.prompt.systemPrompt,
          messages: [
            buildCompactionSummaryMessage(summaryText, Date.parse(this.clock.now())),
            ...keptMessages,
          ],
          tools: [...input.prompt.tools],
        },
      };
    };
    return executeContextCompaction({
      sessionId: input.sessionId,
      trigger: input.trigger,
      sources: input.materialized.compactableSources,
      // Shallow copy at the AI boundary: compaction consumes a mutable Context.
      beforeContext: {
        systemPrompt: input.prompt.systemPrompt,
        messages: [...input.prompt.messages],
        tools: [...input.prompt.tools],
      },
      expectedActiveEntryId: input.materialized.expectedActiveEntryId,
      previousSummary: input.materialized.previousSummary,
      policy: input.policy,
      model: input.model,
      models: this.options.models,
      sessionHistory: this.options.sessionHistory,
      observability: this.options.observability,
      now: () => this.clock.now(),
      createCompactionId: () => this.ids.compactionId(),
      estimateMessageTokens,
      project,
      countUsage: (context, signal) => {
        if (signal?.aborted) throw buildCancelledContextFailure('Context operation was cancelled.');
        return this.countUsage(context);
      },
      onProgress: input.onProgress,
      events: this.options.events,
      signal: input.signal,
    });
  }

  private resolvePolicy(): CompactionPolicy {
    return resolveCompactionPolicy(this.options.policy, this.options.policyProvider?.getPolicy());
  }

  private async withSessionOperation<T>(
    sessionId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.sessionOperationTails.get(sessionId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.catch(() => undefined).then(() => gate);
    this.sessionOperationTails.set(sessionId, tail);
    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release();
      if (this.sessionOperationTails.get(sessionId) === tail) {
        this.sessionOperationTails.delete(sessionId);
      }
    }
  }
}

function spanStatus(result: BuildContextResult): 'ok' | 'cancelled' | 'error' {
  if (result.status === 'ready') return 'ok';
  return result.failure.code === 'cancelled' ? 'cancelled' : 'error';
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}
