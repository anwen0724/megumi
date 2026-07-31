/*
 * Orchestrates Context v2 from owner-provided history, instructions, skills,
 * Session semantic history, model seams, and a synchronous completed-Run usage cache.
 */
import type { InstructionService } from '../../instructions';
import type { SessionHistoryItem, SessionService } from '../../session';
import type { SkillCatalogItem, SkillService, UsedSkillContent } from '@megumi/skills';
import {
  Type,
  estimateContextTokens,
  type Api,
  type Context as AiContext,
  type Model,
  type Models,
  type Tool,
} from '@megumi/ai';
import type { MemoryRecallPort, ModelInputMemoryRecallSource } from '../../memory';
import { capabilitiesFromModel } from '../../model-capability';
import type { ContextCapacity, ContextPolicy, ContextUsage, SessionUsageSnapshot } from '../domain/model/context-usage';
import type { ConversationRun, CurrentConversationRun } from '../domain/model/conversation-run';
import type { ContextSourceRef, MemoryContextInput, VisibleCompactionSummary } from '../domain/model/model-context';
import { buildActiveContext } from './internal/active-context-builder';
import { buildCompactionSummaryRequest } from './internal/compaction-summary-builder';
import { planCompaction, validateCompactionReduction } from './internal/compaction-planner';
import { calculateContextUsage } from './internal/context-usage-calculator';
import { buildConversationRuns } from './internal/conversation-run-builder';
import { buildContext } from './internal/context-builder';
import { materializeActiveContextImages } from './internal/image-content-materializer';
import type { ContextService } from './context-service';
import type {
  CompactSessionRequest,
  CompactSessionResult,
  ContextFailure,
  ContextCompactionProgress,
  GetSessionUsageSnapshotRequest,
  GetSessionUsageSnapshotResult,
  BuildContextRequest,
  BuildContextResult,
  RecordCompletedRunUsageRequest,
  RecordCompletedRunUsageResult,
} from './context-service-types';
import type { ObservabilityService } from '@megumi/observability';

export type InstructionScopeResolver = {
  resolve(request: { workspaceId: string }):
    | { status: 'resolved'; workspaceRoot: string; workingDirectory: string }
    | { status: 'failed'; failure: { code: string; message: string } };
};

export type ContextServiceDependencies = {
  sessionService: Pick<SessionService, 'getActiveHistory' | 'saveCompactionSummary' | 'readAttachmentContent'>;
  instructionScopeResolver: InstructionScopeResolver;
  instructionService: InstructionService;
  skillServiceFactory?: (input: { workspaceRoot: string }) => Pick<SkillService, 'getSkillCatalog' | 'useSkill'>;
  memoryRecall?: Pick<MemoryRecallPort, 'recallForNewUserInput'>;
  memoryHomePath?: string;
  models: Pick<Models, 'completeSimple'>;
  contextTokenEstimator?: (context: AiContext) => number;
  usageSnapshotCache: {
    get(sessionId: string): SessionUsageSnapshot | undefined;
    set(sessionId: string, snapshot: SessionUsageSnapshot): void;
  };
  observability?: ObservabilityService;
  policy?: Partial<ContextPolicy>;
  policyProvider?: { getPolicy(): Partial<ContextPolicy> };
  clock?: { now(): string };
  ids?: { preparationId(): string; compactionId(): string };
};

type BuildFacts = {
  sessionId: string;
  expectedActiveEntryId: string | null;
  historicalRuns: ConversationRun[];
  systemInstructions: ReturnType<InstructionService['getSystemInstructions']>;
  agentInstructions: { sources: Array<{ sourceId: string; sourcePath: string; content: string }> };
  skillCatalog: SkillCatalogItem[];
  usedSkills: UsedSkillContent[];
  memoryRecall?: MemoryContextInput;
  tools: Tool[];
  compactionSummary?: VisibleCompactionSummary;
  currentRun?: CurrentConversationRun;
};

type BuiltContext = { context: AiContext; sourceRefs: ContextSourceRef[] };
type CompactInternalInput = {
  facts: BuildFacts;
  usageBefore: ContextUsage;
  model: Model<Api>;
  policy: ContextPolicy;
  onProgress?: (progress: ContextCompactionProgress) => void;
  signal?: AbortSignal;
};
type CompactInternalResult =
  | { status: 'compacted'; compactionId: string; usageAfter: ContextUsage; facts: BuildFacts }
  | { status: 'nothing_to_compact'; reason: 'no_historical_runs' | 'no_older_runs' | 'summary_not_reducing' }
  | { status: 'failed'; failure: ContextFailure };

