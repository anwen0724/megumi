/*
 * Coordinates one Context build: resolves the complete ResolvedContext through
 * the ContextResolver, builds the Prompt through the PromptBuilder, estimates
 * usage, applies the Compaction Policy and drives the shared compaction path.
 * Session serial control, Trace checkpoints and final failure settlement stay here;
 * source reads, Prompt details and Token formulas are owned by their modules.
 */

import crypto from 'node:crypto';
import type { Api, Model, Models } from '@megumi/ai';
import type { EventBus } from '@megumi/events';
import type {
  Observability,
  OperationCompletion,
  SpanOptions,
  TraceCorrelation,
} from '@megumi/observability';
import type { SessionHistory, SessionAttachmentReader } from '@megumi/session';
import type { Skills } from '@megumi/skills';
import type { ToolDefinition } from '@megumi/tools';
import type {
  BuildContextRequest,
  BuildContextResult,
  CompactContextRequest,
  CompactContextResult,
  CompactionTrigger,
  ContextBuilder,
  ContextCompactionProgress,
  ContextCompactor,
  ContextFailure,
  ContextWorkspaceSource,
  ConversationRunContext,
  CandidateSupplyRunContext,
  DailyDiscoveryRunContext,
  Prompt,
} from './context';
import {
  buildCancelledContextFailure,
  buildFailedContextResult,
  buildPolicyContextFailure,
  buildUnexpectedContextFailure,
} from './context-failure-factory';
import {
  contextCapacityFromModel,
  finalContextWindowProblem,
  resolveCompactionPolicyProblem,
  shouldAutoCompact,
  type CompactionPolicy,
  type ContextCapacity,
} from './context-policy';
import { createContextResolver, type ContextResolver } from './context-resolver';
import type { ConversationResolvedContext } from './resolvers/conversation-context-resolver';
import { calculatePromptUsage, type ContextUsageEstimate } from './context-usage-calculator';
import { createPromptBuilder, type PromptBuilder } from './prompt/prompt-builder';
import type { MaterializedHistory } from './prompt/context-message-builder';
import {
  executeContextCompaction,
  type ExecuteCompactionResult,
} from './compaction/context-compactor';

