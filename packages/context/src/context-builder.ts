/*
 * Coordinates one Context build: Session history reading, System Prompt and
 * message materialization, Token estimation and the shared Compaction path.
 * Context never creates or modifies UserMessage and never re-reads Skills,
 * Tools, Instructions or the Workspace after the ModelCallContext is fixed.
 */

import crypto from 'node:crypto';
import type { Api, Context as AiContext, Message, Model, Models, Tool } from '@megumi/ai';
import { capabilitiesFromModel, estimateContextTokens, estimateMessageTokens } from '@megumi/ai';
import type { EffectiveInstructions, InstructionReader } from '@megumi/instructions';
import type { ObservabilityService } from '@megumi/observability';
import type { SessionAttachmentReader, SessionHistory, SessionHistoryItem } from '@megumi/session';
import type { SkillView } from '@megumi/skills';
import type {
  BuildContextRequest,
  BuildContextResult,
  ContextBuilder,
  ContextFailure,
  ExecutionEnvironment,
  Prompt,
} from './context';
import { buildContextMessages, buildCompactionSummaryMessage } from './context-messages';
import {
  compactionPolicyFailure,
  contextCapacityFromModel,
  resolveCompactionPolicy,
  type CompactionPolicy,
} from './context-policy';
import type { ContextUsageEstimate } from './context-usage';
import { buildSystemPrompt } from './system-prompt';
import {
  executeContextCompaction,
  type CompactContextRequest,
  type CompactContextResult,
  type ContextCompactor,
  type ExecuteCompactionResult,
} from './compaction/context-compactor';
import type { CompactionMessageSource, CompactionPlan } from './compaction/compaction-planner';

export interface CreateContextOptions {
  readonly sessionHistory: Pick<SessionHistory, 'getActiveHistory' | 'saveCompactionSummary'>;
  readonly attachmentReader: Pick<SessionAttachmentReader, 'readAttachmentContent'>;
  readonly instructionReader: InstructionReader;
  readonly models: Pick<Models, 'completeSimple'>;
  readonly contextTokenEstimator?: (context: AiContext) => number;
  readonly observability?: ObservabilityService;
  readonly policy?: Partial<CompactionPolicy>;
  readonly policyProvider?: { getPolicy(): Partial<CompactionPolicy> };
  readonly clock?: { now(): string };
  readonly ids?: { compactionId(): string };
}

export type ContextCapabilities = ContextBuilder & ContextCompactor;

export function createContext(options: CreateContextOptions): ContextCapabilities {
  return new DefaultContext(options);
}

class DefaultContext implements ContextCapabilities {
  private readonly clock: { now(): string };
  private readonly ids: { compactionId(): string };
  private readonly sessionOperationTails = new Map<string, Promise<void>>();

