/*
 * Evaluates one pool against current interests, usage, and time. The same rules
 * produce the read snapshot, the supply health, and the pool relations, so a
 * read never disagrees with what maintenance would decide.
 */
import type { DatabaseConnection, DatabaseRow } from '../../storage/index';
import type { CandidatePoolThresholds } from '../../settings/definitions/discovery';
import {
  CandidateAnalysisSchema,
  type CandidatePool,
  type CandidateSnapshot,
  type CandidateSnapshotItem,
  type InterestCount,
  type SupplyHealth,
} from './candidate-contracts';
import type { CandidateStorage } from './candidate-storage';
import { ContentTypeSchema, LongTermValueSchema, KeyPointSchema } from '../content/content-contracts';
import { z } from 'zod';
import type { InterestSnapshotEntry } from '../interests/interest-contracts';
import {
  CandidateRequirementSchema,
  type CandidateRequirement,
  type UsageSnapshot,
} from '../supply/supply-contracts';

export interface PoolEvaluationDependencies {
  readonly database: DatabaseConnection;
  readonly candidates: CandidateStorage;
}

export interface PoolEvaluationInput {
  readonly pool: CandidatePool;
  /** Enabled interests the caller read; candidates must reference one of them. */
  readonly interests: readonly InterestSnapshotEntry[];
  readonly usage: UsageSnapshot;
  readonly requirement: CandidateRequirement;
  readonly thresholds: CandidatePoolThresholds;
  /** Daily-pool freshness window in days; it fixes each candidate's expiry. */
  readonly freshnessDays: number;
  readonly now: number;
}

export interface PoolEvaluation {
  readonly snapshot: CandidateSnapshot;
  /** Whole-pool health, without an interest id. */
  readonly health: SupplyHealth;
  readonly interestHealth: readonly SupplyHealth[];
}

const PoolRowSchema = z
  .object({
    id: z.string(),
    source: z.string(),
    canonical_url: z.string(),
    title: z.string().nullable(),
    author: z.string().nullable(),
    published_at: z.number().nullable(),
    duplicate_group_id: z.string().nullable(),
    summary: z.string().nullable(),
    key_points: z.string().nullable(),
    topics: z.string().nullable(),
    entities: z.string().nullable(),
    content_type: z.string().nullable(),
    quality_score: z.number().nullable(),
    spam_score: z.number().nullable(),
    long_term_value: z.string().nullable(),
    embedding: z.string().nullable(),
    embedding_model: z.string().nullable(),
  })
  .passthrough();

type PoolRow = z.infer<typeof PoolRowSchema>;

/**
 * Evaluates one pool and returns everything a caller may read: the deduplicated
 * snapshot, whole-pool health, and per-interest health. Reading never writes.
 */
export function evaluatePool(
  dependencies: PoolEvaluationDependencies,
  input: PoolEvaluationInput,
): PoolEvaluation {
  const requirement = CandidateRequirementSchema.parse(input.requirement);
  const excluded = new Set(input.usage.excludedContentIds);
  const interestById = new Map(input.interests.map((interest) => [interest.id, interest]));
  const matchesByContent = readMatches(dependencies.database, input.pool);

  const rows = readPoolRows(dependencies.database, input.pool)
    .filter((row) => qualifies(row, input, excluded, interestById, matchesByContent))
    .flatMap((row) => toItem(row, matchesByContent.get(row.id) ?? []));
  const candidates = deduplicateByGroup(rows);

  const deficits: InterestCount[] = requirement.coverage.map((entry) => ({
    interestId: entry.interestId,
    count: Math.max(0, entry.minimumCount - countFor(candidates, entry.interestId)),
  }));

  return {
    snapshot: {
      pool: input.pool,
      interests: input.interests.map((interest) => ({ ...interest })),
      usageRevision: input.usage.revision,
      evaluatedAt: input.now,
      candidates,
      counts: {
        total: candidates.length,
        byInterest: sumByInterest(candidates, input.interests),
      },
      deficits: {
        total: Math.max(0, requirement.minimumCount - candidates.length),
        byInterest: deficits,
      },
      matchingPending: dependencies.candidates.listContentsMissingMatches({ limit: 1 }).length > 0,
    },
    health: toHealth(input.pool, undefined, candidates, input),
    interestHealth: input.interests.map((interest) =>
      toHealth(input.pool, interest.id, candidates, input),
    ),
  };
}