export interface CreateContextOptions {
  readonly sessionHistory: Pick<
    SessionHistory,
    'getActiveHistory' | 'beginCompaction' | 'completeCompaction' | 'endCompaction'
  >;
  readonly attachmentReader: Pick<SessionAttachmentReader, 'readAttachmentContent'>;
  /** Workspace seam: Context resolves the Workspace root and execution environment itself. */
  readonly workspaceSource: ContextWorkspaceSource;
  readonly instructionReader: import('@megumi/instructions').InstructionReader;
  /** Skills seam: Context creates the SkillView it needs for one build. */
  readonly skills: Pick<Skills, 'createView'>;
  readonly models: Pick<Models, 'completeSimple'>;
  readonly contextTokenEstimator?: (prompt: Prompt) => number;
  readonly observability?: Observability;
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
    const run = request.modelCallContext.run;
    const correlation: TraceCorrelation = {
      executionId: run.executionId,
      modelCallId: request.modelCallContext.modelCallId,
      ...(run.kind === 'conversation' ? { sessionId: run.sessionId } : {}),
    };
    const operation = async (): Promise<BuildContextResult> => {
      let result: BuildContextResult;
      try {
        result = run.kind === 'conversation'
          ? await this.withSessionOperation(
              run.sessionId,
              () => this.buildExclusive(request, run),
            )
          : run.kind === 'daily_discovery'
            ? await this.buildDailyDiscovery(request, run)
            : await this.buildCandidateSupply(request, run);
      } catch (error) {
        result = buildFailedContextResult(buildUnexpectedContextFailure({
          code: 'context_build_failed',
          message: error instanceof Error ? error.message : 'Context build failed.',
        }));
      }
      if (result.status === 'ready') {
        recordContent(this.options.observability, {
          kind: 'prompt.final',
          value: result.prompt,
          correlation,
        });
      }
      return result;
    };
    return observeSpan(this.options.observability, {
      name: 'context.build',
      correlation,
      classifyResult: classifyBuildResult,
    }, operation);
  }

  async compact(request: CompactContextRequest): Promise<CompactContextResult> {
    try {
      return await this.withSessionOperation(request.sessionId, async () => {
        const prepared = await this.buildResolvedPrompt({
          kind: 'conversation',
          sessionId: request.sessionId,
          workspaceId: request.workspaceId,
          model: request.model,
          tools: request.tools,
          signal: request.signal,
        });
        if (prepared.status === 'failed') return prepared;
        const compacted = await this.executeCompaction({
          sessionId: request.sessionId,
          context: prepared.resolved,
          materialized: prepared.materialized,
          prompt: prepared.prompt,
          policy: prepared.policy,
          model: request.model,
          trigger: request.trigger,
          onProgress: request.onProgress,
          signal: request.signal,
        });
        return compacted.status === 'compacted'
          ? {
              status: 'compacted',
              compactionId: compacted.compactionId,
              usageBefore: prepared.estimate,
              usageAfter: compacted.usageAfter,
            }
          : compacted;
      });
    } catch (error) {
      if (request.signal?.aborted || isAbortError(error)) {
        return buildFailedContextResult(buildCancelledContextFailure('Context operation was cancelled.'));
      }
      return buildFailedContextResult(buildUnexpectedContextFailure({
        code: 'compaction_failed',
        message: error instanceof Error ? error.message : 'Context compaction failed.',
      }));
    }
  }

  private async buildExclusive(
    request: BuildContextRequest,
    run: ConversationRunContext,
  ): Promise<BuildContextResult> {
    const modelCall = request.modelCallContext;
    const prepared = await this.buildResolvedPrompt({
      kind: 'conversation',
      sessionId: run.sessionId,
      workspaceId: run.workspaceId,
      model: run.model,
      tools: modelCall.tools,
      signal: request.signal,
    });
    if (prepared.status === 'failed') return prepared;

    let estimate = prepared.estimate;
    if (shouldAutoCompact({
      policy: prepared.policy,
      promptTokens: estimate.tokens,
      contextWindowTokens: prepared.capacity.contextWindowTokens,
    })) {
      const compacted = await this.executeCompaction({
        sessionId: run.sessionId,
        context: prepared.resolved,
        materialized: prepared.materialized,
        prompt: prepared.prompt,
        policy: prepared.policy,
        model: run.model,
        trigger: 'threshold',
        signal: request.signal,
      });
      if (compacted.status === 'failed') return compacted;
      if (compacted.status === 'compacted') {
        // The Summary is now a Session fact: re-read the authoritative history
        // and rebuild the Prompt from it, never from a pre-commit projection.
        const refreshed = await this.buildResolvedPrompt({
          kind: 'conversation',
          sessionId: run.sessionId,
          workspaceId: run.workspaceId,
          model: run.model,
          tools: modelCall.tools,
          signal: request.signal,
        });
        if (refreshed.status === 'failed') return refreshed;
        estimate = refreshed.estimate;
        return this.finalizePrompt(refreshed.prompt, prepared.capacity, estimate);
      }
    }
    return this.finalizePrompt(prepared.prompt, prepared.capacity, estimate);
  }

  private async buildDailyDiscovery(
    request: BuildContextRequest,
    run: DailyDiscoveryRunContext,
  ): Promise<BuildContextResult> {
    if (request.signal?.aborted) {
      return buildFailedContextResult(buildCancelledContextFailure('Context operation was cancelled.'));
    }
    const correlation = {
      executionId: run.executionId,
      batchId: run.batchId,
      modelCallId: request.modelCallContext.modelCallId,
    };
    const resolved = await observeSpan(this.options.observability, {
      name: 'context.resolve',
      correlation,
      classifyResult: classifyFallibleResult,
    }, () => this.resolver.resolve({
        kind: 'daily_discovery',
        localDate: run.localDate,
        material: run.material,
        currentMessages: request.currentMessages,
        tools: request.modelCallContext.tools,
        signal: request.signal,
      }));
    if (resolved.status === 'failed') return resolved;
    recordContent(this.options.observability, {
      kind: 'context.resolved',
      value: resolved.context,
      correlation,
    });
    const built = await observeSpan(this.options.observability, {
      name: 'prompt.build',
      correlation,
      classifyResult: classifyFallibleResult,
    }, () => this.promptBuilder.build({ context: resolved.context, signal: request.signal }));
    if (built.status === 'failed') return built;
    const capacity = contextCapacityFromModel(run.model);
    return this.finalizePrompt(built.prompt, capacity, this.countUsage(built.prompt));
  }

  private async buildCandidateSupply(
    request: BuildContextRequest,
    run: CandidateSupplyRunContext,
  ): Promise<BuildContextResult> {
    if (request.signal?.aborted) {
      return buildFailedContextResult(buildCancelledContextFailure('Context operation was cancelled.'));
    }
    const correlation = {
      executionId: run.executionId,
      modelCallId: request.modelCallContext.modelCallId,
    };
    const resolved = await observeSpan(this.options.observability, {
      name: 'context.resolve', correlation, classifyResult: classifyFallibleResult,
    }, () => this.resolver.resolve({
      kind: 'candidate_supply',
      startedAt: run.startedAt,
      material: run.material,
      currentMessages: request.currentMessages,
      tools: request.modelCallContext.tools,
      signal: request.signal,
    }));
    if (resolved.status === 'failed') return resolved;
    recordContent(this.options.observability, {
      kind: 'context.resolved', value: resolved.context, correlation,
    });
    const built = await observeSpan(this.options.observability, {
      name: 'prompt.build', correlation, classifyResult: classifyFallibleResult,
    }, () => this.promptBuilder.build({ context: resolved.context, signal: request.signal }));
    if (built.status === 'failed') return built;
    const capacity = contextCapacityFromModel(run.model);
    return this.finalizePrompt(built.prompt, capacity, this.countUsage(built.prompt));
  }

  /**
   * The shared pre-flow for build() and compact(): resolve the complete
   * ResolvedContext, resolve and validate the Compaction Policy, build the
   * Prompt and calculate the complete-Prompt usage. Both operations receive the
   * same cancellation, Policy failure and Prompt building semantics through
   * this single entry; the operations still own their own orchestration after
   * it.
   */
  private async buildResolvedPrompt(input: {
    readonly kind: 'conversation';
    readonly sessionId: string;
    readonly workspaceId: string;
    readonly model: Model<Api>;
    readonly tools: readonly ToolDefinition[];
    readonly signal?: AbortSignal;
  }): Promise<
    | {
        readonly status: 'ok';
        readonly resolved: ConversationResolvedContext;
        readonly prompt: Prompt;
        readonly materialized: MaterializedHistory;
        readonly policy: CompactionPolicy;
        readonly capacity: ContextCapacity;
        readonly estimate: ContextUsageEstimate;
      }
    | { readonly status: 'failed'; readonly failure: ContextFailure }
  > {
    if (input.signal?.aborted) {
      return buildFailedContextResult(buildCancelledContextFailure('Context operation was cancelled.'));
    }
    const correlation = { sessionId: input.sessionId };
    const resolved = await observeSpan(this.options.observability, {
      name: 'context.resolve',
      correlation,
      classifyResult: classifyFallibleResult,
    }, () => this.resolver.resolve({
        kind: 'conversation',
        sessionId: input.sessionId,
        workspaceId: input.workspaceId,
        model: input.model,
        tools: input.tools,
        signal: input.signal,
      }));
    if (resolved.status === 'failed') return resolved;
    if (resolved.context.kind !== 'conversation') {
      return buildFailedContextResult(buildUnexpectedContextFailure({
        code: 'context_build_failed',
        message: 'Conversation Context resolved to an incompatible profile.',
      }));
    }
    const capacity = contextCapacityFromModel(input.model);
    const policyResult = resolveCompactionPolicyProblem({
      defaults: this.options.policy,
      configured: this.options.policyProvider?.getPolicy(),
      capacity,
    });
    if (policyResult.status === 'invalid') {
      return buildFailedContextResult(buildPolicyContextFailure(policyResult.message));
    }
    recordContent(this.options.observability, {
      kind: 'context.resolved',
      value: resolved.context,
      correlation,
    });
    const built = await observeSpan(this.options.observability, {
      name: 'prompt.build',
      correlation,
      classifyResult: classifyFallibleResult,
    }, () => this.promptBuilder.build({ context: resolved.context, signal: input.signal }));
    if (built.status === 'failed') return built;
    if (built.kind !== 'conversation') {
      return buildFailedContextResult(buildUnexpectedContextFailure({
        code: 'context_build_failed',
        message: 'Conversation Prompt built with an incompatible profile.',
      }));
    }
    return {
      status: 'ok',
      resolved: resolved.context,
      prompt: built.prompt,
      materialized: built.materializedHistory,
      policy: policyResult.policy,
      capacity,
      estimate: this.countUsage(built.prompt),
    };
  }

  private finalizePrompt(
    prompt: Prompt,
    capacity: { contextWindowTokens: number },
    estimate: ContextUsageEstimate,
  ): BuildContextResult {
    const problem = finalContextWindowProblem({
      promptTokens: estimate.tokens,
      contextWindowTokens: capacity.contextWindowTokens,
    });
    if (problem) {
      return buildFailedContextResult({
        code: 'context_window_exceeded',
        message: problem,
        retryable: false,
      });
    }
    return { status: 'ready', prompt };
  }

  private countUsage(prompt: Prompt): ContextUsageEstimate {
    return calculatePromptUsage({ prompt, estimator: this.options.contextTokenEstimator });
  }

  private executeCompaction(input: {
    readonly sessionId: string;
    readonly context: ConversationResolvedContext;
    readonly materialized: MaterializedHistory;
    readonly prompt: Prompt;
    readonly policy: CompactionPolicy;
    readonly model: Model<Api>;
    readonly trigger: CompactionTrigger;
    readonly onProgress?: (progress: ContextCompactionProgress) => void;
    readonly signal?: AbortSignal;
  }): Promise<ExecuteCompactionResult> {
    return observeSpan(this.options.observability, {
      name: 'context.compact',
      correlation: { sessionId: input.sessionId },
      classifyResult: classifyCompactionResult,
    }, () => executeContextCompaction({
      sessionId: input.sessionId,
      trigger: input.trigger,
      context: input.context,
      prompt: input.prompt,
      materialized: input.materialized,
      policy: input.policy,
      model: input.model,
      models: this.options.models,
      sessionHistory: this.options.sessionHistory,
      promptBuilder: this.promptBuilder,
      calculatePromptUsage: (prompt) => this.countUsage(prompt),
      observability: this.options.observability,
      now: () => this.clock.now(),
      createCompactionId: () => this.ids.compactionId(),
      events: this.options.events,
      onProgress: input.onProgress,
      signal: input.signal,
    }));
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

async function observeSpan<T>(
  observability: Observability | undefined,
  options: SpanOptions<T>,
  operation: () => Promise<T>,
): Promise<T> {
  let operationPromise: Promise<T> | undefined;
  const runOnce = (): Promise<T> => {
    operationPromise ??= operation();
    return operationPromise;
  };
  if (!observability) return runOnce();
  try {
    return await observability.withSpan(options, runOnce);
  } catch {
    return runOnce();
  }
}

function classifyBuildResult(result: BuildContextResult): OperationCompletion {
  return result.status === 'ready'
    ? { outcome: { status: 'ok' } }
    : completionFromFailure(result.failure);
}

function classifyFallibleResult(
  result: { readonly status: string; readonly failure?: ContextFailure },
): OperationCompletion {
  return result.status !== 'failed' || !result.failure
    ? { outcome: { status: 'ok' } }
    : completionFromFailure(result.failure);
}

function classifyCompactionResult(result: ExecuteCompactionResult): OperationCompletion {
  return result.status !== 'failed'
    ? { outcome: { status: 'ok' } }
    : completionFromFailure(result.failure);
}

function completionFromFailure(failure: ContextFailure): OperationCompletion {
  return failure.code === 'cancelled'
    ? { outcome: { status: 'cancelled', code: failure.code, message: failure.message } }
    : {
        outcome: {
          status: 'error',
          code: failure.code,
          message: failure.message,
          retryable: failure.retryable,
        },
      };
}

function recordContent(
  observability: Observability | undefined,
  input: Parameters<Observability['recordContent']>[0],
): void {
  try {
    observability?.recordContent(input);
  } catch {
    // Diagnostic capture cannot change Context results.
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}
