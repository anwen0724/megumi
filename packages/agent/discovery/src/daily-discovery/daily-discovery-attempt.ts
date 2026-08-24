/* Owns execution-scoped candidate, search-budget, and selection facts used by discovery built-in tools. */
import type { RawToolResult } from '@megumi/tools';
import {
  createCandidateRegistry,
  discoveryContentIdentity,
  type DiscoveryCandidate,
} from './candidate-registry';
import type { RecommendationSelectionSignal } from '../persistence/discovery-repository';
import type { SourceDescriptor, SourceFailure, SourceSearchMode } from '../sources/discovery-source';
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
  start(request: {
    readonly executionId: string;
    readonly targetCount: number;
    readonly descriptors: readonly SourceDescriptor[];
    readonly signals: readonly RecommendationSelectionSignal[];
    readonly sourceRegistry: SourceRegistry;
    readonly sourceBudgets?: Readonly<Record<string, SourceAttemptBudget>>;
  }): void;
  snapshot(executionId: string): DailyDiscoveryAttemptState | undefined;
  dispose(executionId: string): void;
  searchContent(request: { readonly executionId: string; readonly input: unknown; readonly signal: AbortSignal }): Promise<RawToolResult>;
  readCandidate(request: { readonly executionId: string; readonly input: unknown; readonly signal: AbortSignal }): Promise<RawToolResult>;
  selectRecommendations(request: { readonly executionId: string; readonly input: unknown; readonly signal: AbortSignal }): Promise<RawToolResult>;
}

export function createDailyDiscoveryAttempts(): DailyDiscoveryAttempts {
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
        candidates: createCandidateRegistry(),
        searchCount: 0,
        readCount: 0,
        successfulSearches: 0,
        failedSearches: 0,
        rawCandidates: 0,
        invalidSelection: false,
        sourceFailures: [],
        sourceBudgets: request.sourceBudgets ?? {},
        sourceUsage: new Map(),
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
      if (budget) {
        usage.searchCalls += 1;
        attempt.sourceUsage.set(parsed.sourceId, usage);
      }
      const result = await source.search({ ...parsed, limit: effectiveLimit, signal: request.signal });
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
      const admitted = resultItems
        .filter((content) => (
          content.sourceId === source.descriptor.id
          && !attempt.historicalIdentities.has(discoveryContentIdentity(content))
          && (content.contentType !== 'news' || Boolean(content.publishedAt))
        ))
        .slice(0, available);
      const inserted = attempt.candidates.add(admitted);
      return toolSuccess({
        status: 'success',
        candidates: inserted.map(candidateSummary),
        resultCount: resultItems.length,
        admittedCount: inserted.length,
        candidateCount: attempt.candidates.list().length,
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
      const result = await source.read({
        sourceContentId: candidate.sourceContentId,
        url: candidate.canonicalUrl,
        signal: request.signal,
      });
      if (result.status === 'failed') {
        return toolError(result.failure.code, result.failure.message, { failure: result.failure });
      }
      try {
        const updated = attempt.candidates.attachDetail(candidate.candidateId, result.detail);
        return toolSuccess({ status: 'success', candidate: candidateSummary(updated), detail: result.detail });
      } catch (error) {
        return toolError('invalid_candidate_detail', error instanceof Error ? error.message : 'Candidate detail was invalid.');
      }
    },

    async selectRecommendations(request) {
      if (request.signal.aborted) return toolError('tool_cancelled', 'Selection was cancelled.');
      const attempt = requireAttempt(request.executionId);
      if (!attempt) return toolError('attempt_not_found', 'Daily discovery attempt was not found.');
      if (attempt.selected) return toolError('selection_frozen', 'The first valid selection is already frozen.');
      const parsed = parseSelection(request.input, attempt.targetCount, attempt.candidates);
      if (!parsed.ok) {
        attempt.invalidSelection = true;
        return toolError('selection_invalid', parsed.message);
      }
      attempt.selected = parsed.items;
      return toolSuccess({ status: 'selected', count: parsed.items.length });
    },
  };
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
