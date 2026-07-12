/*
 * Orchestrates Context v2 from owner-provided history, instructions, skills,
 * historical Runs, model seams, and a synchronous completed-Run usage cache.
 */
import type { GetHistoricalRunResult, HistoricalRun } from '../../agent-run';
import type { InstructionService } from '../../instructions';
import type { SessionHistoryItem, SessionService } from '../../session';
import type { SkillService } from '../../skills';
import type { ContextCapacity, ContextPolicy, ContextUsage, SessionUsageSnapshot } from '../domain/model/context-usage';
import type { ConversationTurn, CurrentConversationTurn } from '../domain/model/conversation-turn';
import type { ContextSourceRef, Prompt, VisibleCompactionSummary } from '../domain/model/prompt';
import { buildActiveContext } from './internal/active-context-builder';
import { buildCompactionSummaryRequest } from './internal/compaction-summary-builder';
import { planCompaction, validateCompactionReduction } from './internal/compaction-planner';
import { calculateContextUsage, type ContextPromptTokenCounter } from './internal/context-usage-calculator';
import { buildConversationTurns } from './internal/conversation-turn-builder';
import { conversationItemsFromTurn } from './internal/conversation-turn-items';
import { buildPrompt } from './internal/prompt-builder';
import type { ContextService } from './context-service';
import type {
  CompactSessionRequest,
  CompactSessionResult,
  ContextFailure,
  GetSessionUsageSnapshotRequest,
  GetSessionUsageSnapshotResult,
  PrepareModelCallRequest,
  PrepareModelCallResult,
  RecordCompletedRunUsageRequest,
  RecordCompletedRunUsageResult,
} from './context-service-types';

export type InstructionScopeResolver = {
  resolve(request: { workspaceId: string }):
    | { status: 'resolved'; workspaceRoot: string; workingDirectory: string }
    | { status: 'failed'; failure: { code: string; message: string } };
};

export type ContextServiceDependencies = {
  sessionService: Pick<SessionService, 'getActiveHistory' | 'saveCompactionSummary'>;
  runHistoryQuery: { getHistoricalRun(runId: string): GetHistoricalRunResult };
  instructionScopeResolver: InstructionScopeResolver;
  instructionService: InstructionService;
  skillService: Pick<SkillService, 'getSkillCatalog'>;
  promptTokenCounter: ContextPromptTokenCounter;
  summaryModelCall: {
    complete(request: { prompt: Prompt; modelContext: ContextCapacity; sessionId?: string; compactionId?: string; signal?: AbortSignal }): Promise<
      | { status: 'completed'; content: string }
      | { status: 'failed'; failure: ContextFailure }
    >;
  };
  usageSnapshotCache: {
    get(sessionId: string): SessionUsageSnapshot | undefined;
    set(sessionId: string, snapshot: SessionUsageSnapshot): void;
  };
  observability?: {
    recordPreparedCall(input: { preparationId: string; sourceRefs: ContextSourceRef[]; usage: ContextUsage }): void;
  };
  policy?: Partial<ContextPolicy>;
  clock?: { now(): string };
  ids?: { preparationId(): string; compactionId(): string };
};

type BuildFacts = {
  sessionId: string;
  expectedActiveEntryId: string | null;
  historicalTurns: ConversationTurn[];
  systemInstructions: ReturnType<InstructionService['getSystemInstructions']>;
  agentInstructions: { sources: Array<{ sourceId: string; sourcePath: string; content: string }> };
  skillCatalog: Array<{ skillId: string; name: string; description: string }>;
  activatedSkills: Array<{ skillId: string; name: string; content: string }>;
  memoryRecall?: PrepareModelCallRequest['memoryRecall'];
  tools: PrepareModelCallRequest['tools'];
  compactionSummary?: VisibleCompactionSummary;
  currentTurn?: CurrentConversationTurn;
};

type BuiltPrompt = { prompt: Prompt; sourceRefs: ContextSourceRef[] };

export class ContextServiceImpl implements ContextService {
  private readonly policy: ContextPolicy;
  private readonly clock: { now(): string };
  private readonly ids: { preparationId(): string; compactionId(): string };
  private readonly sessionOperationTails = new Map<string, Promise<void>>();