export class ContextServiceImpl implements ContextService {
  private readonly defaultPolicy: ContextPolicy;
  private readonly clock: { now(): string };
  private readonly ids: { preparationId(): string; compactionId(): string };
  private readonly sessionOperationTails = new Map<string, Promise<void>>();

  constructor(private readonly dependencies: ContextServiceDependencies) {
    this.defaultPolicy = {
      compactionThresholdRatio: dependencies.policy?.compactionThresholdRatio ?? 0.8,
      keepRecentRuns: dependencies.policy?.keepRecentRuns ?? 3,
    };
    calculateContextUsage({ inputTokens: 0, capacity: { providerId: 'validation', modelId: 'validation', contextWindowTokens: 1 }, policy: this.defaultPolicy });
    this.clock = dependencies.clock ?? { now: () => new Date().toISOString() };
    this.ids = dependencies.ids ?? {
      preparationId: () => `context-preparation:${crypto.randomUUID()}`,
      compactionId: () => `context-compaction:${crypto.randomUUID()}`,
    };
  }

  async build(request: BuildContextRequest): Promise<BuildContextResult> {
    const span = this.dependencies.observability?.startSpan({ name: 'context.build', correlation: { sessionId: request.sessionId, workspaceId: request.workspaceId } });
    const operation = async () => {
      const result = await this.withSessionOperation(request.sessionId, () => this.buildExclusive(request));
      if (span) this.dependencies.observability?.endSpan({ span, status: result.status === 'ready' ? 'ok' : result.failure.code === 'cancelled' ? 'cancelled' : 'error' });
      if (result.status === 'ready') {
        this.dependencies.observability?.recordMeasurement({ name: 'context.used_tokens', value: result.prepared.usage.usedTokens, unit: 'token', correlation: { sessionId: request.sessionId } });
        this.dependencies.observability?.recordMeasurement({ name: 'context.window_tokens', value: result.prepared.usage.contextWindowTokens, unit: 'token', correlation: { sessionId: request.sessionId } });
      }
      return result;
    };
    return span ? this.dependencies.observability!.runInSpanContext(span, operation) : operation();
  }

  private async buildExclusive(request: BuildContextRequest): Promise<BuildContextResult> {
    if (request.signal?.aborted) return failed(cancelled());
    const policy = this.resolvePolicy();
    const capacity = capacityFromModel(request.model);
    const loaded = await this.loadFacts({
      sessionId: request.sessionId,
      workspaceId: request.workspaceId,
      throughEntryId: request.currentRun.userEntry.parentEntryId ?? null,
      currentRun: request.currentRun,
      selectedSkill: request.selectedSkill,
      tools: request.tools,
      model: request.model,
      signal: request.signal,
    });
    if (loaded.status === 'failed') return loaded;
    if (request.signal?.aborted) return failed(cancelled());

    let facts = loaded.facts;
    let buildResult = await this.buildModelContext(facts, request.model);
    if (buildResult.status === 'failed') return buildResult;
    let built = buildResult.built;
    let usageResult = this.countUsage(built.context, capacity, policy, request.signal);
    if (usageResult.status === 'failed') return usageResult;
    let usage = usageResult.usage;
    let compactionId: string | undefined;

    if (usage.usedRatio >= policy.compactionThresholdRatio) {
      const compacted = await this.compactInternal({
        facts,
        usageBefore: usage,
        model: request.model,
        policy,
        onProgress: request.onCompactionProgress,
        signal: request.signal,
      });
      if (compacted.status === 'failed') return compacted;
      if (compacted.status === 'compacted') {
        facts = compacted.facts;
        compactionId = compacted.compactionId;
        // A saved Summary is now an owner fact. Rebuild and recount rather than
        // returning the pre-persistence validation projection.
        buildResult = await this.buildModelContext(facts, request.model);
        if (buildResult.status === 'failed') return buildResult;
        built = buildResult.built;
        usageResult = this.countUsage(built.context, capacity, policy, request.signal);
        if (usageResult.status === 'failed') return usageResult;
        usage = usageResult.usage;
      }
    }

    if (request.signal?.aborted) return failed(cancelled());
    if (usage.usedTokens >= usage.contextWindowTokens) return failed(windowExceeded(usage));
    const preparationId = this.ids.preparationId();
    return {
      status: 'ready',
      prepared: {
        preparationId,
        context: built.context,
        usage,
        sourceRefs: built.sourceRefs,
        ...(compactionId ? { compaction: { compactionId } } : {}),
      },
    };
  }

