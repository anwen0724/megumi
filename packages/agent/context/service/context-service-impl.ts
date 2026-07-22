/*
 * Orchestrates Context v2 from owner-provided history, instructions, skills,
 * Session semantic history, model seams, and a synchronous completed-Run usage cache.
 */
import type { InstructionService } from '../../instructions';
import type { SessionHistoryItem, SessionService } from '../../session';
import type { SkillCatalogItem, UsedSkillContent } from '@megumi/skills';
import { estimateContextTokens, type Context as AiContext } from '@megumi/ai';
import type { ContextCapacity, ContextPolicy, ContextUsage, SessionUsageSnapshot } from '../domain/model/context-usage';
import type { ConversationRun, CurrentConversationRun } from '../domain/model/conversation-run';
import type { ContextSourceRef, VisibleCompactionSummary } from '../domain/model/model-context';
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
  PrepareModelCallRequest,
  PrepareModelCallResult,
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
  contextTokenEstimator?: (context: AiContext) => number;
  summaryModelCall: {
    complete(request: { context: AiContext; modelContext: ContextCapacity; sessionId?: string; compactionId?: string; signal?: AbortSignal }): Promise<
      | { status: 'completed'; content: string }
      | { status: 'failed'; failure: ContextFailure }
    >;
  };
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
  memoryRecall?: PrepareModelCallRequest['memoryRecall'];
  tools: PrepareModelCallRequest['tools'];
  compactionSummary?: VisibleCompactionSummary;
  currentRun?: CurrentConversationRun;
};

