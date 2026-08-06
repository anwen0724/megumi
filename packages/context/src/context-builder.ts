/*
 * Coordinates one Context build: resolves the complete ResolvedContext through
 * the ContextResolver, builds the Prompt through the PromptBuilder, estimates
 * usage, applies the Compaction Policy and drives the shared compaction path.
 * Session serial control, Observability and final failure settlement stay here;
 * source reads, Prompt details and Token formulas are owned by their modules.
 */

import crypto from 'node:crypto';
import type { Api, Model, Models } from '@megumi/ai';
import type { EventBus } from '@megumi/events';
import type { ObservabilityService, SpanHandle } from '@megumi/observability';
import type { SessionHistory, SessionAttachmentReader } from '@megumi/session';
import type { Skills } from '@megumi/skills';
import type {
  BuildContextRequest,
  BuildContextResult,
  CompactContextRequest,
  CompactContextResult,
  CompactionTrigger,
  ContextBuilder,
  ContextCompactionProgress,
  ContextCompactor,
  ContextWorkspaceSource,
  Prompt,
} from './context';
import {
  buildCancelledContextFailure,
  buildFailedContextResult,
  buildPolicyContextFailure,
  buildUnexpectedContextFailure,
} from './context-failure-factory';
import {
  compactionPolicyFailure,
  contextCapacityFromModel,
  finalContextWindowProblem,
  resolveCompactionPolicy,
  shouldAutoCompact,
  type CompactionPolicy,
} from './context-policy';
import { createContextResolver, type ContextResolver, type ResolvedContext } from './context-resolver';
import { calculatePromptUsage, type ContextUsageEstimate } from './context-usage-calculator';
import { createPromptBuilder, type PromptBuilder } from './prompt/prompt-builder';
import type { MaterializedHistory } from './prompt/context-message-builder';
import {
  executeContextCompaction,
  type ExecuteCompactionResult,
} from './compaction/context-compactor';

export interface CreateContextOptions {
  readonly sessionHistory: Pick<SessionHistory, 'getActiveHistory' | 'saveCompactionSummary'>;
  readonly attachmentReader: Pick<SessionAttachmentReader, 'readAttachmentContent'>;
  /** Workspace seam: Context resolves the Workspace root and execution environment itself. */
  readonly workspaceSource: ContextWorkspaceSource;
  readonly instructionReader: import('@megumi/instructions').InstructionReader;
  /** Skills seam: Context creates the SkillView it needs for one build. */
  readonly skills: Pick<Skills, 'createView'>;
  readonly models: Pick<Models, 'completeSimple'>;
  readonly contextTokenEstimator?: (prompt: Prompt) => number;
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
    const span = startContextSpan(this.options.observability, request.modelCallContext.run.sessionId);
    const operation = async (): Promise<BuildContextResult> => {
      let result: BuildContextResult;
      try {
        result = await this.withSessionOperation(
          request.modelCallContext.run.sessionId,
          () => this.buildExclusive(request),
        );
      } catch (error) {
        result = buildFailedContextResult(buildUnexpectedContextFailure({
          code: 'context_build_failed',
          message: error instanceof Error ? error.message : 'Context build failed.',
        }));
      }
      endContextSpan(this.options.observability, span, spanStatus(result));
      if (result.status === 'ready') {
        // The Measurement uses the same complete-Prompt usage result as the
        // Context Window decisions.
        recordUsedTokensMeasurement(
          this.options.observability,
          this.countUsage(result.prompt).tokens,
          request.modelCallContext.run.sessionId,
        );
      }
      return result;
    };
    if (!span) return operation();
    try {
      return await this.options.observability!.runInSpanContext(span, operation);
    } catch {
      // The span-context wrapper failed before delivering a result; operation
      // never throws (failures and diagnostics are settled inside it), so this
      // fallback runs the Context build exactly once outside the wrapper.
      return operation();
    }
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
          tools: request.tools,
          signal: request.signal,
        });
        if (resolved.status === 'failed') return resolved;
        const policy = this.resolvePolicy();
        const capacity = contextCapacityFromModel(request.model);
        const policyProblem = compactionPolicyFailure(policy, capacity);
        if (policyProblem) {
          return buildFailedContextResult(buildPolicyContextFailure(policyProblem));
        }
        const built = await this.promptBuilder.build({ context: resolved.context, signal: request.signal });
        if (built.status === 'failed') return built;
        const usageBefore = this.countUsage(built.prompt);
        const compacted = await this.executeCompaction({
          sessionId: request.sessionId,
          context: resolved.context,
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
      return buildFailedContextResult(buildUnexpectedContextFailure({
        code: 'compaction_failed',
        message: error instanceof Error ? error.message : 'Context compaction failed.',
      }));
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
      return buildFailedContextResult(buildPolicyContextFailure(policyProblem));
    }

    const built = await this.promptBuilder.build({ context: resolved.context, signal: request.signal });
    if (built.status === 'failed') return built;

    let estimate = this.countUsage(built.prompt);
    if (shouldAutoCompact({
      policy,
      promptTokens: estimate.tokens,
      contextWindowTokens: capacity.contextWindowTokens,
    })) {
      const compacted = await this.executeCompaction({
        sessionId: modelCall.run.sessionId,
        context: resolved.context,
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
    readonly context: ResolvedContext;
    readonly materialized: MaterializedHistory;
    readonly prompt: Prompt;
    readonly policy: CompactionPolicy;
    readonly model: Model<Api>;
    readonly trigger: CompactionTrigger;
    readonly onProgress?: (progress: ContextCompactionProgress) => void;
    readonly signal?: AbortSignal;
  }): Promise<ExecuteCompactionResult> {
    return executeContextCompaction({
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

// Observability is diagnostic: every call below is best-effort and must never
// change the Context business result.

function startContextSpan(
  observability: ObservabilityService | undefined,
  sessionId: string,
): SpanHandle | undefined {
  if (!observability) return undefined;
  try {
    return observability.startSpan({
      name: 'context.build',
      correlation: { sessionId },
    });
  } catch {
    return undefined;
  }
}

function endContextSpan(
  observability: ObservabilityService | undefined,
  span: SpanHandle | undefined,
  status: 'ok' | 'cancelled' | 'error',
): void {
  if (!observability || !span) return;
  try {
    observability.endSpan({ span, status });
  } catch {
    // Diagnostics never own the Context outcome.
  }
}

function recordUsedTokensMeasurement(
  observability: ObservabilityService | undefined,
  tokens: number,
  sessionId: string,
): void {
  if (!observability) return;
  try {
    observability.recordMeasurement({
      name: 'context.used_tokens',
      value: tokens,
      unit: 'token',
      correlation: { sessionId },
    });
  } catch {
    // Diagnostics never own the Context outcome.
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}