  async compactSession(request: CompactSessionRequest): Promise<CompactSessionResult> {
    return this.withSessionOperation(request.sessionId, () => this.compactSessionExclusive(request));
  }

  private async compactSessionExclusive(request: CompactSessionRequest): Promise<CompactSessionResult> {
    if (request.signal?.aborted) return failed(cancelled());
    const policy = this.resolvePolicy();
    const capacity = capacityFromModel(request.model);
    const loaded = await this.loadFacts({
      sessionId: request.sessionId,
      workspaceId: request.workspaceId,
      tools: [],
      model: request.model,
      signal: request.signal,
    });
    if (loaded.status === 'failed') return loaded;
    if (request.signal?.aborted) return failed(cancelled());
    const buildResult = await this.buildModelContext(loaded.facts, request.model);
    if (buildResult.status === 'failed') return buildResult;
    const before = this.countUsage(buildResult.built.context, capacity, policy, request.signal);
    if (before.status === 'failed') return before;
    const compacted = await this.compactInternal({
      facts: loaded.facts,
      usageBefore: before.usage,
      model: request.model,
      policy,
      signal: request.signal,
    });
    if (compacted.status !== 'compacted') return compacted;
    return { status: 'compacted', compactionId: compacted.compactionId, usageBefore: before.usage, usageAfter: compacted.usageAfter };
  }

  recordCompletedRunUsage(request: RecordCompletedRunUsageRequest): RecordCompletedRunUsageResult {
    const invalid = validateSnapshotRequest(request);
    if (invalid) return failed(invalid);
    const capacity = capacityFromModel(request.model);
    const usage = request.providerInputTokens === undefined
      ? request.preCallUsage
      : calculateContextUsage({ inputTokens: request.providerInputTokens, capacity, policy: this.resolvePolicy() });
    const snapshot: SessionUsageSnapshot = {
      sessionId: request.sessionId,
      runId: request.runId,
      providerId: request.model.provider,
      modelId: request.model.id,
      usage,
      accuracy: request.providerInputTokens === undefined ? 'estimated' : 'provider_reported',
      calculatedAt: this.clock.now(),
    };
    this.dependencies.usageSnapshotCache.set(request.sessionId, snapshot);
    return { status: 'recorded', snapshot };
  }

  getSessionUsageSnapshot(request: GetSessionUsageSnapshotRequest): GetSessionUsageSnapshotResult {
    const snapshot = this.dependencies.usageSnapshotCache.get(request.sessionId);
    return snapshot ? { status: 'available', snapshot } : { status: 'not_available' };
  }

