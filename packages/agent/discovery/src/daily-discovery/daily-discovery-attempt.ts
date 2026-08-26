/*
 * Owns execution-scoped candidate, search-budget, and selection facts used by Discovery tools.
 */
import type { RawToolResult } from '@megumi/tools';
import type {
  Observability,
  OperationCompletion,
  TraceCorrelation,
  TraceEvent,
} from '@megumi/observability';
import {
  createCandidateRegistry,
  discoveryContentIdentity,
  type DiscoveryCandidate,
} from './candidate-registry';
import type { RecommendationSelectionSignal } from '../persistence/discovery-repository';
import type {
  SourceContent,
  SourceDescriptor,
  SourceFailure,
  SourceSearchMode,
} from '../sources/discovery-source';
import type { SourceRegistry } from '../sources/source-registry';

const MAX_SEARCH_CALLS = 12;
const MAX_CANDIDATES = 200;
const MAX_READ_CALLS = 40;

interface AttemptRecord {
  readonly targetCount: number;
  readonly descriptors: readonly SourceDescriptor[];
  readonly sourceRegistry: SourceRegistry;
  readonly historicalIdentities: ReadonlySet<string>;
  readonly candidates: ReturnType<typeof createCandidateRegistry>;
  selected?: readonly { readonly candidateId: string; readonly recommendationReason: string }[];
  searchCount: number;
  readCount: number;
  successfulSearches: number;
  failedSearches: number;
  rawCandidates: number;
  invalidSelection: boolean;
  readonly sourceFailures: Array<{ readonly sourceId: string; readonly failure: SourceFailure }>;
  readonly sourceBudgets: Readonly<Record<string, SourceAttemptBudget>>;
  readonly sourceUsage: Map<string, { searchCalls: number; resultCount: number }>;
  readonly attemptedSources: Set<string>;
  readonly sourceTails: Map<string, Promise<void>>;
}

export interface SourceAttemptBudget {
  readonly maxSearchCalls: number;
  readonly maxResultsPerSearch: number;
  readonly maxResultsPerAttempt: number;
}

export interface DailyDiscoveryAttemptState {
  readonly candidates: ReturnType<typeof createCandidateRegistry>;
  readonly selected?: readonly { readonly candidateId: string; readonly recommendationReason: string }[];
  readonly successfulSearches: number;
  readonly failedSearches: number;
  readonly rawCandidates: number;
  readonly invalidSelection: boolean;
  readonly sourceFailures: readonly { readonly sourceId: string; readonly failure: SourceFailure }[];
}

export interface DailyDiscoveryAttempts {
  /** Registers one accepted Daily Discovery Agent Execution. */
  start(request: {
    readonly executionId: string;
    readonly targetCount: number;
    readonly descriptors: readonly SourceDescriptor[];
    readonly signals: readonly RecommendationSelectionSignal[];
    readonly sourceRegistry: SourceRegistry;
    readonly sourceBudgets?: Readonly<Record<string, SourceAttemptBudget>>;
  }): void;
  /** Returns the current immutable-facing Attempt facts for settlement. */
  snapshot(executionId: string): DailyDiscoveryAttemptState | undefined;
  /** Releases every execution-scoped candidate and budget fact. */
  dispose(executionId: string): void;
  /** Executes the search_content tool against one registered Attempt. */
  searchContent(request: { readonly executionId: string; readonly input: unknown; readonly signal: AbortSignal }): Promise<RawToolResult>;
  /** Executes the read_candidate tool against one registered Attempt. */
  readCandidate(request: { readonly executionId: string; readonly input: unknown; readonly signal: AbortSignal }): Promise<RawToolResult>;
  /** Validates and records the terminal Recommendation selection. */
  selectRecommendations(request: { readonly executionId: string; readonly input: unknown; readonly signal: AbortSignal }): Promise<RawToolResult>;
}

