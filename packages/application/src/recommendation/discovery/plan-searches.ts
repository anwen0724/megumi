/*
 * Plans one round of searches. The text model proposes queries, sources, and
 * order inside the given constraints; the program validates every item against
 * the current interests, the query library, the enabled sources, and the
 * remaining budget before anything runs.
 */
import { estimateTextTokens } from '@megumi/ai/utils/estimate';
import type { Api, Model } from '@megumi/ai';
import { z } from 'zod';
import type { DatabaseConnection, DatabaseRow } from '../../storage/index';
import type { Observability } from '../../observability/index';
import { callTextModel, type TextModelCallRecord, type TextModelClient } from '../call-text-model';
import { CandidatePoolSchema, type CandidatePool, type SupplyHealth } from '../candidates/candidate-contracts';
import type { InterestSnapshotEntry } from '../interests/interest-contracts';
import type { SourceDescriptor } from '../sources/source-connector';
import type { PlannedSearch } from './execute-searches';
import type { SearchRecord } from './search-storage';

/** Query library categories; `exploratory` covers directions existing queries miss. */
export const QueryCategorySchema = z.enum(['core', 'entity', 'technical', 'exploratory', 'trend']);
export type QueryCategory = z.infer<typeof QueryCategorySchema>;

const SearchPlanSchema = z
  .object({
    items: z.array(
      z
        .object({
          interestId: z.string().trim().min(1),
          pools: z.array(CandidatePoolSchema).min(1),
          source: z.string().trim().min(1),
          priority: z.number(),
          queryId: z.string().trim().min(1).optional(),
          query: z.string().trim().min(1).max(200).optional(),
          category: QueryCategorySchema.optional(),
        })
        .strict(),
    ),
  })
  .strict();

const SYSTEM_PROMPT = [
  'You plan searches for one recommendation supply round and reply with one JSON object.',
  'Reply with JSON only, shaped exactly like this:',
  '{"items":[{"interestId":"...","pools":["daily"],"source":"zhihu","priority":1,"queryId":"..."}]}',
  'Every item has: interestId, pools (one or both of "daily", "long_term"), source, priority (a number; lower runs first).',
  'Every item is either a reuse or a new expression, never both:',
  '- Reuse a stored query by adding "queryId", copied verbatim from the stored queries.',
  '- Propose a new expression by adding "query" (the search text) and "category" instead of "queryId".',
  'category is one of: core, entity, technical, exploratory, trend.',
  'Do not add any other key. Never invent, shorten, translate, or reformat an identifier.',
  'Use only the listed interests, the listed stored queries, and the listed sources.',
  'Do not choose a time range or a result count: the program fills both from the source capabilities.',
].join('\n');

export interface QueryRecord {
  readonly id: string;
  readonly interestId: string | null;
  readonly query: string;
  readonly category: QueryCategory;
  readonly lastUsedAt?: number;
}

export interface PlanSearchesDependencies {
  readonly database: DatabaseConnection;
  readonly client: TextModelClient;
  readonly observability?: Observability;
}

/** A generation request that is still short, as the round sees it now. */
export interface PendingGap {
  readonly pool: CandidatePool;
  readonly interestId?: string;
  readonly missing: number;
}

export interface PlanSearchesInput {
  readonly interests: readonly InterestSnapshotEntry[];
  readonly poolHealth: readonly SupplyHealth[];
  /** Generation requests still waiting; they outrank background targets. */
  readonly pendingGaps: readonly PendingGap[];
  readonly recentSearches: readonly SearchRecord[];
  /** Enabled sources with a connector, described as the planner should see them. */
  readonly sources: readonly SourceDescriptor[];
  readonly model: Model<Api>;
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
  readonly maxResultsPerSearch: number;
  /** Upper bound on how many items the round can still pay for. */
  readonly maxItems: number;
  /** Round time, so the program can fill the daily window itself. */
  readonly now: number;
  readonly freshnessDays: number;
  readonly signal?: AbortSignal;
}