/** Summary counts for one content once qualification has been decided. */
interface QualifiedRow {
  readonly contentId: string;
  readonly duplicateGroupId?: string;
  readonly publishedAt?: number;
  readonly qualityScore?: number;
  readonly item: CandidateSnapshotItem;
}

function qualifies(
  row: PoolRow,
  input: PoolEvaluationInput,
  excluded: ReadonlySet<string>,
  interestById: ReadonlyMap<string, InterestSnapshotEntry>,
  matchesByContent: ReadonlyMap<string, readonly PoolMatch[]>,
): boolean {
  if (excluded.has(row.id)) return false;

  const matches = (matchesByContent.get(row.id) ?? []).filter((match) =>
    interestById.has(match.interestId),
  );
  if (matches.length === 0) return false;

  if (input.pool === 'daily') {
    if (row.published_at === null || row.published_at > input.now) return false;
    const expiresAt = row.published_at + input.freshnessDays * 24 * 60 * 60 * 1_000;
    if (input.now >= expiresAt) return false;
    return true;
  }
  return row.long_term_value !== null && row.long_term_value !== 'none';
}

/** Keeps one member per duplicate group: the representative, else the smallest id. */
function deduplicateByGroup(rows: readonly QualifiedRow[]): CandidateSnapshotItem[] {
  // A representative carries no group id of its own, so the group key is the
  // representative id for members and the content id for everything else.
  const groups = new Map<string, QualifiedRow[]>();
  for (const row of rows) {
    const key = row.duplicateGroupId ?? row.contentId;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }

  const chosen: QualifiedRow[] = [];
  for (const [groupId, members] of groups) {
    const groupIds = members.map((member) => member.contentId).sort();
    const picked =
      members.find((member) => member.contentId === groupId) ??
      [...members].sort((left, right) => (left.contentId <= right.contentId ? -1 : 1))[0];
    if (picked) {
      chosen.push({ ...picked, item: { ...picked.item, duplicateContentIds: groupIds } });
    }
  }
  return chosen
    .sort((left, right) => (left.contentId <= right.contentId ? -1 : 1))
    .map((row) => row.item);
}

function countFor(candidates: readonly CandidateSnapshotItem[], interestId: string): number {
  return candidates.filter((candidate) =>
    candidate.interestMatches.some((match) => match.interestId === interestId),
  ).length;
}

function sumByInterest(
  candidates: readonly CandidateSnapshotItem[],
  interests: readonly InterestSnapshotEntry[],
): InterestCount[] {
  return interests.map((interest) => ({
    interestId: interest.id,
    count: countFor(candidates, interest.id),
  }));
}

function toHealth(
  pool: CandidatePool,
  interestId: string | undefined,
  candidates: readonly CandidateSnapshotItem[],
  input: PoolEvaluationInput,
): SupplyHealth {
  const scoped =
    interestId === undefined
      ? candidates
      : candidates.filter((candidate) =>
          candidate.interestMatches.some((match) => match.interestId === interestId),
        );
  const active = scoped.length;
  const minimum = interestId === undefined ? input.thresholds.minimumCount : input.thresholds.interestMinimumCount;
  const target = interestId === undefined ? input.thresholds.targetCount : input.thresholds.interestTargetCount;
  const quality = scoped.flatMap((candidate) =>
    candidate.analysis.qualityScore === undefined ? [] : [candidate.analysis.qualityScore],
  );
  const published = scoped.flatMap((candidate) =>
    candidate.publishedAt === undefined ? [] : [candidate.publishedAt],
  );

  return {
    pool,
    ...(interestId === undefined ? {} : { interestId }),
    activeCandidates: active,
    freshCandidates: pool === 'daily' ? active : null,
    avgQuality: quality.length === 0 ? null : quality.reduce((sum, value) => sum + value, 0) / quality.length,
    newestPublishedAt: published.length === 0 ? null : Math.max(...published),
    recentNewItems: 0,
    supplyLevel: active === 0 ? 'empty' : active < minimum ? 'low' : 'healthy',
    minimumDeficit: Math.max(0, minimum - active),
    targetDeficit: Math.max(0, target - active),
  };
}

interface PoolMatch {
  readonly interestId: string;
  readonly relation: 'direct' | 'related';
  readonly basis?: string;
}