  private async loadFacts(input: {
    sessionId: string;
    workspaceId: string;
    throughEntryId?: string | null;
    currentRun?: CurrentConversationRun;
    selectedSkill?: BuildContextRequest['selectedSkill'];
    tools: BuildContextRequest['tools'];
    model: Model<Api>;
    signal?: AbortSignal;
  }): Promise<{ status: 'loaded'; facts: BuildFacts } | { status: 'failed'; failure: ContextFailure }> {
    const historyResult = this.dependencies.sessionService.getActiveHistory({
      session_id: input.sessionId,
      ...(input.throughEntryId !== undefined ? { through_entry_id: input.throughEntryId } : {}),
    });
    if (input.signal?.aborted) return failed(cancelled());
    if (historyResult.status === 'failed') return failed(ownerFailure('session_history_failed', 'Session history could not be loaded.', 'session', historyResult.failure));

    const runs = buildConversationRuns({ history: historyResult.history });

    const scope = this.dependencies.instructionScopeResolver.resolve({ workspaceId: input.workspaceId });
    if (input.signal?.aborted) return failed(cancelled());
    if (scope.status === 'failed') return failed(ownerFailure('instruction_load_failed', scope.failure.message, 'instructions', scope.failure));
    const systemInstructions = this.dependencies.instructionService.getSystemInstructions();
    if (input.signal?.aborted) return failed(cancelled());
    const agentInstructions = await this.dependencies.instructionService.getEffectiveAgentInstructions({ workspaceRoot: scope.workspaceRoot, workingDirectory: scope.workingDirectory });
    if (input.signal?.aborted) return failed(cancelled());
    if (agentInstructions.status === 'failed') return failed(ownerFailure('instruction_load_failed', agentInstructions.message, 'instructions', { code: 'instruction_load_failed', message: agentInstructions.message }));
    const skills = await this.loadSkills({
      workspaceRoot: scope.workspaceRoot,
      selectedSkill: input.selectedSkill,
      currentRun: input.currentRun,
      signal: input.signal,
    });
    if (skills.status === 'failed') return skills;
    const memoryRecall = await this.loadMemoryRecall({
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
      currentRun: input.currentRun,
      workingDirectory: scope.workingDirectory,
      model: input.model,
      signal: input.signal,
    });
    if (input.signal?.aborted) return failed(cancelled());
    return {
      status: 'loaded',
      facts: {
        sessionId: input.sessionId,
        expectedActiveEntryId: input.currentRun?.lastEntryId ?? input.currentRun?.userEntry.entryId
          ?? historyResult.history.at(-1)?.entry.entry_id
          ?? null,
        historicalRuns: runs.runs,
        systemInstructions,
        agentInstructions: agentInstructions.instructions,
        skillCatalog: skills.skillCatalog,
        usedSkills: skills.usedSkills,
        ...(memoryRecall ? { memoryRecall } : {}),
        tools: toAiTools(input.tools),
        ...(effectiveSummary(historyResult.history) ? { compactionSummary: effectiveSummary(historyResult.history) } : {}),
        ...(input.currentRun ? { currentRun: input.currentRun } : {}),
      },
    };
  }

  private async loadSkills(input: {
    workspaceRoot: string;
    selectedSkill?: BuildContextRequest['selectedSkill'];
    currentRun?: CurrentConversationRun;
    signal?: AbortSignal;
  }): Promise<
    | { status: 'loaded'; skillCatalog: SkillCatalogItem[]; usedSkills: UsedSkillContent[] }
    | { status: 'failed'; failure: ContextFailure }
  > {
    const skillService = this.dependencies.skillServiceFactory?.({
      workspaceRoot: input.workspaceRoot,
    });
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
      const selected = await skillService.useSkill({
        skillPath: input.selectedSkill.skillPath,
      });
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

    return {
      status: 'loaded',
      skillCatalog: catalog.skills,
      usedSkills,
    };
  }

  private async loadMemoryRecall(input: {
    workspaceId: string;
    sessionId: string;
    currentRun?: CurrentConversationRun;
    workingDirectory: string;
    model: Model<Api>;
    signal?: AbortSignal;
  }): Promise<MemoryContextInput | undefined> {
    if (
      !this.dependencies.memoryRecall
      || !this.dependencies.memoryHomePath
      || !input.currentRun
    ) {
      return undefined;
    }
    const queryText = currentRunText(input.currentRun);
    if (!queryText) return undefined;
    try {
      const recalled = await this.dependencies.memoryRecall.recallForNewUserInput({
        homePath: this.dependencies.memoryHomePath,
        sessionId: input.sessionId,
        runId: input.currentRun.runId,
        projectId: input.workspaceId,
        effectiveCwd: input.workingDirectory,
        queryText,
        providerId: input.model.provider,
        modelId: input.model.id,
      });
      if (input.signal?.aborted) return undefined;
      return memoryContextFromSources(input.currentRun.runId, recalled.memoryRecallSources);
    } catch {
      // Recall is an optional enrichment. Its owner degrades to no recalled
      // memory instead of preventing an otherwise valid Context build.
      return undefined;
    }
  }

