/* Coordinates Context sources, model capacity, image materialization, compaction, and usage state. */
import {
  capabilitiesFromModel,
  estimateContextTokens,
  type Api,
  type Context as AiContext,
  type Model,
  type Models,
  type Tool,
} from '@megumi/ai';
import type { InstructionReader } from '@megumi/instructions';
import type { ObservabilityService } from '@megumi/observability';
import type { SessionAttachmentReader, SessionHistory, SessionHistoryItem } from '@megumi/session';
import type {
  SkillCatalogItem,
  SkillSelection,
  SkillService,
  UsedSkillContent,
} from '@megumi/skills';
import {
  assembleActiveContext,
  buildAiContext,
  type ActiveContextFacts,
  type ContextSourceRef,
  type ExecutionEnvironment,
  type VisibleCompactionSummary,
} from './active-context';
import {
  executeContextCompaction,
  type CompactContextRequest,
  type CompactContextResult,
  type ContextCompactionProgress,
  type ContextCompactor,
} from './compaction/context-compactor';
import {
  contextCapacityFromModel,
  resolveContextPolicy,
  type ContextPolicy,
} from './context-policy';
import {
  calculateContextUsage,
  recordContextUsage,
  type ContextUsage,
  type ContextUsageReader,
  type ContextUsageRecorder,
  type ContextUsageSnapshotCache,
  type GetSessionContextUsageRequest,
  type GetSessionContextUsageResult,
  type RecordCompletedModelCallUsageRequest,
  type RecordCompletedModelCallUsageResult,
  type SessionContextUsageSnapshot,
} from './context-usage';
import { buildConversationRuns, type CurrentConversationRun } from './conversation-run';
import { materializeActiveContextImages } from './image-content';

export interface ContextFailure {
  readonly code:
    | 'session_history_failed'
    | 'instruction_load_failed'
    | 'skill_catalog_failed'
    | 'active_context_failed'
    | 'token_count_failed'
    | 'usage_snapshot_invalid'
    | 'compaction_failed'
    | 'compaction_persist_failed'
    | 'context_window_exceeded'
    | 'context_build_failed'
    | 'image_materialization_failed'
    | 'cancelled';
  readonly message: string;
  readonly retryable: boolean;
  readonly cause?: {
    readonly owner: 'session' | 'instructions' | 'skills' | 'tools' | 'ai';
    readonly code?: string;
  };
}

export interface PreparedModelCall {
  readonly preparationId: string;
  readonly context: AiContext;
  readonly usage: ContextUsage;
  readonly sourceRefs: ContextSourceRef[];
  readonly compaction?: { readonly compactionId: string };
}

export interface BuildContextRequest {
  readonly sessionId: string;
  readonly workspaceId: string;
  readonly currentRun: CurrentConversationRun;
  readonly selectedSkill?: SkillSelection;
  readonly tools: readonly Tool[];
  readonly model: Model<Api>;
  readonly onCompactionProgress?: (progress: ContextCompactionProgress) => void;
  readonly signal?: AbortSignal;
}

export type BuildContextResult =
  | { readonly status: 'ready'; readonly prepared: PreparedModelCall }
  | { readonly status: 'failed'; readonly failure: ContextFailure };

export interface ContextBuilder {
  build(request: BuildContextRequest): Promise<BuildContextResult>;
}

export interface ContextScopeResolver {
  resolve(request: { readonly workspaceId: string }):
    | {
        readonly status: 'resolved';
        readonly workspaceRoot: string;
        readonly executionEnvironment: ExecutionEnvironment;
      }
    | {
        readonly status: 'failed';
        readonly failure: { readonly code: string; readonly message: string };
      };
}

export interface CreateContextOptions {
  readonly sessionHistory: Pick<SessionHistory, 'getActiveHistory' | 'saveCompactionSummary'>;
  readonly attachmentReader: Pick<SessionAttachmentReader, 'readAttachmentContent'>;
  readonly scopeResolver: ContextScopeResolver;
  readonly instructionReader: InstructionReader;
  readonly skillServiceFactory?: (
    input: { readonly workspaceRoot: string },
  ) => Pick<SkillService, 'getSkillCatalog' | 'useSkill'>;
  readonly models: Pick<Models, 'completeSimple'>;
  readonly contextTokenEstimator?: (context: AiContext) => number;
  readonly usageSnapshotCache?: ContextUsageSnapshotCache;
  readonly observability?: ObservabilityService;
  readonly policy?: Partial<ContextPolicy>;
  readonly policyProvider?: { getPolicy(): Partial<ContextPolicy> };
  readonly clock?: { now(): string };
  readonly ids?: { preparationId(): string; compactionId(): string };
}