function readMatches(
  database: DatabaseConnection,
  pool: CandidatePool,
): Map<string, readonly PoolMatch[]> {
  const rows = database
    .prepare<{ content_id: string; interest_id: string; relation: string; basis: string | null }>({
      sql: `SELECT m.content_id, m.interest_id, m.relation, m.basis
            FROM content_interest_matches m
            JOIN recommendation_candidates rc ON rc.content_id = m.content_id AND rc.pool = ?
            WHERE rc.status = 'active' AND m.relation IN ('direct','related')`,
    })
    .all([pool]);

  const byContent = new Map<string, PoolMatch[]>();
  for (const row of rows) {
    const list = byContent.get(row.content_id) ?? [];
    list.push({
      interestId: row.interest_id,
      relation: row.relation === 'direct' ? 'direct' : 'related',
      ...(row.basis ? { basis: row.basis } : {}),
    });
    byContent.set(row.content_id, list);
  }
  return byContent;
}

function readPoolRows(database: DatabaseConnection, pool: CandidatePool): readonly PoolRow[] {
  return database
    .prepare<DatabaseRow>({
      sql: `SELECT c.id, c.source, c.canonical_url, c.title, c.author, c.published_at,
                   c.duplicate_group_id, ca.summary, ca.key_points, ca.topics, ca.entities,
                   ca.content_type, ca.quality_score, ca.spam_score, ca.long_term_value,
                   ca.embedding, ca.embedding_model
            FROM contents c
            JOIN content_analysis ca ON ca.content_id = c.id AND ca.status = 'ready'
            JOIN recommendation_candidates rc ON rc.content_id = c.id AND rc.pool = ?
            WHERE rc.status = 'active'`,
    })
    .all([pool])
    .flatMap((row) => {
      const parsed = PoolRowSchema.safeParse(row);
      return parsed.success ? [parsed.data] : [];
    });
}

function toItem(row: PoolRow, matches: readonly PoolMatch[]): readonly QualifiedRow[] {
  const analysis = CandidateAnalysisSchema.safeParse({
    summary: row.summary,
    keyPoints: parseJson(row.key_points, z.array(KeyPointSchema)),
    topics: parseJson(row.topics, z.array(z.string().min(1))),
    entities: parseJson(row.entities, z.array(z.string().min(1))),
    contentType: row.content_type === null ? undefined : ContentTypeSchema.parse(row.content_type),
    qualityScore: row.quality_score ?? undefined,
    spamScore: row.spam_score ?? undefined,
    longTermValue: row.long_term_value === null ? undefined : LongTermValueSchema.parse(row.long_term_value),
    embedding: parseJson(row.embedding, z.array(z.number())),
    embeddingModel: row.embedding_model ?? undefined,
  });
  if (!analysis.success || analysis.data.summary === undefined || analysis.data.contentType === undefined) {
    return [];
  }

  return [
    {
      contentId: row.id,
      ...(row.duplicate_group_id ? { duplicateGroupId: row.duplicate_group_id } : {}),
      ...(row.published_at !== null ? { publishedAt: row.published_at } : {}),
      ...(row.quality_score !== null ? { qualityScore: row.quality_score } : {}),
      item: {
        contentId: row.id,
        duplicateContentIds: [],
        ...(row.title ? { title: row.title } : {}),
        url: row.canonical_url,
        source: row.source,
        ...(row.author ? { author: row.author } : {}),
        ...(row.published_at !== null ? { publishedAt: row.published_at } : {}),
        analysis: {
          summary: analysis.data.summary,
          keyPoints: analysis.data.keyPoints ?? [],
          topics: analysis.data.topics ?? [],
          entities: analysis.data.entities ?? [],
          contentType: analysis.data.contentType,
          qualityScore: analysis.data.qualityScore ?? 0,
          spamScore: analysis.data.spamScore ?? 0,
          longTermValue: analysis.data.longTermValue ?? 'none',
          ...(analysis.data.embedding ? { embedding: analysis.data.embedding } : {}),
          ...(analysis.data.embeddingModel ? { embeddingModel: analysis.data.embeddingModel } : {}),
        },
        interestMatches: matches.map((match) => ({ ...match })),
      },
    },
  ];
}

function parseJson<T>(value: string | null, schema: z.ZodType<T>): T | undefined {
  if (value === null) return undefined;
  const parsed = schema.safeParse(JSON.parse(value));
  return parsed.success ? parsed.data : undefined;
}