  private async buildModelContext(
    facts: BuildFacts,
    model: Model<Api>,
  ): Promise<{ status: 'built'; built: BuiltContext } | { status: 'failed'; failure: ContextFailure }> {
    const active = buildActiveContext(facts);
    const result = await materializeActiveContextImages({
      activeContext: active.activeContext,
      sessionService: this.dependencies.sessionService,
      imageInputSupport: capabilitiesFromModel(model).imageInput,
    });
    if (result.status === 'failed') return result;
    try {
      return {
        status: 'built',
        built: { context: buildContext(result.activeContext), sourceRefs: active.sourceRefs },
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

  private countUsage(context: AiContext, capacity: ContextCapacity, policy: ContextPolicy, signal?: AbortSignal): { status: 'counted'; usage: ContextUsage } | { status: 'failed'; failure: ContextFailure } {
    if (signal?.aborted) return failed(cancelled());
    try {
      const inputTokens = this.dependencies.contextTokenEstimator?.(context)
        ?? estimateContextTokens(context).tokens;
      return { status: 'counted', usage: calculateContextUsage({ inputTokens, capacity, policy }) };
    } catch (error) {
      return failed({ code: 'token_count_failed', message: messageOf(error), retryable: false, cause: { owner: 'ai' } });
    }
  }

  private async compactInternal(input: CompactInternalInput): Promise<CompactInternalResult> {
    const observability = this.dependencies.observability;
    const traced = Boolean(observability?.getCurrentTrace());
    const span = traced ? observability?.startSpan({ name: 'context.compact', correlation: { sessionId: input.facts.sessionId } }) : undefined;
    if (!traced) observability?.recordLog({ level: 'info', event: 'context.compaction.started', correlation: { sessionId: input.facts.sessionId }, attributes: { beforeTokens: input.usageBefore.usedTokens, automatic: false } });
    const operation = async () => {
      const result = await this.compactInternalCore(input);
      const status = result.status === 'compacted' ? 'ok' : result.status === 'failed' && result.failure.code === 'cancelled' ? 'cancelled' : result.status === 'failed' ? 'error' : 'ok';
      if (span) observability?.endSpan({ span, status, attributes: { beforeTokens: input.usageBefore.usedTokens, ...(result.status === 'compacted' ? { afterTokens: result.usageAfter.usedTokens } : {}) } });
      if (!traced) {
        observability?.recordLog({ level: result.status === 'failed' ? 'warn' : 'info', event: result.status === 'compacted' ? 'context.compaction.completed' : 'context.compaction.finished', correlation: { sessionId: input.facts.sessionId }, attributes: { status: result.status, automatic: false } });
        if (result.status === 'compacted') observability?.recordMeasurement({ name: 'context.compaction.after_tokens', value: result.usageAfter.usedTokens, unit: 'token', correlation: { sessionId: input.facts.sessionId } });
      }
      return result;
    };
    return span ? observability!.runInSpanContext(span, operation) : operation();
  }

  private async compactInternalCore(input: CompactInternalInput): Promise<CompactInternalResult> {
    const plan = planCompaction({
      historicalRuns: input.facts.historicalRuns,
      keepRecentRuns: input.policy.keepRecentRuns,
      ...(input.facts.currentRun ? { currentRun: input.facts.currentRun } : {}),
    });
    if (plan.status === 'nothing_to_compact') return plan;
    if (input.signal?.aborted) return failed(cancelled());

    const compactionId = this.ids.compactionId();
    const progressBase = {
      compactionId,
      tokensBefore: input.usageBefore.usedTokens,
      summarizedSourceCount: plan.plan.runs.length,
      ...(plan.plan.firstKeptEntryId ? { firstKeptSourceId: plan.plan.firstKeptEntryId } : {}),
      ...(input.facts.compactionSummary ? { previousCompactionId: input.facts.compactionSummary.compactionId } : {}),
    };
    reportCompactionProgress(input.onProgress, { status: 'started', ...progressBase });
    const compactionFailure = (failure: ContextFailure) => {
      reportCompactionProgress(input.onProgress, {
        status: 'failed',
        compactionId,
        tokensBefore: input.usageBefore.usedTokens,
        code: failure.code,
        message: failure.message,
        ...(input.facts.compactionSummary ? { previousCompactionId: input.facts.compactionSummary.compactionId } : {}),
      });
      return failed(failure);
    };
    const summaryRequest = buildCompactionSummaryRequest({ previousSummary: input.facts.compactionSummary?.content, runs: plan.plan.runs });
    const summaryContext: AiContext = {
      systemPrompt: summaryRequest.systemPrompt,
      messages: [{ role: 'user', content: summaryRequest.input, timestamp: Date.parse(this.clock.now()) }],
    };
    let generated;
    try {
      generated = await this.dependencies.models.completeSimple(input.model, summaryContext, {
        sessionId: input.facts.sessionId,
        ...(input.signal ? { signal: input.signal } : {}),
      });
    } catch (error) {
      return compactionFailure(input.signal?.aborted ? cancelled() : modelFailure(error));
    }
    if (input.signal?.aborted || generated.stopReason === 'aborted') return compactionFailure(cancelled());
    if (generated.stopReason === 'error') {
      return compactionFailure(modelFailure(generated.failure ?? generated.errorMessage));
    }
    const summaryContent = generated.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('');
    if (summaryContent.trim().length === 0) {
      return compactionFailure({ code: 'compaction_failed', message: 'Compaction summary model returned empty content.', retryable: true, cause: { owner: 'ai' } });
    }
    const retainedRuns = input.facts.historicalRuns.slice(plan.plan.runs.length);
    const compactedFacts: BuildFacts = { ...input.facts, historicalRuns: retainedRuns, compactionSummary: { compactionId, content: summaryContent } };
    const projectedBuilt = await this.buildModelContext(compactedFacts, input.model);
    if (projectedBuilt.status === 'failed') return compactionFailure(projectedBuilt.failure);
    const projected = this.countUsage(projectedBuilt.built.context, capacityFromModel(input.model), input.policy, input.signal);
    if (projected.status === 'failed') return compactionFailure(projected.failure);
    const reduction = validateCompactionReduction({
      usageBeforeInputTokens: input.usageBefore.usedTokens,
      usageAfterInputTokens: projected.usage.usedTokens,
    });
    if (reduction.status === 'nothing_to_compact') {
      reportCompactionProgress(input.onProgress, {
        status: 'failed',
        compactionId,
        tokensBefore: input.usageBefore.usedTokens,
        code: reduction.reason,
        message: 'Generated summary did not reduce Context usage.',
      });
      return reduction;
    }
    if (input.signal?.aborted) return compactionFailure(cancelled());

    const saved = this.dependencies.sessionService.saveCompactionSummary({
      compaction_id: compactionId,
      session_id: input.facts.sessionId,
      summary_text: summaryContent,
      covered_until_entry_id: plan.plan.coveredUntilEntryId,
      ...(plan.plan.firstKeptEntryId ? { first_kept_entry_id: plan.plan.firstKeptEntryId } : {}),
      expected_active_entry_id: input.facts.expectedActiveEntryId,
      created_at: this.clock.now(),
      append_to_active_path: true,
    });
    if (saved.status === 'failed') return compactionFailure(ownerFailure('compaction_persist_failed', saved.failure.message, 'session', saved.failure));
    if (input.signal?.aborted) return compactionFailure(cancelled());
    reportCompactionProgress(input.onProgress, { status: 'completed', ...progressBase });
    return { status: 'compacted', compactionId, usageAfter: projected.usage, facts: compactedFacts };
  }

  private resolvePolicy(): ContextPolicy {
    const configured = this.dependencies.policyProvider?.getPolicy() ?? {};
    const policy = {
      compactionThresholdRatio: configured.compactionThresholdRatio
        ?? this.defaultPolicy.compactionThresholdRatio,
      keepRecentRuns: configured.keepRecentRuns ?? this.defaultPolicy.keepRecentRuns,
    };
    calculateContextUsage({
      inputTokens: 0,
      capacity: { providerId: 'validation', modelId: 'validation', contextWindowTokens: 1 },
      policy,
    });
    return policy;
  }

  private async withSessionOperation<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
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
      if (this.sessionOperationTails.get(sessionId) === tail) this.sessionOperationTails.delete(sessionId);
    }
  }
}

function historyAfterSummary(history: SessionHistoryItem[]): SessionHistoryItem[] {
  for (let index = history.length - 1; index >= 0; index -= 1) if (history[index].type === 'compaction') return history.slice(index + 1);
  return history;
}

function effectiveSummary(history: SessionHistoryItem[]): VisibleCompactionSummary | undefined {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const item = history[index];
    if (item.type === 'compaction') return { compactionId: item.compaction.compaction_id, content: item.compaction.summary_text };
  }
  return undefined;
}