export type ContextCapabilities = ContextBuilder
  & ContextCompactor
  & ContextUsageReader
  & ContextUsageRecorder;

export function createContext(options: CreateContextOptions): ContextCapabilities {
  return new DefaultContext(options);
}

class DefaultContext implements ContextCapabilities {
  private readonly clock: { now(): string };
  private readonly ids: { preparationId(): string; compactionId(): string };
  private readonly usageSnapshotCache: ContextUsageSnapshotCache;
  private readonly sessionOperationTails = new Map<string, Promise<void>>();

  constructor(private readonly options: CreateContextOptions) {
    resolveContextPolicy(options.policy, options.policyProvider?.getPolicy());
    this.clock = options.clock ?? { now: () => new Date().toISOString() };
    this.ids = options.ids ?? {
      preparationId: () => `context-preparation:${crypto.randomUUID()}`,
      compactionId: () => `context-compaction:${crypto.randomUUID()}`,
    };
    this.usageSnapshotCache = options.usageSnapshotCache
      ?? new Map<string, SessionContextUsageSnapshot>();
  }

  async build(request: BuildContextRequest): Promise<BuildContextResult> {
    const span = this.options.observability?.startSpan({
      name: 'context.build',
      correlation: { sessionId: request.sessionId, workspaceId: request.workspaceId },
    });
    const operation = async (): Promise<BuildContextResult> => {
      let result: BuildContextResult;
      try {
        result = await this.withSessionOperation(
          request.sessionId,
          () => this.buildExclusive(request),
        );
      } catch (error) {
        result = failed({
          code: 'context_build_failed',
          message: messageOf(error),
          retryable: false,
        });
      }
      if (span) {
        this.options.observability?.endSpan({
          span,
          status: result.status === 'ready'
            ? 'ok'
            : result.failure.code === 'cancelled' ? 'cancelled' : 'error',
        });
      }
      if (result.status === 'ready') {
        this.options.observability?.recordMeasurement({
          name: 'context.used_tokens',
          value: result.prepared.usage.usedTokens,
          unit: 'token',
          correlation: { sessionId: request.sessionId },
        });
        this.options.observability?.recordMeasurement({
          name: 'context.window_tokens',
          value: result.prepared.usage.contextWindowTokens,
          unit: 'token',
          correlation: { sessionId: request.sessionId },
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
        const facts = await this.loadFacts({
          sessionId: request.sessionId,
          workspaceId: request.workspaceId,
          tools: [],
          model: request.model,
          ...(request.signal ? { signal: request.signal } : {}),
        });
        if (facts.status === 'failed') return facts;
        const built = await this.buildModelContext(facts.facts, request.model, request.signal);
        if (built.status === 'failed') return built;
        const before = this.countUsage(built.built.context, request.model, policy, request.signal);
        if (before.status === 'failed') return before;
        const compacted = await this.executeCompaction({
          facts: facts.facts,
          usageBefore: before.usage,
          model: request.model,
          policy,
          automatic: false,
          ...(request.onProgress ? { onProgress: request.onProgress } : {}),
          ...(request.signal ? { signal: request.signal } : {}),
        });
        return compacted.status === 'compacted'
          ? {
              status: 'compacted',
              compactionId: compacted.compactionId,
              usageBefore: before.usage,
              usageAfter: compacted.usageAfter,
            }
          : compacted;
      });
    } catch (error) {
      if (request.signal?.aborted || isAbortError(error)) return failed(cancelled());
      return failed({
        code: 'compaction_failed',
        message: messageOf(error),
        retryable: false,
      });
    }
  }

  getSessionUsage(request: GetSessionContextUsageRequest): GetSessionContextUsageResult {
    const snapshot = this.usageSnapshotCache.get(request.sessionId);
    return snapshot ? { status: 'available', snapshot } : { status: 'not_available' };
  }

  recordCompletedModelCall(
    request: RecordCompletedModelCallUsageRequest,
  ): RecordCompletedModelCallUsageResult {
    return recordContextUsage({
      request,
      policy: this.resolvePolicy(),
      cache: this.usageSnapshotCache,
      now: () => this.clock.now(),
    });
  }

  private async buildExclusive(request: BuildContextRequest): Promise<BuildContextResult> {
    if (request.signal?.aborted) return failed(cancelled());
    const policy = this.resolvePolicy();
    const loaded = await this.loadFacts({
      sessionId: request.sessionId,
      workspaceId: request.workspaceId,
      throughEntryId: request.currentRun.userEntry.parentEntryId ?? null,
      currentRun: request.currentRun,
      selectedSkill: request.selectedSkill,
      tools: request.tools,
      model: request.model,
      ...(request.signal ? { signal: request.signal } : {}),
    });
    if (loaded.status === 'failed') return loaded;
    if (request.signal?.aborted) return failed(cancelled());

    let facts = loaded.facts;
    let buildResult = await this.buildModelContext(facts, request.model, request.signal);
    if (buildResult.status === 'failed') return buildResult;
    let built = buildResult.built;
    let usageResult = this.countUsage(built.context, request.model, policy, request.signal);
    if (usageResult.status === 'failed') return usageResult;
    let usage = usageResult.usage;
    let compactionId: string | undefined;

    if (usage.usedRatio >= policy.compactionThresholdRatio) {
      const compacted = await this.executeCompaction({
        facts,
        usageBefore: usage,
        model: request.model,
        policy,
        automatic: true,
        ...(request.onCompactionProgress ? { onProgress: request.onCompactionProgress } : {}),
        ...(request.signal ? { signal: request.signal } : {}),
      });
      if (compacted.status === 'failed') return compacted;
      if (compacted.status === 'compacted') {
        facts = compacted.facts;
        compactionId = compacted.compactionId;
        // The saved Summary is now a Session fact; rebuilding prevents returning a pre-commit projection.
        buildResult = await this.buildModelContext(facts, request.model, request.signal);
        if (buildResult.status === 'failed') return buildResult;
        built = buildResult.built;
        usageResult = this.countUsage(built.context, request.model, policy, request.signal);
        if (usageResult.status === 'failed') return usageResult;
        usage = usageResult.usage;
      }
    }

    if (request.signal?.aborted) return failed(cancelled());
    if (usage.usedTokens >= usage.contextWindowTokens) return failed(windowExceeded(usage));
    return {
      status: 'ready',
      prepared: {
        preparationId: this.ids.preparationId(),
        context: built.context,
        usage,
        sourceRefs: built.sourceRefs,
        ...(compactionId ? { compaction: { compactionId } } : {}),
      },
    };
  }

  private async loadFacts(input: {
    readonly sessionId: string;
    readonly workspaceId: string;
    readonly throughEntryId?: string | null;
    readonly currentRun?: CurrentConversationRun;
    readonly selectedSkill?: SkillSelection;
    readonly tools: readonly Tool[];
    readonly model: Model<Api>;
    readonly signal?: AbortSignal;
  }): Promise<
    | { readonly status: 'loaded'; readonly facts: ActiveContextFacts }
    | { readonly status: 'failed'; readonly failure: ContextFailure }
  > {
    const historyResult = this.options.sessionHistory.getActiveHistory({
      session_id: input.sessionId,
      ...(input.throughEntryId !== undefined
        ? { through_entry_id: input.throughEntryId }
        : {}),
    });
    if (input.signal?.aborted) return failed(cancelled());
    if (historyResult.status === 'failed') {
      return failed(ownerFailure(
        'session_history_failed',
        'Session history could not be loaded.',
        'session',
        historyResult.failure,
      ));
    }

    const scope = this.options.scopeResolver.resolve({ workspaceId: input.workspaceId });
    if (input.signal?.aborted) return failed(cancelled());
    if (scope.status === 'failed') {
      return failed(ownerFailure(
        'instruction_load_failed',
        scope.failure.message,
        'instructions',
        scope.failure,
      ));
    }
    const systemInstructions = this.options.instructionReader.getSystemInstructions();
    if (input.signal?.aborted) return failed(cancelled());
    const effectiveInstructions = await this.options.instructionReader.getEffectiveInstructions(
      {
        workspaceRoot: scope.workspaceRoot,
        workingDirectory: scope.executionEnvironment.workingDirectory,
      },
      input.signal ? { signal: input.signal } : undefined,
    );
    if (input.signal?.aborted || effectiveInstructions.status === 'cancelled') {
      return failed(cancelled());
    }
    if (effectiveInstructions.status === 'failed') {
      return failed(ownerFailure(
        'instruction_load_failed',
        effectiveInstructions.failure.message,
        'instructions',
        effectiveInstructions.failure,
      ));
    }
    const skills = await this.loadSkills({
      workspaceRoot: scope.workspaceRoot,
      selectedSkill: input.selectedSkill,
      currentRun: input.currentRun,
      signal: input.signal,
    });
    if (skills.status === 'failed') return skills;
    if (input.signal?.aborted) return failed(cancelled());

    return {
      status: 'loaded',
      facts: {
        sessionId: input.sessionId,
        executionEnvironment: { ...scope.executionEnvironment },
        expectedActiveEntryId: input.currentRun?.lastEntryId
          ?? input.currentRun?.userEntry.entryId
          ?? historyResult.history.at(-1)?.entry.entry_id
          ?? null,
        historicalRuns: buildConversationRuns(historyResult.history),
        systemInstructions: [...systemInstructions],
        effectiveInstructions: effectiveInstructions.instructions,
        skillCatalog: skills.skillCatalog,
        usedSkills: skills.usedSkills,
        tools: input.tools.map((tool) => ({ ...tool })),
        ...(effectiveSummary(historyResult.history)
          ? { compactionSummary: effectiveSummary(historyResult.history) }
          : {}),
        ...(input.currentRun ? { currentRun: input.currentRun } : {}),
      },
    };
  }

  private async loadSkills(input: {
    readonly workspaceRoot: string;
    readonly selectedSkill?: SkillSelection;
    readonly currentRun?: CurrentConversationRun;
    readonly signal?: AbortSignal;
  }): Promise<
    | {
        readonly status: 'loaded';
        readonly skillCatalog: SkillCatalogItem[];
        readonly usedSkills: UsedSkillContent[];
      }
    | { readonly status: 'failed'; readonly failure: ContextFailure }
  > {
    const skillService = this.options.skillServiceFactory?.({ workspaceRoot: input.workspaceRoot });
    if (!skillService) {
      if (input.selectedSkill) {
        return failed(ownerFailure(
          'skill_catalog_failed',
          'Skill Service is not configured for the selected Skill.',
          'skills',
          { code: 'skill_service_unavailable' },
        ));
      }
      return {
        status: 'loaded',
        skillCatalog: [],
        usedSkills: usedSkillsFromCurrentRun(input.currentRun),
      };
    }
    const catalog = await skillService.getSkillCatalog({});
    if (input.signal?.aborted) return failed(cancelled());
    if (catalog.status === 'failed') {
      return failed(ownerFailure(
        'skill_catalog_failed',
        catalog.message,
        'skills',
        { code: 'skill_catalog_failed', message: catalog.message },
      ));
    }
    const usedSkills = usedSkillsFromCurrentRun(input.currentRun);
    if (input.selectedSkill) {
      const selected = await skillService.useSkill({ skillPath: input.selectedSkill.skillPath });
      if (input.signal?.aborted) return failed(cancelled());
      if (selected.status !== 'ok') {
        return failed(ownerFailure(
          'skill_catalog_failed',
          selected.status === 'failed'
            ? selected.message
            : `Skill ${selected.skillPath} is ${selected.status === 'not_found' ? 'not found' : 'unavailable'}.`,
          'skills',
          { code: `skill_${selected.status}` },
        ));
      }
      mergeUsedSkill(usedSkills, selected.skill);
    }
    return { status: 'loaded', skillCatalog: catalog.skills, usedSkills };
  }

  private async buildModelContext(
    facts: ActiveContextFacts,
    model: Model<Api>,
    signal?: AbortSignal,
  ): Promise<
    | {
        readonly status: 'built';
        readonly built: { readonly context: AiContext; readonly sourceRefs: ContextSourceRef[] };
      }
    | { readonly status: 'failed'; readonly failure: ContextFailure }
  > {
    const active = assembleActiveContext(facts);
    const materialized = await materializeActiveContextImages({
      activeContext: active.activeContext,
      attachmentReader: this.options.attachmentReader,
      imageInputSupport: capabilitiesFromModel(model).imageInput,
      ...(signal ? { signal } : {}),
    });
    if (materialized.status === 'failed') return materialized;
    try {
      return {
        status: 'built',
        built: {
          context: buildAiContext(materialized.activeContext),
          sourceRefs: active.sourceRefs,
        },
      };
    } catch (error) {
      return failed({
        code: 'context_build_failed',
        message: messageOf(error),
        retryable: false,
        cause: { owner: 'ai' },
      });
    }
  }

  private countUsage(
    context: AiContext,
    model: Model<Api>,
    policy: ContextPolicy,
    signal?: AbortSignal,
  ): { readonly status: 'counted'; readonly usage: ContextUsage }
    | { readonly status: 'failed'; readonly failure: ContextFailure } {
    if (signal?.aborted) return failed(cancelled());
    try {
      const inputTokens = this.options.contextTokenEstimator?.(context)
        ?? estimateContextTokens(context).tokens;
      return {
        status: 'counted',
        usage: calculateContextUsage({
          inputTokens,
          capacity: contextCapacityFromModel(model),
          policy,
        }),
      };
    } catch (error) {
      return failed({
        code: 'token_count_failed',
        message: messageOf(error),
        retryable: false,
        cause: { owner: 'ai' },
      });
    }
  }

  private executeCompaction(input: {
    readonly facts: ActiveContextFacts;
    readonly usageBefore: ContextUsage;
    readonly model: Model<Api>;
    readonly policy: ContextPolicy;
    readonly automatic: boolean;
    readonly onProgress?: (progress: ContextCompactionProgress) => void;
    readonly signal?: AbortSignal;
  }) {
    return executeContextCompaction({
      ...input,
      models: this.options.models,
      sessionHistory: this.options.sessionHistory,
      observability: this.options.observability,
      now: () => this.clock.now(),
      createCompactionId: () => this.ids.compactionId(),
      project: async (facts, signal) => {
        const result = await this.buildModelContext(facts, input.model, signal);
        return result.status === 'built'
          ? { status: 'built' as const, context: result.built.context }
          : result;
      },
      countUsage: (context, model, policy, signal) => (
        this.countUsage(context, model, policy, signal)
      ),
    });
  }

  private resolvePolicy(): ContextPolicy {
    return resolveContextPolicy(this.options.policy, this.options.policyProvider?.getPolicy());
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

function effectiveSummary(history: SessionHistoryItem[]): VisibleCompactionSummary | undefined {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const item = history[index]!;
    if (item.type === 'compaction') {
      return {
        compactionId: item.compaction.compaction_id,
        content: item.compaction.summary_text,
      };
    }
  }
  return undefined;
}

function usedSkillsFromCurrentRun(currentRun: CurrentConversationRun | undefined): UsedSkillContent[] {
  const usedSkills: UsedSkillContent[] = [];
  for (const item of currentRun?.runItems ?? []) {
    if (item.type !== 'tool_result' || item.toolName !== 'use_skill' || item.status !== 'success') {
      continue;
    }
    for (const source of item.runtimeSources ?? []) {
      if (source.sourceKind !== 'skill') continue;
      const name = source.metadata?.name;
      const skillPath = source.metadata?.skillPath;
      if (typeof name !== 'string' || typeof skillPath !== 'string') continue;
      mergeUsedSkill(usedSkills, { name, skillPath, content: source.text });
    }
  }
  return usedSkills;
}

function mergeUsedSkill(usedSkills: UsedSkillContent[], skill: UsedSkillContent): void {
  const index = usedSkills.findIndex((candidate) => candidate.skillPath === skill.skillPath);
  if (index >= 0) usedSkills[index] = { ...skill };
  else usedSkills.push({ ...skill });
}

function ownerFailure(
  code: ContextFailure['code'],
  message: string,
  owner: NonNullable<ContextFailure['cause']>['owner'],
  failure: { readonly code?: string; readonly message?: string },
): ContextFailure {
  return {
    code,
    message,
    retryable: true,
    cause: { owner, ...(failure.code ? { code: failure.code } : {}) },
  };
}

function windowExceeded(usage: ContextUsage): ContextFailure {
  return {
    code: 'context_window_exceeded',
    message: `Context uses ${usage.usedTokens} tokens for a ${usage.contextWindowTokens}-token Context Window.`,
    retryable: false,
  };
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

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Context operation failed.';
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}