/** Creates the execution-scoped Attempt store used by Discovery's built-in tools. */
export function createDailyDiscoveryAttempts(options: {
  readonly observability?: Observability;
} = {}): DailyDiscoveryAttempts {
  const records = new Map<string, AttemptRecord>();

  const requireAttempt = (executionId: string): AttemptRecord | undefined => records.get(executionId);

  return {
    start(request) {
      if (records.has(request.executionId)) {
        throw new Error(`Daily discovery attempt already exists: ${request.executionId}`);
      }
      records.set(request.executionId, {
        targetCount: request.targetCount,
        descriptors: [...request.descriptors],
        sourceRegistry: request.sourceRegistry,
        historicalIdentities: new Set(request.signals.map((signal) => signal.contentIdentity)),
        candidates: createCandidateRegistry({
          onDecision: (decision) => safeRecordEvent(options.observability, {
            type: 'discovery.candidate.decided',
            ...decision,
          }),
        }),
        searchCount: 0,
        readCount: 0,
        successfulSearches: 0,
        failedSearches: 0,
        rawCandidates: 0,
        invalidSelection: false,
        sourceFailures: [],
        sourceBudgets: request.sourceBudgets ?? {},
        sourceUsage: new Map(),
        attemptedSources: new Set(),
        sourceTails: new Map(),
      });
    },

    snapshot(executionId) {
      const attempt = requireAttempt(executionId);
      if (!attempt) return undefined;
      return {
        candidates: attempt.candidates,
        ...(attempt.selected ? { selected: attempt.selected } : {}),
        successfulSearches: attempt.successfulSearches,
        failedSearches: attempt.failedSearches,
        rawCandidates: attempt.rawCandidates,
        invalidSelection: attempt.invalidSelection,
        sourceFailures: [...attempt.sourceFailures],
      };
    },

    dispose(executionId) {
      const attempt = records.get(executionId);
      attempt?.candidates.dispose();
      records.delete(executionId);
    },

    async searchContent(request) {
      const attempt = requireAttempt(request.executionId);
      if (!attempt) return toolError('attempt_not_found', 'Daily discovery attempt was not found.');
      if (attempt.selected) return toolError('selection_frozen', 'Recommendations have already been selected.');
      if (attempt.searchCount >= MAX_SEARCH_CALLS) return toolError('search_budget_exhausted', 'The 12-search budget is exhausted.');
      if (attempt.candidates.list().length >= MAX_CANDIDATES) return toolError('candidate_budget_exhausted', 'The 200-candidate budget is exhausted.');
      const parsed = parseSearchArguments(request.input);
      if (!parsed.ok) return toolError('invalid_search_request', parsed.message);
      if (!attempt.descriptors.some((descriptor) => descriptor.id === parsed.sourceId)) {
        return toolError('source_not_enabled', `Source ${parsed.sourceId} is not enabled for this execution.`);
      }
      let source;
      try {
        source = attempt.sourceRegistry.resolve(parsed.sourceId, parsed.mode);
      } catch (error) {
        return toolError('invalid_search_request', error instanceof Error ? error.message : 'Invalid source.');
      }
      const budget = attempt.sourceBudgets[parsed.sourceId];
      const usage = attempt.sourceUsage.get(parsed.sourceId) ?? { searchCalls: 0, resultCount: 0 };
      if (budget && (usage.searchCalls >= budget.maxSearchCalls || usage.resultCount >= budget.maxResultsPerAttempt)) {
        return toolError('source_budget_exhausted', `Source ${parsed.sourceId} budget is exhausted.`);
      }
      const effectiveLimit = budget
        ? Math.min(parsed.limit, budget.maxResultsPerSearch, budget.maxResultsPerAttempt - usage.resultCount)
        : parsed.limit;
      if (effectiveLimit < 1) return toolError('source_budget_exhausted', `Source ${parsed.sourceId} budget is exhausted.`);
      attempt.searchCount += 1;
      attempt.attemptedSources.add(parsed.sourceId);
      if (budget) {
        usage.searchCalls += 1;
        attempt.sourceUsage.set(parsed.sourceId, usage);
      }
      const correlation = { executionId: request.executionId, sourceId: parsed.sourceId };
      return observeOperation(options.observability, 'source.search', correlation, async () => {
        safeRecordContent(options.observability, 'source.request', {
          query: parsed.query,
          mode: parsed.mode,
          limit: effectiveLimit,
        }, correlation);
        const result = await withSourceLock(attempt, parsed.sourceId, () => source.search({
          ...parsed,
          limit: effectiveLimit,
          signal: request.signal,
          onProviderResponse: (response) => safeRecordContent(
            options.observability,
            'source.provider_response',
            response,
            correlation,
          ),
        }));
        safeRecordContent(options.observability, 'source.result', result, correlation);
        if (result.status === 'failed') {
          attempt.failedSearches += 1;
          attempt.sourceFailures.push({ sourceId: parsed.sourceId, failure: result.failure });
          return toolError(result.failure.code, result.failure.message, { failure: result.failure });
        }
        attempt.successfulSearches += 1;
        const resultItems = result.items.slice(0, effectiveLimit);
        if (budget) usage.resultCount += resultItems.length;
        attempt.rawCandidates += resultItems.length;
        const available = Math.max(0, MAX_CANDIDATES - attempt.candidates.list().length);
        const inserted = attempt.candidates.add(resultItems, {
          reject: (content) => candidateRejectionReason(
            content,
            source.descriptor.id,
            attempt.historicalIdentities,
          ),
          limit: available,
          limitReasonCode: 'candidate_budget_exhausted',
        });
        safeRecordContent(
          options.observability,
          'discovery.candidates',
          attempt.candidates.list(),
          correlation,
        );
        return toolSuccess({
          status: 'success',
          candidates: inserted.map(candidateSummary),
          resultCount: resultItems.length,
          admittedCount: inserted.length,
          candidateCount: attempt.candidates.list().length,
        });
      });
    },

    async readCandidate(request) {
      const attempt = requireAttempt(request.executionId);
      if (!attempt) return toolError('attempt_not_found', 'Daily discovery attempt was not found.');
      if (attempt.selected) return toolError('selection_frozen', 'Recommendations have already been selected.');
      if (attempt.readCount >= MAX_READ_CALLS) return toolError('read_budget_exhausted', 'The 40-read budget is exhausted.');
      const candidateId = recordString(request.input, 'candidateId');
      const candidate = candidateId ? attempt.candidates.get(candidateId) : undefined;
      if (!candidate) return toolError('candidate_not_found', 'Candidate was not found in this execution.');
      const source = attempt.sourceRegistry.get(candidate.sourceId);
      if (!source?.read) return toolError('read_unavailable', 'This source does not support candidate reading.');
      attempt.readCount += 1;
      const correlation = {
        executionId: request.executionId,
        sourceId: candidate.sourceId,
        candidateId: candidate.candidateId,
      };
      return observeOperation(options.observability, 'source.read', correlation, async () => {
        safeRecordContent(options.observability, 'source.request', {
          sourceContentId: candidate.sourceContentId,
          url: candidate.canonicalUrl,
        }, correlation);
        const result = await source.read!({
          sourceContentId: candidate.sourceContentId,
          url: candidate.canonicalUrl,
          signal: request.signal,
          onProviderResponse: (response) => safeRecordContent(
            options.observability,
            'source.provider_response',
            response,
            correlation,
          ),
        });
        safeRecordContent(options.observability, 'source.result', result, correlation);
        if (result.status === 'failed') {
          return toolError(result.failure.code, result.failure.message, { failure: result.failure });
        }
        try {
          const updated = attempt.candidates.attachDetail(candidate.candidateId, result.detail);
          return toolSuccess({ status: 'success', candidate: candidateSummary(updated), detail: result.detail });
        } catch (error) {
          return toolError('invalid_candidate_detail', error instanceof Error ? error.message : 'Candidate detail was invalid.');
        }
      });
    },

    async selectRecommendations(request) {
      if (request.signal.aborted) return toolError('tool_cancelled', 'Selection was cancelled.');
      const attempt = requireAttempt(request.executionId);
      if (!attempt) return toolError('attempt_not_found', 'Daily discovery attempt was not found.');
      if (attempt.selected) return toolError('selection_frozen', 'The first valid selection is already frozen.');
      const missingSources = attempt.descriptors
        .map((descriptor) => descriptor.id)
        .filter((sourceId) => !attempt.attemptedSources.has(sourceId));
      if (missingSources.length > 0) {
        return toolError(
          'source_coverage_incomplete',
          `Search every available source before selection. Missing: ${missingSources.join(', ')}.`,
          { sourceIds: missingSources },
        );
      }
      const correlation = { executionId: request.executionId };
      return observeOperation(options.observability, 'discovery.selection', correlation, async () => {
        safeRecordContent(
          options.observability,
          'discovery.candidates',
          attempt.candidates.list(),
          correlation,
        );
        safeRecordContent(options.observability, 'discovery.selection', request.input, correlation);
        const parsed = parseSelection(request.input, attempt.targetCount, attempt.candidates);
        if (!parsed.ok) {
          attempt.invalidSelection = true;
          return toolError('selection_invalid', parsed.message);
        }
        attempt.selected = parsed.items;
        return toolSuccess({ status: 'selected', count: parsed.items.length });
      });
    },
  };
}