export type PlanSearchesOutcome =
  | {
      status: 'planned';
      items: readonly PlannedSearch[];
      record: TextModelCallRecord;
      /** Items the round could not pay for inside `maxItems`. */
      droppedItems: number;
      /** Items refused because a reference was unknown or no expression was given. */
      invalidItems: number;
    }
  | { status: 'failed'; code: string; message: string };

/**
 * Whether a round has anything worth planning. Capacity above every minimum with
 * no waiting gap must not spend a planning call; an interest change shows up as
 * a minimum gap once its cleared matches are re-judged, so it needs no trigger
 * of its own.
 */
export function needsSearchPlanning(input: {
  readonly poolHealth: readonly SupplyHealth[];
  readonly hasPendingRequest: boolean;
}): boolean {
  if (input.hasPendingRequest) return true;
  return input.poolHealth.some((health) => health.minimumDeficit > 0);
}

/** Active queries grouped by interest; only these may be reused by id. */
export function listActiveQueries(database: DatabaseConnection): readonly QueryRecord[] {
  return database
    .prepare<QueryRow>({
      sql: `SELECT q.id, q.interest_id, q.query, q.category, q.last_used_at
            FROM search_queries q JOIN interests i ON i.id = q.interest_id AND i.revision = q.interest_revision AND i.enabled = 1
            WHERE q.status = 'active' ORDER BY q.interest_id, q.created_at, q.id`,
    })
    .all()
    .flatMap((row) => {
      const category = QueryCategorySchema.safeParse(row.category);
      return category.success
        ? [
            {
              id: row.id,
              interestId: row.interest_id,
              query: row.query,
              category: category.data,
              ...(row.last_used_at !== null ? { lastUsedAt: row.last_used_at } : {}),
            },
          ]
        : [];
    });
}

/**
 * Asks the model for a plan and keeps only the items the program can still run.
 * A dropped item never becomes a silent success: the count is reported back.
 */
export async function planSearches(
  dependencies: PlanSearchesDependencies,
  input: PlanSearchesInput,
): Promise<PlanSearchesOutcome> {
  const queries = listActiveQueries(dependencies.database);
  const prompt = buildPrompt(input, queries);
  if (estimateTextTokens(`${SYSTEM_PROMPT}\n${prompt}`) > input.maxInputTokens - input.maxOutputTokens) {
    return { status: 'failed', code: 'CONTEXT_OVERFLOW', message: 'Planning input exceeds the configured model input.' };
  }

  const call = await callTextModel(
    dependencies.client,
    {
      model: input.model,
      systemPrompt: SYSTEM_PROMPT,
      prompt,
      schema: SearchPlanSchema,
      maxOutputTokens: input.maxOutputTokens,
      ...(input.signal ? { signal: input.signal } : {}),
    },
    dependencies.observability ? { observability: dependencies.observability } : {},
  );
  if (call.status === 'failed') {
    return { status: 'failed', code: call.code, message: call.message };
  }

  const interestIds = new Set(input.interests.map((interest) => interest.id));
  const sources = new Map(
    input.sources.map((source) => [source.id, source] as const),
  );
  const queryById = new Map(queries.map((query) => [query.id, query]));

  const items: PlannedSearch[] = [];
  let droppedItems = 0;
  let invalidItems = 0;
  for (const item of [...call.result.items].sort((left, right) => left.priority - right.priority)) {
    if (items.length >= input.maxItems) {
      droppedItems += 1;
      continue;
    }
    if (!interestIds.has(item.interestId) || !sources.has(item.source)) {
      invalidItems += 1;
      continue;
    }
    const descriptor = sources.get(item.source);
    if (!descriptor) {
      invalidItems += 1;
      continue;
    }
    if (item.queryId !== undefined && !queryById.has(item.queryId)) {
      invalidItems += 1;
      continue;
    }
    if (item.queryId === undefined && item.query === undefined) {
      invalidItems += 1;
      continue;
    }
    items.push({
      interestId: item.interestId,
      pools: item.pools,
      source: item.source,
      // Time range and result count come from the source declaration, never the
      // model: a daily item asks for the recent window, a long-term-only item
      // asks for everything, and a source without time filtering gets none.
      limit: Math.min(descriptor.maxResultsPerSearch, input.maxResultsPerSearch),
      ...(item.queryId !== undefined ? { queryId: item.queryId } : {}),
      ...(item.query !== undefined ? { query: item.query } : {}),
      ...(item.category !== undefined ? { category: item.category } : {}),
      ...(windowFor(item.pools, descriptor, input) ?? {}),
    });
  }

  return { status: 'planned', items, record: call.record, droppedItems, invalidItems };
}