function validateSnapshotRequest(request: RecordCompletedRunUsageRequest): ContextFailure | undefined {
  const usage = request.preCallUsage;
  const validUsage = Number.isInteger(usage.usedTokens) && usage.usedTokens >= 0
    && Number.isInteger(request.model.contextWindow) && request.model.contextWindow > 0
    && usage.contextWindowTokens === request.model.contextWindow
    && usage.remainingTokens === usage.contextWindowTokens - usage.usedTokens
    && usage.usedRatio === usage.usedTokens / usage.contextWindowTokens
    && Number.isFinite(usage.compactionThresholdRatio) && usage.compactionThresholdRatio > 0 && usage.compactionThresholdRatio < 1;
  const validProvider = request.providerInputTokens === undefined || (Number.isInteger(request.providerInputTokens) && request.providerInputTokens >= 0);
  if (request.sessionId && request.runId && request.model.provider && request.model.id && validUsage && validProvider) return undefined;
  return { code: 'usage_snapshot_invalid', message: 'Completed Run usage snapshot input is invalid.', retryable: false };
}

function capacityFromModel(model: Model<Api>): ContextCapacity {
  return {
    providerId: model.provider,
    modelId: model.id,
    contextWindowTokens: model.contextWindow,
  };
}

function toAiTools(definitions: BuildContextRequest['tools']): Tool[] {
  return definitions
    .filter((definition) => definition.availability.status === 'available')
    .map((definition) => ({
      name: definition.name,
      description: definition.modelFacingDescription ?? definition.description,
      parameters: Type.Unsafe(definition.inputSchema),
    }));
}