  constructor(private readonly dependencies: ContextServiceDependencies) {
    this.policy = {
      compactionThresholdRatio: dependencies.policy?.compactionThresholdRatio ?? 0.8,
      keepRecentTurns: dependencies.policy?.keepRecentTurns ?? 3,
    };
    calculateContextUsage({ inputTokens: 0, capacity: { providerId: 'validation', modelId: 'validation', contextWindowTokens: 1 }, policy: this.policy });
    this.clock = dependencies.clock ?? { now: () => new Date().toISOString() };
    this.ids = dependencies.ids ?? {
      preparationId: () => `context-preparation:${crypto.randomUUID()}`,
      compactionId: () => `context-compaction:${crypto.randomUUID()}`,
    };
  }

  async prepareModelCall(request: PrepareModelCallRequest): Promise<PrepareModelCallResult> {
    return this.withSessionOperation(request.sessionId, () => this.prepareModelCallExclusive(request));
  }

  private async prepareModelCallExclusive(request: PrepareModelCallRequest): Promise<PrepareModelCallResult> {
    if (request.signal?.aborted) return failed(cancelled());
    const loaded = await this.loadFacts({
      sessionId: request.sessionId,
      workspaceId: request.workspaceId,
      throughEntryId: request.currentTurn.userEntry.parentEntryId ?? null,
      currentTurn: request.currentTurn,
      activatedSkills: request.activatedSkills,
      memoryRecall: request.memoryRecall,
      tools: request.tools,
      signal: request.signal,
    });
    if (loaded.status === 'failed') return loaded;
    if (request.signal?.aborted) return failed(cancelled());

    let facts = loaded.facts;
    let built = this.buildPrompt(facts);
    let usageResult = await this.countUsage(built.prompt, request.modelContext, request.signal);
    if (usageResult.status === 'failed') return usageResult;
    let usage = usageResult.usage;
    let compactionId: string | undefined;

    if (usage.usedRatio >= this.policy.compactionThresholdRatio) {
      const compacted = await this.compactInternal({ facts, usageBefore: usage, modelContext: request.modelContext, signal: request.signal });
      if (compacted.status === 'failed') return compacted;
      if (compacted.status === 'compacted') {
        facts = compacted.facts;
        compactionId = compacted.compactionId;
        // A saved Summary is now an owner fact. Rebuild and recount rather than
        // returning the pre-persistence validation projection.
        built = this.buildPrompt(facts);
        usageResult = await this.countUsage(built.prompt, request.modelContext, request.signal);
        if (usageResult.status === 'failed') return usageResult;
        usage = usageResult.usage;
      }
    }

    if (request.signal?.aborted) return failed(cancelled());
    if (usage.usedTokens >= usage.contextWindowTokens) return failed(windowExceeded(usage));
    const preparationId = this.ids.preparationId();
    try {
      this.dependencies.observability?.recordPreparedCall({ preparationId, sourceRefs: built.sourceRefs, usage });
    } catch {
      // Observability is never a recovery source and cannot block preparation.
    }
    return {
      status: 'ready',
      prepared: {
        preparationId,
        prompt: built.prompt,
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
    const loaded = await this.loadFacts({ sessionId: request.sessionId, workspaceId: request.workspaceId, tools: [], activatedSkills: [], signal: request.signal });
    if (loaded.status === 'failed') return loaded;
    if (request.signal?.aborted) return failed(cancelled());
    const built = this.buildPrompt(loaded.facts);
    const before = await this.countUsage(built.prompt, request.modelContext, request.signal);
    if (before.status === 'failed') return before;
    const compacted = await this.compactInternal({ facts: loaded.facts, usageBefore: before.usage, modelContext: request.modelContext, signal: request.signal });
    if (compacted.status !== 'compacted') return compacted;
    return { status: 'compacted', compactionId: compacted.compactionId, usageBefore: before.usage, usageAfter: compacted.usageAfter };
  }

  recordCompletedRunUsage(request: RecordCompletedRunUsageRequest): RecordCompletedRunUsageResult {
    const invalid = validateSnapshotRequest(request);
    if (invalid) return failed(invalid);
    const usage = request.providerInputTokens === undefined
      ? request.preCallUsage
      : calculateContextUsage({ inputTokens: request.providerInputTokens, capacity: request.modelContext, policy: this.policy });
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
    currentTurn?: CurrentConversationTurn;
    activatedSkills: PrepareModelCallRequest['activatedSkills'];
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

    const historicalRuns = new Map<string, HistoricalRun>();
    for (const runId of historicalRunIds(historyResult.history)) {
      const result = this.dependencies.runHistoryQuery.getHistoricalRun(runId);
      if (input.signal?.aborted) return failed(cancelled());
      if (result.status === 'failed') {
        const code = result.failure.code;
        const message = result.failure.message;
        return failed(ownerFailure('historical_run_failed', message, 'agent_run', { code, message }));
      }
      if (result.status === 'found') historicalRuns.set(runId, result.historicalRun);
    }
    const turns = buildConversationTurns({ history: historyResult.history, historicalRunsByRunId: historicalRuns });

    const scope = this.dependencies.instructionScopeResolver.resolve({ workspaceId: input.workspaceId });
    if (input.signal?.aborted) return failed(cancelled());
    if (scope.status === 'failed') return failed(ownerFailure('instruction_load_failed', scope.failure.message, 'instructions', scope.failure));
    const systemInstructions = this.dependencies.instructionService.getSystemInstructions();
    if (input.signal?.aborted) return failed(cancelled());
    const agentInstructions = await this.dependencies.instructionService.getEffectiveAgentInstructions({ workspaceRoot: scope.workspaceRoot, workingDirectory: scope.workingDirectory });
    if (input.signal?.aborted) return failed(cancelled());
    if (agentInstructions.status === 'failed') return failed(ownerFailure('instruction_load_failed', agentInstructions.message, 'instructions', { code: 'instruction_load_failed', message: agentInstructions.message }));
    const catalog = await this.dependencies.skillService.getSkillCatalog({ workspaceId: input.workspaceId });
    if (input.signal?.aborted) return failed(cancelled());
    if (catalog.status === 'failed') return failed(ownerFailure('skill_catalog_failed', catalog.message, 'skills', { code: 'skill_catalog_failed', message: catalog.message }));

    return {
      status: 'loaded',
      facts: {
        sessionId: input.sessionId,
        expectedActiveEntryId: input.currentTurn?.userEntry.entryId
          ?? historyResult.history.at(-1)?.entry.entry_id
          ?? null,
        historicalTurns: turns.turns,
        systemInstructions,
        agentInstructions: agentInstructions.instructions,
        skillCatalog: catalog.skills,
        activatedSkills: input.activatedSkills,
        ...(input.memoryRecall ? { memoryRecall: input.memoryRecall } : {}),
        tools: input.tools,
        ...(effectiveSummary(historyResult.history) ? { compactionSummary: effectiveSummary(historyResult.history) } : {}),
        ...(input.currentTurn ? { currentTurn: input.currentTurn } : {}),
      },
    };
  }

  private buildPrompt(facts: BuildFacts): BuiltPrompt {
    if (facts.currentTurn) {
      const built = buildActiveContext({ ...facts, currentTurn: facts.currentTurn });
      return { prompt: buildPrompt(built.activeContext), sourceRefs: built.sourceRefs };
    }
    return {
      prompt: promptWithoutCurrentTurn(facts),
      sourceRefs: sourceRefsWithoutCurrentTurn(facts),
    };
  }

  private async countUsage(prompt: Prompt, capacity: ContextCapacity, signal?: AbortSignal): Promise<{ status: 'counted'; usage: ContextUsage } | { status: 'failed'; failure: ContextFailure }> {
    const result = await this.dependencies.promptTokenCounter.count({ prompt, modelContext: capacity });
    if (signal?.aborted) return failed(cancelled());
    if (result.status === 'failed') return failed(result.failure);
    try {
      return { status: 'counted', usage: calculateContextUsage({ inputTokens: result.inputTokens, capacity, policy: this.policy }) };
    } catch (error) {
      return failed({ code: 'token_count_failed', message: messageOf(error), retryable: false, cause: { owner: 'ai' } });
    }
  }

  private async compactInternal(input: { facts: BuildFacts; usageBefore: ContextUsage; modelContext: ContextCapacity; signal?: AbortSignal }): Promise<
    | { status: 'compacted'; compactionId: string; usageAfter: ContextUsage; facts: BuildFacts }
    | { status: 'nothing_to_compact'; reason: 'no_historical_turns' | 'no_older_turns' | 'summary_not_reducing' }
    | { status: 'failed'; failure: ContextFailure }
  > {
    const plan = planCompaction({
      historicalTurns: input.facts.historicalTurns,
      keepRecentTurns: this.policy.keepRecentTurns,
      ...(input.facts.currentTurn ? { currentTurn: input.facts.currentTurn } : {}),
    });
    if (plan.status === 'nothing_to_compact') return plan;
    if (input.signal?.aborted) return failed(cancelled());

    const compactionId = this.ids.compactionId();
    const summaryRequest = buildCompactionSummaryRequest({ previousSummary: input.facts.compactionSummary?.content, turns: plan.plan.turns });
    const summaryPrompt = summaryPromptFrom(summaryRequest.systemPrompt, summaryRequest.input);
    const generated = await this.dependencies.summaryModelCall.complete({ prompt: summaryPrompt, modelContext: input.modelContext, sessionId: input.facts.sessionId, compactionId, ...(input.signal ? { signal: input.signal } : {}) });
    if (input.signal?.aborted) return failed(cancelled());
    if (generated.status === 'failed') return failed({ ...generated.failure, code: 'compaction_failed' });
    if (generated.content.trim().length === 0) {
      return failed({ code: 'compaction_failed', message: 'Compaction summary model returned empty content.', retryable: true, cause: { owner: 'ai' } });
    }
    const retainedTurns = input.facts.historicalTurns.slice(plan.plan.turns.length);
    const compactedFacts: BuildFacts = { ...input.facts, historicalTurns: retainedTurns, compactionSummary: { compactionId, content: generated.content } };
    const projected = await this.countUsage(this.buildPrompt(compactedFacts).prompt, input.modelContext, input.signal);
    if (projected.status === 'failed') return projected;
    const reduction = validateCompactionReduction({
      usageBeforeInputTokens: input.usageBefore.usedTokens,
      usageAfterInputTokens: projected.usage.usedTokens,
    });
    if (reduction.status === 'nothing_to_compact') return reduction;
    if (input.signal?.aborted) return failed(cancelled());

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
    if (saved.status === 'failed') return failed(ownerFailure('compaction_persist_failed', saved.failure.message, 'session', saved.failure));
    if (input.signal?.aborted) return failed(cancelled());
    return { status: 'compacted', compactionId, usageAfter: projected.usage, facts: compactedFacts };
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

function historicalRunIds(history: SessionHistoryItem[]): string[] {
  const afterSummary = historyAfterSummary(history);
  return [...new Set(afterSummary.flatMap((item) => item.type === 'message' && item.message.role === 'user' && item.message.run_id ? [item.message.run_id] : []))];
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

function promptWithoutCurrentTurn(facts: BuildFacts): Prompt {
  return {
    instructions: { system: facts.systemInstructions, agentInstructions: facts.agentInstructions, activatedSkills: facts.activatedSkills },
    referenceContext: { skillCatalog: facts.skillCatalog, ...(facts.compactionSummary ? { compactionSummary: facts.compactionSummary } : {}), ...(facts.memoryRecall ? { memoryRecall: facts.memoryRecall } : {}) },
    conversation: facts.historicalTurns.flatMap(conversationItemsFromTurn),
    tools: facts.tools,
  };
}

function sourceRefsWithoutCurrentTurn(facts: BuildFacts): ContextSourceRef[] {
  return [
    ...facts.systemInstructions.map((item) => ({ sourceType: 'system_instruction' as const, sourceId: item.instructionId })),
    ...facts.agentInstructions.sources.map((item) => ({ sourceType: 'agent_instruction' as const, sourceId: item.sourceId })),
    ...facts.skillCatalog.map((item) => ({ sourceType: 'skill_catalog' as const, sourceId: item.skillId })),
    ...facts.activatedSkills.map((item) => ({ sourceType: 'activated_skill' as const, sourceId: item.skillId })),
    ...(facts.compactionSummary ? [{ sourceType: 'compaction_summary' as const, sourceId: facts.compactionSummary.compactionId }] : []),
  ];
}

function summaryPromptFrom(systemPrompt: string, input: string): Prompt {
  return {
    instructions: { system: [{ instructionId: 'context:compaction-summary', content: systemPrompt }], agentInstructions: { sources: [] }, activatedSkills: [] },
    referenceContext: { skillCatalog: [] },
    conversation: [{ type: 'user_message', content: [{ type: 'text', text: input }] }],
    tools: [],
  };
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
  return { code: 'context_window_exceeded', message: `Prompt uses ${usage.usedTokens} tokens for a ${usage.contextWindowTokens}-token Context Window.`, retryable: false };
}

function cancelled(): ContextFailure { return { code: 'cancelled', message: 'Context preparation was cancelled.', retryable: true }; }
function failed<T extends ContextFailure>(failure: T): { status: 'failed'; failure: T } { return { status: 'failed', failure }; }
function messageOf(error: unknown): string { return error instanceof Error ? error.message : 'Context operation failed.'; }