type BuiltContext = { context: AiContext; sourceRefs: ContextSourceRef[] };
type CompactInternalInput = {
  facts: BuildFacts;
  usageBefore: ContextUsage;
  modelContext: ContextCapacity;
  imageInputSupport: PrepareModelCallRequest['imageInputSupport'];
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

  async prepareModelCall(request: PrepareModelCallRequest): Promise<PrepareModelCallResult> {
    const span = this.dependencies.observability?.startSpan({ name: 'context.prepare_model_call', correlation: { sessionId: request.sessionId, workspaceId: request.workspaceId } });
    const operation = async () => {
      const result = await this.withSessionOperation(request.sessionId, () => this.prepareModelCallExclusive(request));
      if (span) this.dependencies.observability?.endSpan({ span, status: result.status === 'ready' ? 'ok' : result.failure.code === 'cancelled' ? 'cancelled' : 'error' });
      if (result.status === 'ready') {
        this.dependencies.observability?.recordMeasurement({ name: 'context.used_tokens', value: result.prepared.usage.usedTokens, unit: 'token', correlation: { sessionId: request.sessionId } });
        this.dependencies.observability?.recordMeasurement({ name: 'context.window_tokens', value: result.prepared.usage.contextWindowTokens, unit: 'token', correlation: { sessionId: request.sessionId } });
      }
      return result;
    };
    return span ? this.dependencies.observability!.runInSpanContext(span, operation) : operation();
  }

  private async prepareModelCallExclusive(request: PrepareModelCallRequest): Promise<PrepareModelCallResult> {
    if (request.signal?.aborted) return failed(cancelled());
    const policy = this.resolvePolicy();
    const loaded = await this.loadFacts({
      sessionId: request.sessionId,
      workspaceId: request.workspaceId,
      throughEntryId: request.currentRun.userEntry.parentEntryId ?? null,
      currentRun: request.currentRun,
      skillCatalog: request.skillCatalog,
      usedSkills: request.usedSkills,
      memoryRecall: request.memoryRecall,
      tools: request.tools,
      signal: request.signal,
    });
    if (loaded.status === 'failed') return loaded;
    if (request.signal?.aborted) return failed(cancelled());

    let facts = loaded.facts;
    let buildResult = await this.buildModelContext(facts, request.imageInputSupport);
    if (buildResult.status === 'failed') return buildResult;
    let built = buildResult.built;
    let usageResult = this.countUsage(built.context, request.modelContext, policy, request.signal);
    if (usageResult.status === 'failed') return usageResult;
    let usage = usageResult.usage;
    let compactionId: string | undefined;

    if (usage.usedRatio >= policy.compactionThresholdRatio) {
      const compacted = await this.compactInternal({
        facts,
        usageBefore: usage,
        modelContext: request.modelContext,
        imageInputSupport: request.imageInputSupport,
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
        buildResult = await this.buildModelContext(facts, request.imageInputSupport);
        if (buildResult.status === 'failed') return buildResult;
        built = buildResult.built;
        usageResult = this.countUsage(built.context, request.modelContext, policy, request.signal);
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
    const loaded = await this.loadFacts({ sessionId: request.sessionId, workspaceId: request.workspaceId, tools: [], skillCatalog: [], usedSkills: [], signal: request.signal });
    if (loaded.status === 'failed') return loaded;
    if (request.signal?.aborted) return failed(cancelled());
    const buildResult = await this.buildModelContext(loaded.facts, request.imageInputSupport);
    if (buildResult.status === 'failed') return buildResult;
    const before = this.countUsage(buildResult.built.context, request.modelContext, policy, request.signal);
    if (before.status === 'failed') return before;
    const compacted = await this.compactInternal({ facts: loaded.facts, usageBefore: before.usage, modelContext: request.modelContext, imageInputSupport: request.imageInputSupport, policy, signal: request.signal });
    if (compacted.status !== 'compacted') return compacted;
    return { status: 'compacted', compactionId: compacted.compactionId, usageBefore: before.usage, usageAfter: compacted.usageAfter };
  }

  recordCompletedRunUsage(request: RecordCompletedRunUsageRequest): RecordCompletedRunUsageResult {
    const invalid = validateSnapshotRequest(request);
    if (invalid) return failed(invalid);
    const usage = request.providerInputTokens === undefined
      ? request.preCallUsage
      : calculateContextUsage({ inputTokens: request.providerInputTokens, capacity: request.modelContext, policy: this.resolvePolicy() });
    const snapshot: SessionUsageSnapshot = {
      sessionId: request.sessionId,
      runId: request.runId,
      providerId: request.modelContext.providerId,
      modelId: request.modelContext.modelId,
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
    skillCatalog: PrepareModelCallRequest['skillCatalog'];
    usedSkills: PrepareModelCallRequest['usedSkills'];
    memoryRecall?: PrepareModelCallRequest['memoryRecall'];
    tools: PrepareModelCallRequest['tools'];
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
        skillCatalog: input.skillCatalog,
        usedSkills: input.usedSkills,
        ...(input.memoryRecall ? { memoryRecall: input.memoryRecall } : {}),
        tools: input.tools,
        ...(effectiveSummary(historyResult.history) ? { compactionSummary: effectiveSummary(historyResult.history) } : {}),
        ...(input.currentRun ? { currentRun: input.currentRun } : {}),
      },
    };
  }

  private async buildModelContext(
    facts: BuildFacts,
    imageInputSupport: PrepareModelCallRequest['imageInputSupport'],
  ): Promise<{ status: 'built'; built: BuiltContext } | { status: 'failed'; failure: ContextFailure }> {
    const active = buildActiveContext(facts);
    const result = await materializeActiveContextImages({
      activeContext: active.activeContext,
      sessionService: this.dependencies.sessionService,
      imageInputSupport,
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
    const generated = await this.dependencies.summaryModelCall.complete({ context: summaryContext, modelContext: input.modelContext, sessionId: input.facts.sessionId, compactionId, ...(input.signal ? { signal: input.signal } : {}) });
    if (input.signal?.aborted) return compactionFailure(cancelled());
    if (generated.status === 'failed') return compactionFailure({ ...generated.failure, code: 'compaction_failed' });
    if (generated.content.trim().length === 0) {
      return compactionFailure({ code: 'compaction_failed', message: 'Compaction summary model returned empty content.', retryable: true, cause: { owner: 'ai' } });
    }
    const retainedRuns = input.facts.historicalRuns.slice(plan.plan.runs.length);
    const compactedFacts: BuildFacts = { ...input.facts, historicalRuns: retainedRuns, compactionSummary: { compactionId, content: generated.content } };
    const projectedBuilt = await this.buildModelContext(compactedFacts, input.imageInputSupport);
    if (projectedBuilt.status === 'failed') return compactionFailure(projectedBuilt.failure);
    const projected = this.countUsage(projectedBuilt.built.context, input.modelContext, input.policy, input.signal);
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
      summary_text: generated.content,
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
    && Number.isInteger(request.modelContext.contextWindowTokens) && request.modelContext.contextWindowTokens > 0
    && usage.contextWindowTokens === request.modelContext.contextWindowTokens
    && usage.remainingTokens === usage.contextWindowTokens - usage.usedTokens
    && usage.usedRatio === usage.usedTokens / usage.contextWindowTokens
    && Number.isFinite(usage.compactionThresholdRatio) && usage.compactionThresholdRatio > 0 && usage.compactionThresholdRatio < 1;
  const validProvider = request.providerInputTokens === undefined || (Number.isInteger(request.providerInputTokens) && request.providerInputTokens >= 0);
  if (request.sessionId && request.runId && request.modelContext.providerId && request.modelContext.modelId && validUsage && validProvider) return undefined;
  return { code: 'usage_snapshot_invalid', message: 'Completed Run usage snapshot input is invalid.', retryable: false };
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