function usedSkillsFromCurrentRun(currentRun: CurrentConversationRun | undefined): UsedSkillContent[] {
  const usedSkills: UsedSkillContent[] = [];
  for (const item of currentRun?.runItems ?? []) {
    if (item.type !== 'tool_result' || item.toolName !== 'use_skill' || item.status !== 'success') {
      continue;
    }
    for (const source of item.runtimeSources ?? []) {
      if (source.source_kind !== 'skill') continue;
      const name = source.metadata?.name;
      const skillPath = source.metadata?.skillPath;
      if (typeof name !== 'string' || typeof skillPath !== 'string') continue;
      mergeUsedSkill(usedSkills, {
        name,
        skillPath,
        content: source.text,
      });
    }
  }
  return usedSkills;
}

function mergeUsedSkill(usedSkills: UsedSkillContent[], skill: UsedSkillContent): void {
  const index = usedSkills.findIndex((candidate) => candidate.skillPath === skill.skillPath);
  if (index >= 0) {
    usedSkills[index] = { ...skill };
  } else {
    usedSkills.push({ ...skill });
  }
}

function currentRunText(currentRun: CurrentConversationRun): string {
  return currentRun.userMessage.content
    .flatMap((block) => block.type === 'text' ? [block.text] : [])
    .join('\n')
    .trim();
}

function memoryContextFromSources(
  runId: string,
  sources: ModelInputMemoryRecallSource[],
): MemoryContextInput | undefined {
  if (sources.length === 0) return undefined;
  return {
    recallId: sources[0]?.sourceId ?? `memory-recall:${runId}`,
    items: sources.flatMap((source) => {
      const memoryIds = source.memoryIds?.length ? source.memoryIds : [source.sourceId];
      return memoryIds.map((memoryId) => ({
        memoryId,
        content: [{ type: 'text' as const, text: source.text }],
      }));
    }),
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
      : typeof error === 'string'
        ? error
        : 'Compaction summary model call failed.',
    retryable: typeof candidate?.retryable === 'boolean' ? candidate.retryable : true,
    cause: {
      owner: 'ai',
      ...(typeof candidate?.code === 'string' ? { code: candidate.code } : {}),
    },
  };
}

function ownerFailure(code: ContextFailure['code'], message: string, owner: NonNullable<ContextFailure['cause']>['owner'], failure: { code?: string; message?: string }): ContextFailure {
  return { code, message, retryable: true, cause: { owner, ...(failure.code ? { code: failure.code } : {}) } };
}

function windowExceeded(usage: ContextUsage): ContextFailure {
  return { code: 'context_window_exceeded', message: `Context uses ${usage.usedTokens} tokens for a ${usage.contextWindowTokens}-token Context Window.`, retryable: false };
}

function cancelled(): ContextFailure { return { code: 'cancelled', message: 'Context preparation was cancelled.', retryable: true }; }
function failed<T extends ContextFailure>(failure: T): { status: 'failed'; failure: T } { return { status: 'failed', failure }; }
function messageOf(error: unknown): string { return error instanceof Error ? error.message : 'Context operation failed.'; }
function reportCompactionProgress(
  reporter: ((progress: ContextCompactionProgress) => void) | undefined,
  progress: ContextCompactionProgress,
): void {
  try {
    reporter?.(progress);
  } catch {
    // UI/observability progress cannot affect Context business execution.
  }
}