  constructor(private readonly options: CreateContextOptions) {
    this.clock = options.clock ?? { now: () => new Date().toISOString() };
    this.ids = options.ids ?? {
      compactionId: () => `context-compaction:${crypto.randomUUID()}`,
    };
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
        result = failed({
          code: 'context_build_failed',
          message: error instanceof Error ? error.message : 'Context build failed.',
          retryable: false,
        });
      }
      if (span) {
        this.options.observability?.endSpan({
          span,
          status: result.status === 'ready' ? 'ok' : result.failure.code === 'cancelled' ? 'cancelled' : 'error',
        });
      }
      if (result.status === 'ready') {
        this.options.observability?.recordMeasurement({
          name: 'context.used_tokens',
          value: estimateContextTokens(result.prompt).tokens,
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
        if (request.signal?.aborted) return failed(cancelled());
        const policy = this.resolvePolicy();
        const capacity = contextCapacityFromModel(request.model);
        const policyProblem = compactionPolicyFailure(policy, capacity);
        if (policyProblem) {
          return failed({ code: 'policy_invalid', message: policyProblem, retryable: false });
        }
        const history = this.readHistory(request.sessionId);
        if (history.status === 'failed') return history;
        const base = this.readBaseInstructions();
        if (base.status === 'failed') return base;
        const prompt = await this.buildPromptFromSources({
          sessionId: request.sessionId,
          history: history.history,
          baseInstructions: base.instructions,
          model: request.model,
          executionEnvironment: request.executionEnvironment,
          effectiveInstructions: request.effectiveInstructions,
          skills: request.skills,
          tools: [],
          signal: request.signal,
        });
        if (prompt.status === 'failed') return prompt;
        const usageBefore = this.countUsage(prompt.prompt);
        const compacted = await this.executeCompaction({
          sessionId: request.sessionId,
          history: history.history,
          sources: prompt.sources,
          prompt: prompt.prompt,
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
      if (request.signal?.aborted || isAbortError(error)) return failed(cancelled());
      return failed({
        code: 'compaction_failed',
        message: error instanceof Error ? error.message : 'Context compaction failed.',
        retryable: false,
      });
    }
  }

  private async buildExclusive(request: BuildContextRequest): Promise<BuildContextResult> {
    if (request.signal?.aborted) return failed(cancelled());
    const modelCall = request.modelCallContext;
    const policy = this.resolvePolicy();
    const capacity = contextCapacityFromModel(modelCall.run.model);
    const policyProblem = compactionPolicyFailure(policy, capacity);
    if (policyProblem) {
      return failed({ code: 'policy_invalid', message: policyProblem, retryable: false });
    }
    const environmentProblem = invalidExecutionEnvironment(modelCall.executionEnvironment);
    if (environmentProblem) {
      return failed({
        code: 'execution_environment_invalid',
        message: environmentProblem,
        retryable: false,
      });
    }
    const toolProblem = invalidToolDefinitions(modelCall.tools.definitions);
    if (toolProblem) {
      return failed({
        code: 'tool_definitions_invalid',
        message: toolProblem,
        retryable: false,
      });
    }
    const history = this.readHistory(modelCall.run.sessionId);
    if (history.status === 'failed') return history;
    const base = this.readBaseInstructions();
    if (base.status === 'failed') return base;

    const prompt = await this.buildPromptFromSources({
      sessionId: modelCall.run.sessionId,
      history: history.history,
      baseInstructions: base.instructions,
      model: modelCall.run.model,
      executionEnvironment: modelCall.executionEnvironment,
      effectiveInstructions: modelCall.effectiveInstructions,
      skills: modelCall.skills,
      tools: modelCall.tools.definitions,
      signal: request.signal,
    });
    if (prompt.status === 'failed') return prompt;

    let estimate = this.countUsage(prompt.prompt);
    if (policy.enabled
      && estimate.tokens > capacity.contextWindowTokens - policy.reserveTokens) {
      const compacted = await this.executeCompaction({
        sessionId: modelCall.run.sessionId,
        history: history.history,
        sources: prompt.sources,
        prompt: prompt.prompt,
        policy,
        model: modelCall.run.model,
        trigger: 'threshold',
        signal: request.signal,
      });
      if (compacted.status === 'failed') return compacted;
      if (compacted.status === 'compacted') {
        // The Summary is now a Session fact: re-read the authoritative history
        // and rebuild the Prompt from it, never from a pre-commit projection.
        const refreshed = this.readHistory(modelCall.run.sessionId);
        if (refreshed.status === 'failed') return refreshed;
        const rebuilt = await this.buildPromptFromSources({
          sessionId: modelCall.run.sessionId,
          history: refreshed.history,
          baseInstructions: base.instructions,
          model: modelCall.run.model,
          executionEnvironment: modelCall.executionEnvironment,
          effectiveInstructions: modelCall.effectiveInstructions,
          skills: modelCall.skills,
          tools: modelCall.tools.definitions,
          signal: request.signal,
        });
        if (rebuilt.status === 'failed') return rebuilt;
        estimate = this.countUsage(rebuilt.prompt);
        return this.finalizePrompt(rebuilt.prompt, capacity, estimate);
      }
    }
    return this.finalizePrompt(prompt.prompt, capacity, estimate);
  }

  private finalizePrompt(
    prompt: Prompt,
    capacity: { contextWindowTokens: number },
    estimate: ContextUsageEstimate,
  ): BuildContextResult {
    if (estimate.tokens >= capacity.contextWindowTokens) {
      return failed({
        code: 'context_window_exceeded',
        message: `Context uses ${estimate.tokens} tokens for a ${capacity.contextWindowTokens}-token Context Window.`,
        retryable: false,
      });
    }
    return { status: 'ready', prompt };
  }

  private readHistory(sessionId: string):
    | { status: 'ok'; history: { items: readonly SessionHistoryItem[]; expectedActiveEntryId: string } }
    | { status: 'failed'; failure: ContextFailure } {
    const result = this.options.sessionHistory.getActiveHistory({ session_id: sessionId });
    if (result.status === 'failed') {
      return {
        status: 'failed',
        failure: {
          code: 'session_history_failed',
          message: result.failure.message,
          retryable: true,
          cause: { owner: 'session', code: result.failure.code },
        },
      };
    }
    const lastEntryId = result.history.at(-1)?.entry.entry_id;
    if (!lastEntryId) {
      return {
        status: 'failed',
        failure: {
          code: 'session_history_failed',
          message: 'Session active history is empty.',
          retryable: false,
          cause: { owner: 'session' },
        },
      };
    }
    return {
      status: 'ok',
      history: { items: result.history, expectedActiveEntryId: lastEntryId },
    };
  }

  private readBaseInstructions():
    | { status: 'ok'; instructions: ReturnType<InstructionReader['getSystemInstructions']> }
    | { status: 'failed'; failure: ContextFailure } {
    try {
      return { status: 'ok', instructions: this.options.instructionReader.getSystemInstructions() };
    } catch (error) {
      return {
        status: 'failed',
        failure: {
          code: 'base_instructions_failed',
          message: error instanceof Error ? error.message : 'Base Instructions could not be read.',
          retryable: true,
          cause: { owner: 'instructions' },
        },
      };
    }
  }

  private async buildPromptFromSources(input: {
    readonly sessionId: string;
    readonly history: { items: readonly SessionHistoryItem[]; expectedActiveEntryId: string };
    readonly baseInstructions: readonly { readonly instructionId: string; readonly content: string }[];
    readonly model: Model<Api>;
    readonly executionEnvironment: ExecutionEnvironment;
    readonly effectiveInstructions: EffectiveInstructions;
    readonly skills: SkillView;
    readonly tools: readonly Tool[];
    readonly signal?: AbortSignal;
  }): Promise<
    | {
        readonly status: 'ok';
        readonly prompt: Prompt;
        readonly sources: readonly CompactionMessageSource[];
      }
    | { readonly status: 'failed'; readonly failure: ContextFailure }
  > {
    const converted = await buildContextMessages({
      history: input.history.items,
      attachmentReader: this.options.attachmentReader,
      imageInputSupport: capabilitiesFromModel(input.model).imageInput === true,
      signal: input.signal,
    });
    if (converted.status === 'failed') return converted;
    const systemPrompt = buildSystemPrompt({
      baseInstructions: input.baseInstructions,
      effectiveInstructions: input.effectiveInstructions,
      skills: input.skills,
      executionEnvironment: input.executionEnvironment,
    });
    if (!systemPrompt.trim()) {
      return {
        status: 'failed',
        failure: {
          code: 'base_instructions_failed',
          message: 'System Prompt could not be materialized without Base Instructions.',
          retryable: false,
          cause: { owner: 'instructions' },
        },
      };
    }
    const sources: CompactionMessageSource[] = [];
    let messageIndex = 0;
    for (const item of input.history.items) {
      if (item.type === 'message') {
        sources.push({ entryId: item.entry.entry_id, message: converted.messages[messageIndex]! });
        messageIndex += 1;
      }
    }
    return {
      status: 'ok',
      prompt: {
        systemPrompt,
        messages: converted.messages,
        tools: [...input.tools],
      },
      sources,
    };
  }

  private countUsage(context: AiContext): ContextUsageEstimate {
    const estimator = this.options.contextTokenEstimator;
    if (estimator) {
      const tokens = estimator(context);
      return { tokens, usageTokens: 0, trailingTokens: tokens, lastUsageIndex: null };
    }
    return estimateContextTokens(context);
  }

  private executeCompaction(input: {
    readonly sessionId: string;
    readonly history: { items: readonly SessionHistoryItem[]; expectedActiveEntryId: string };
    readonly sources: readonly CompactionMessageSource[];
    readonly prompt: Prompt;
    readonly policy: CompactionPolicy;
    readonly model: Model<Api>;
    readonly trigger: import('./compaction/context-compactor').CompactionTrigger;
    readonly onProgress?: (progress: import('./compaction/context-compactor').ContextCompactionProgress) => void;
    readonly signal?: AbortSignal;
  }): Promise<ExecuteCompactionResult> {
    const previousSummary = input.history.items
      .filter((item) => item.type === 'compaction')
      .at(-1)?.compaction.summary_text;
    const project = async (plan: CompactionPlan, summaryText: string, signal?: AbortSignal) => {
      if (signal?.aborted) return { status: 'failed' as const, failure: cancelled() };
      const keptMessages = input.sources
        .slice(plan.summarizedMessages.length)
        .map((source) => source.message);
      return {
        status: 'built' as const,
        context: {
          ...input.prompt,
          messages: [
            buildCompactionSummaryMessage(summaryText, Date.parse(this.clock.now())),
            ...keptMessages,
          ],
        },
      };
    };
    return executeContextCompaction({
      sessionId: input.sessionId,
      trigger: input.trigger,
      sources: input.sources,
      beforeContext: input.prompt,
      expectedActiveEntryId: input.history.expectedActiveEntryId,
      previousSummary,
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
        if (signal?.aborted) throw cancelled();
        return this.countUsage(context);
      },
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

function invalidExecutionEnvironment(environment: ExecutionEnvironment): string | undefined {
  if (!environment.workingDirectory || !environment.operatingSystem || !environment.shell) {
    return 'Execution Environment is incomplete.';
  }
  return undefined;
}

function invalidToolDefinitions(
  definitions: readonly { name?: unknown; description?: unknown; parameters?: unknown }[],
): string | undefined {
  if (definitions.some((definition) => (
    typeof definition.name !== 'string' || definition.name.length === 0
    || typeof definition.description !== 'string'
    || typeof definition.parameters !== 'object' || definition.parameters === null
  ))) {
    return 'Tool Definitions cannot form a valid Prompt tools list.';
  }
  return undefined;
}

function cancelled(): ContextFailure {
  return {
    code: 'cancelled',
    message: 'Context operation was cancelled.',
    retryable: true,
  };
}

function failed<T extends ContextFailure>(
  failure: T,
): { readonly status: 'failed'; readonly failure: T } {
  return { status: 'failed', failure };
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}
