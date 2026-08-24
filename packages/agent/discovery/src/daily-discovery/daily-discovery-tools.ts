/*
 * Defines the execution-bound Tool Set for one daily discovery run. The
 * concrete search/read/selection behavior stays here while @megumi/tools owns
 * registration, input validation, routing, execution and lifecycle.
 */
import { Type } from '@megumi/ai';
import type { JsonSchemaObject, RawToolResult, ToolSet } from '@megumi/tools';
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

export interface DailyDiscoveryToolState {
  readonly candidates: ReturnType<typeof createCandidateRegistry>;
  readonly selected?: readonly { readonly candidateId: string; readonly recommendationReason: string }[];
  readonly successfulSearches: number;
  readonly failedSearches: number;
  readonly rawCandidates: number;
  readonly invalidSelection: boolean;
  readonly sourceFailures: readonly { readonly sourceId: string; readonly failure: SourceFailure }[];
}

export interface DailyDiscoveryTools {
  readonly toolSet: ToolSet;
  snapshot(): DailyDiscoveryToolState;
  dispose(): void;
}

export function createDailyDiscoveryTools(input: {
  readonly targetCount: number;
  readonly descriptors: readonly SourceDescriptor[];
  readonly signals: readonly RecommendationSelectionSignal[];
  readonly sourceRegistry: SourceRegistry;
}): DailyDiscoveryTools {
  const candidates = createCandidateRegistry();
  const historicalIdentities = new Set(input.signals.map((signal) => signal.contentIdentity));
  let selected: readonly { candidateId: string; recommendationReason: string }[] | undefined;
  let searchCount = 0;
  let readCount = 0;
  let successfulSearches = 0;
  let failedSearches = 0;
  let rawCandidates = 0;
  let invalidSelection = false;
  const sourceFailures: Array<{ readonly sourceId: string; readonly failure: SourceFailure }> = [];

  const toolSet: ToolSet = {
    source: {
      sourceId: 'megumi.daily-discovery',
      sourceKind: 'project_local',
      namespace: 'daily-discovery',
      displayName: 'Daily Discovery',
      configured: true,
      enabled: true,
      availabilityStatus: 'available',
    },
    tools: [
      {
        registrationId: 'daily-discovery:search_content',
        definition: {
          name: 'search_content',
          description: 'Search one enabled content source with one explicit query.',
          parameters: Type.Object({
            sourceId: Type.String(), query: Type.String(),
            mode: Type.Union([Type.Literal('relevance'), Type.Literal('recent')]),
            limit: Type.Integer({ minimum: 1, maximum: 20 }),
          }) as unknown as JsonSchemaObject,
        },
        availability: { status: 'available' },
        executionMode: 'serial',
        handler: {
          toolName: 'search_content',
          operations: () => [],
          execute: async (invocation, options) => {
            if (selected) return toolError('selection_frozen', 'Recommendations have already been selected.');
            if (searchCount >= MAX_SEARCH_CALLS) return toolError('search_budget_exhausted', 'The 12-search budget is exhausted.');
            if (candidates.list().length >= MAX_CANDIDATES) return toolError('candidate_budget_exhausted', 'The 200-candidate budget is exhausted.');
            const parsed = parseSearchArguments(invocation.input);
            if (!parsed.ok) return toolError('invalid_search_request', parsed.message);
            let source;
            try {
              source = input.sourceRegistry.resolve(parsed.sourceId, parsed.mode);
            } catch (error) {
              return toolError('invalid_search_request', error instanceof Error ? error.message : 'Invalid source.');
            }
            if (!input.descriptors.some((descriptor) => descriptor.id === parsed.sourceId)) {
              return toolError('source_not_enabled', `Source ${parsed.sourceId} is not enabled for this execution.`);
            }
            searchCount += 1;
            const result = await source.search({ ...parsed, signal: options?.signal ?? NEVER_ABORTED_SIGNAL });
            if (result.status === 'failed') {
              failedSearches += 1;
              sourceFailures.push({ sourceId: parsed.sourceId, failure: result.failure });
              return toolError(result.failure.code, result.failure.message, { failure: result.failure });
            }
            successfulSearches += 1;
            rawCandidates += result.items.length;
            const available = Math.max(0, MAX_CANDIDATES - candidates.list().length);
            const admitted = result.items
              .filter((content) => {
                if (content.sourceId !== source.descriptor.id) return false;
                if (historicalIdentities.has(discoveryContentIdentity(content))) return false;
                return content.contentType !== 'news' || Boolean(content.publishedAt);
              })
              .slice(0, available);
            const inserted = candidates.add(admitted);
            return toolSuccess({
              status: 'success',
              candidates: inserted.map(candidateSummary),
              resultCount: result.items.length,
              admittedCount: inserted.length,
              candidateCount: candidates.list().length,
            });
          },
        },
      },
      {
        registrationId: 'daily-discovery:read_candidate',
        definition: {
          name: 'read_candidate',
          description: 'Read more public content for one admitted candidate.',
          parameters: Type.Object({ candidateId: Type.String() }) as unknown as JsonSchemaObject,
        },
        availability: { status: 'available' },
        executionMode: 'serial',
        handler: {
          toolName: 'read_candidate',
          operations: () => [],
          execute: async (invocation, options) => {
            if (selected) return toolError('selection_frozen', 'Recommendations have already been selected.');
            if (readCount >= MAX_READ_CALLS) return toolError('read_budget_exhausted', 'The 40-read budget is exhausted.');
            const candidateId = recordString(invocation.input, 'candidateId');
            const candidate = candidateId ? candidates.get(candidateId) : undefined;
            if (!candidate) return toolError('candidate_not_found', 'Candidate was not found in this execution.');
            const source = input.sourceRegistry.get(candidate.sourceId);
            if (!source?.read) return toolError('read_unavailable', 'This source does not support candidate reading.');
            readCount += 1;
            const result = await source.read({
              sourceContentId: candidate.sourceContentId,
              url: candidate.canonicalUrl,
              signal: options?.signal ?? NEVER_ABORTED_SIGNAL,
            });
            if (result.status === 'failed') {
              return toolError(result.failure.code, result.failure.message, { failure: result.failure });
            }
            try {
              const updated = candidates.attachDetail(candidate.candidateId, result.detail);
              return toolSuccess({ status: 'success', candidate: candidateSummary(updated), detail: result.detail });
            } catch (error) {
              return toolError('invalid_candidate_detail', error instanceof Error ? error.message : 'Candidate detail was invalid.');
            }
          },
        },
      },
      {
        registrationId: 'daily-discovery:select_recommendations',
        definition: {
          name: 'select_recommendations',
          description: 'Freeze the ordered Recommendation selection for this execution.',
          parameters: Type.Object({
            items: Type.Array(Type.Object({
              candidateId: Type.String(),
              recommendationReason: Type.String(),
            })),
          }) as unknown as JsonSchemaObject,
        },
        availability: { status: 'available' },
        executionMode: 'serial',
        handler: {
          toolName: 'select_recommendations',
          operations: () => [],
          execute: async (invocation) => {
            if (selected) return toolError('selection_frozen', 'The first valid selection is already frozen.');
            const parsed = parseSelection(invocation.input, input.targetCount, candidates);
            if (!parsed.ok) {
              invalidSelection = true;
              return toolError('selection_invalid', parsed.message);
            }
            selected = parsed.items;
            return toolSuccess({ status: 'selected', count: selected.length });
          },
        },
      },
    ],
  };

  return {
    toolSet,
    snapshot: () => ({
      candidates,
      ...(selected ? { selected } : {}),
      successfulSearches,
      failedSearches,
      rawCandidates,
      invalidSelection,
      sourceFailures: [...sourceFailures],
    }),
    dispose: () => candidates.dispose(),
  };
}

const NEVER_ABORTED_SIGNAL = new AbortController().signal;

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
