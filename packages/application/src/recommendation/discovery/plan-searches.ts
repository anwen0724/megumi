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
import { CandidatePoolSchema, type SupplyHealth } from '../candidates/candidate-contracts';
import type { InterestSnapshotEntry } from '../interests/interest-contracts';
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
          limit: z.number().int().positive(),
          queryId: z.string().trim().min(1).optional(),
          query: z.string().trim().min(1).max(200).optional(),
          category: QueryCategorySchema.optional(),
          timeRange: z
            .object({
              from: z.number().int().nonnegative().optional(),
              to: z.number().int().nonnegative().optional(),
            })
            .strict()
            .optional(),
        })
        .strict(),
    ),
  })
  .strict();

const SYSTEM_PROMPT = [
  'You plan searches for one recommendation supply round and reply with one JSON object.',
  'Rules:',
  '- Use only the listed interests, the listed stored queries, and the listed sources.',
  '- Reuse a stored query by returning its queryId; propose a new expression only when no stored query covers the direction.',
  '- A new expression needs a category: core, entity, technical, exploratory, or trend.',
  '- Order items by priority so the largest gaps are addressed first.',
  '- Respect the per-search result limit you are given.',
  '- Reply with JSON only: {"items":[{"interestId":"...","pools":["daily"],"source":"zhihu","priority":1,"limit":10}]}.',
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

export interface PlanSearchesInput {
  readonly interests: readonly InterestSnapshotEntry[];
  readonly poolHealth: readonly SupplyHealth[];
  readonly recentSearches: readonly SearchRecord[];
  /** Enabled source ids the plan may use. */
  readonly sources: readonly string[];
  readonly model: Model<Api>;
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
  readonly maxResultsPerSearch: number;
  /** Upper bound on how many items the round can still pay for. */
  readonly maxItems: number;
  readonly signal?: AbortSignal;
}

export type PlanSearchesOutcome =
  | {
      status: 'planned';
      items: readonly PlannedSearch[];
      record: TextModelCallRecord;
      droppedItems: number;
    }
  | { status: 'failed'; code: string; message: string };

/**
 * Whether a round has anything worth planning. Capacity above the minimum with
 * no pending request and no interest change must not spend a planning call.
 */
export function needsSearchPlanning(input: {
  readonly poolHealth: readonly SupplyHealth[];
  readonly hasPendingRequest: boolean;
  readonly interestsChanged: boolean;
}): boolean {
  if (input.hasPendingRequest || input.interestsChanged) return true;
  return input.poolHealth.some((health) => health.minimumDeficit > 0);
}

/** Active queries grouped by interest; only these may be reused by id. */
export function listActiveQueries(database: DatabaseConnection): readonly QueryRecord[] {
  return database
    .prepare<QueryRow>({
      sql: `SELECT id, interest_id, query, category, last_used_at
            FROM search_queries WHERE status = 'active' ORDER BY interest_id, created_at, id`,
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
  const sources = new Set(input.sources);
  const queryById = new Map(queries.map((query) => [query.id, query]));

  const items: PlannedSearch[] = [];
  let droppedItems = 0;
  for (const item of [...call.result.items].sort((left, right) => left.priority - right.priority)) {
    if (items.length >= input.maxItems) {
      droppedItems += 1;
      continue;
    }
    if (!interestIds.has(item.interestId) || !sources.has(item.source)) {
      droppedItems += 1;
      continue;
    }
    if (item.queryId !== undefined && !queryById.has(item.queryId)) {
      droppedItems += 1;
      continue;
    }
    if (item.queryId === undefined && item.query === undefined) {
      droppedItems += 1;
      continue;
    }
    items.push({
      interestId: item.interestId,
      source: item.source,
      limit: Math.min(item.limit, input.maxResultsPerSearch),
      ...(item.queryId !== undefined ? { queryId: item.queryId } : {}),
      ...(item.query !== undefined ? { query: item.query } : {}),
      ...(item.category !== undefined ? { category: item.category } : {}),
      ...(item.timeRange !== undefined ? { timeRange: item.timeRange } : {}),
    });
  }

  return { status: 'planned', items, record: call.record, droppedItems };
}

function buildPrompt(input: PlanSearchesInput, queries: readonly QueryRecord[]): string {
  const interests = input.interests.map((interest) => `- ${interest.id}: ${interest.text}`);
  const storedQueries = queries.map(
    (query) => `- ${query.id} (${query.interestId ?? 'unassigned'}, ${query.category}): ${query.query}`,
  );
  const health = input.poolHealth.map(
    (entry) =>
      `- ${entry.pool}${entry.interestId ? ` / ${entry.interestId}` : ''}: active=${entry.activeCandidates} minimumDeficit=${entry.minimumDeficit} targetDeficit=${entry.targetDeficit} level=${entry.supplyLevel}`,
  );
  const history = input.recentSearches
    .slice(0, 20)
    .map(
      (record) =>
        `- ${record.source} ${record.outcome} results=${record.resultCount ?? 'n/a'} newItems=${record.newItemCount ?? 'n/a'} query=${record.scope.query}`,
    );

  return [
    'Interests:',
    ...(interests.length > 0 ? interests : ['- (none)']),
    '',
    'Stored queries:',
    ...(storedQueries.length > 0 ? storedQueries : ['- (none)']),
    '',
    'Supply health:',
    ...(health.length > 0 ? health : ['- (none)']),
    '',
    'Recent searches:',
    ...(history.length > 0 ? history : ['- (none)']),
    '',
    `Enabled sources: ${input.sources.join(', ') || '(none)'}`,
    `Maximum results per search: ${input.maxResultsPerSearch}`,
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