function candidateRejectionReason(
  content: SourceContent,
  sourceId: string,
  historicalIdentities: ReadonlySet<string>,
): string | undefined {
  if (content.sourceId !== sourceId) return 'source_identity_mismatch';
  if (historicalIdentities.has(discoveryContentIdentity(content))) return 'already_recommended';
  if (content.contentType === 'news' && !content.publishedAt) return 'news_timestamp_missing';
  return undefined;
}

async function observeOperation(
  observability: Observability | undefined,
  name: 'source.search' | 'source.read' | 'discovery.selection',
  correlation: TraceCorrelation,
  operation: () => Promise<RawToolResult>,
): Promise<RawToolResult> {
  let operationPromise: Promise<RawToolResult> | undefined;
  const runOnce = () => {
    operationPromise ??= operation();
    return operationPromise;
  };
  if (!observability) return runOnce();
  try {
    return await observability.withSpan({
      name,
      correlation,
      classifyResult: classifyToolResult,
    }, runOnce);
  } catch {
    return runOnce();
  }
}

function classifyToolResult(result: RawToolResult): OperationCompletion {
  if (!result.isError) return { outcome: { status: 'ok' } };
  const code = recordString(result.content, 'code') ?? 'discovery_operation_failed';
  const message = recordString(result.content, 'message') ?? 'Discovery operation failed.';
  return { outcome: { status: 'error', code, message } };
}