/** The source-facing window a plan item asks for, or nothing when it has none. */
function windowFor(
  pools: readonly CandidatePool[],
  descriptor: SourceDescriptor,
  input: PlanSearchesInput,
): { readonly timeRange: { readonly from: number; readonly to: number } } | undefined {
  if (!descriptor.supportsTimeRange || !pools.includes('daily')) return undefined;
  return {
    timeRange: {
      from: input.now - input.freshnessDays * 24 * 60 * 60 * 1_000,
      to: input.now,
    },
  };
}

function buildPrompt(input: PlanSearchesInput, queries: readonly QueryRecord[]): string {
  // Identifiers are emitted as JSON so an id that contains the display
  // separator can still be copied back verbatim.
  const interests = input.interests.map((interest) =>
    JSON.stringify({ interestId: interest.id, text: interest.text }),
  );
  const storedQueries = queries.map((query) =>
    JSON.stringify({
      queryId: query.id,
      interestId: query.interestId,
      category: query.category,
      query: query.query,
    }),
  );
  const health = input.poolHealth.map(
    (entry) =>
      `- ${entry.pool}${entry.interestId ? ` / ${entry.interestId}` : ''}: active=${entry.activeCandidates} minimumDeficit=${entry.minimumDeficit} targetDeficit=${entry.targetDeficit} level=${entry.supplyLevel}`,
  );
  // A waiting generation request outranks the background targets.
  const pending = input.pendingGaps.map(
    (gap) => `- ${gap.pool}${gap.interestId ? ` / ${gap.interestId}` : ''}: missing=${gap.missing}`,
  );
  const sources = input.sources.map(
    (source) =>
      `- ${JSON.stringify({
        source: source.id,
        description: source.description,
        maxResultsPerSearch: source.maxResultsPerSearch,
        supportsTimeRange: source.supportsTimeRange,
        material: source.material,
      })}`,
  );
  const history = input.recentSearches
    .slice(0, 20)
    .map(
      (record) =>
        `- ${record.source} ${record.outcome} results=${record.resultCount ?? 'n/a'} newItems=${record.newItemCount ?? 'n/a'} query=${record.scope.query}`,
    );

  return [
    'Interests (copy interestId verbatim):',
    ...(interests.length > 0 ? interests.map((line) => `- ${line}`) : ['- (none)']),
    '',
    'Stored queries (copy queryId verbatim):',
    ...(storedQueries.length > 0 ? storedQueries.map((line) => `- ${line}`) : ['- (none)']),
    '',
    'Supply health:',
    ...(health.length > 0 ? health : ['- (none)']),
    '',
    'Waiting generation demand (highest priority):',
    ...(pending.length > 0 ? pending : ['- (none)']),
    '',
    'Recent searches:',
    ...(history.length > 0 ? history : ['- (none)']),
    '',
    'Enabled sources:',
    ...(sources.length > 0 ? sources : ['- (none)']),
    '',
    `Current time (UTC milliseconds): ${input.now}`,
    `Daily recent window (days): ${input.freshnessDays}`,
    `Maximum items this round: ${input.maxItems}`,
  ].join('\n');
}

interface QueryRow extends DatabaseRow {
  readonly id: string;
  readonly interest_id: string | null;
  readonly query: string;
  readonly category: string;
  readonly last_used_at: number | null;
}