function safeRecordContent(
  observability: Observability | undefined,
  kind: 'source.request' | 'source.provider_response' | 'source.result'
    | 'discovery.candidates' | 'discovery.selection',
  value: unknown,
  correlation: TraceCorrelation,
): void {
  try {
    observability?.recordContent({ kind, value, correlation });
  } catch {
    // Discovery execution remains authoritative when diagnostics are unavailable.
  }
}

function safeRecordEvent(observability: Observability | undefined, event: TraceEvent): void {
  try {
    observability?.recordEvent(event);
  } catch {
    // Candidate admission remains authoritative when diagnostics are unavailable.
  }
}

function parseSearchArguments(value: unknown):
  | { readonly ok: true; readonly sourceId: string; readonly query: string; readonly mode: SourceSearchMode; readonly limit: number }
  | { readonly ok: false; readonly message: string } {
  const sourceId = recordString(value, 'sourceId');
  const query = recordString(value, 'query');
  const mode = recordString(value, 'mode');
  const limit = recordNumber(value, 'limit');
  if (!sourceId || !query || query.length > 200 || (mode !== 'relevance' && mode !== 'recent')
    || !Number.isInteger(limit) || limit! < 1 || limit! > 20) {
    return { ok: false, message: 'Search requires an enabled source, a 1..200 character query, a supported mode and limit 1..20.' };
  }
  return { ok: true, sourceId, query, mode, limit: limit! };
}

function parseSelection(
  value: unknown,
  targetCount: number,
  candidates: ReturnType<typeof createCandidateRegistry>,
): { readonly ok: true; readonly items: readonly { candidateId: string; recommendationReason: string }[] }
  | { readonly ok: false; readonly message: string } {
  const items = isRecord(value) && Array.isArray(value.items) ? value.items : undefined;
  if (!items || items.length === 0 || items.length > targetCount) {
    return { ok: false, message: `Selection must contain 1..${targetCount} candidates.` };
  }
  const parsed: Array<{ candidateId: string; recommendationReason: string }> = [];
  const seen = new Set<string>();
  for (const item of items) {
    const candidateId = recordString(item, 'candidateId');
    const recommendationReason = recordString(item, 'recommendationReason');
    if (!candidateId || !recommendationReason || recommendationReason.length > 1_000
      || seen.has(candidateId) || !candidates.get(candidateId)) {
      return { ok: false, message: 'Selection contains an unknown, duplicate or invalid candidate.' };
    }
    seen.add(candidateId);
    parsed.push({ candidateId, recommendationReason });
  }
  return { ok: true, items: parsed };
}

function candidateSummary(candidate: DiscoveryCandidate) {
  return {
    candidateId: candidate.candidateId,
    sourceName: candidate.sourceName,
    canonicalUrl: candidate.canonicalUrl,
    contentType: candidate.contentType,
    title: candidate.title,
    ...(candidate.author ? { author: candidate.author } : {}),
    ...(candidate.publishedAt ? { publishedAt: candidate.publishedAt } : {}),
    ...(candidate.description ? { description: candidate.description } : {}),
  };
}

function toolSuccess(value: unknown): RawToolResult {
  return { outputKind: 'json', content: value };
}

function toolError(code: string, message: string, extra: Record<string, unknown> = {}): RawToolResult {
  return { outputKind: 'json', content: { status: 'failed', code, message, ...extra }, isError: true };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function recordString(value: unknown, key: string): string | undefined {
  if (!isRecord(value) || typeof value[key] !== 'string') return undefined;
  const result = value[key].trim();
  return result || undefined;
}

function recordNumber(value: unknown, key: string): number | undefined {
  return isRecord(value) && typeof value[key] === 'number' ? value[key] : undefined;
}

async function withSourceLock<T>(
  attempt: AttemptRecord,
  sourceId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = attempt.sourceTails.get(sourceId) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.catch(() => undefined).then(() => gate);
  attempt.sourceTails.set(sourceId, tail);
  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
    if (attempt.sourceTails.get(sourceId) === tail) attempt.sourceTails.delete(sourceId);
  }
}
