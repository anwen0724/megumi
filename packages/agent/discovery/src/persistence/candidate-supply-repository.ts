/*
 * Owns Candidate and CandidateInterestMatch persistence plus the derived Candidate Pool.
 */
import { randomUUID } from 'node:crypto';
import type { DatabaseConnection, DatabaseRow } from '@megumi/database';
import {
  CandidateInterestMatchSchema,
  CandidateRelevanceSchema,
  CandidateSchema,
  SourceContentDetailSchema,
  type Candidate,
  type CandidateIdentity,
  type CandidateInterestMatch,
  type CandidatePoolSettings,
  type CandidatePoolSnapshot,
  type CandidateSubmissionResult,
  type CandidateSupplyRepository,
  type CandidateWithMatches,
  type SubmitCandidateRequest,
} from '../candidate-supply/candidate-supply';
import { candidateExpiresAt } from '../candidate-supply/candidate-pool';
import {
  canonicalContentIdentity,
  normalizeContentUrl,
} from '../candidate-supply/content-identity';

interface CandidateRow extends DatabaseRow {
  readonly id: string;
  readonly content_identity: string;
  readonly source_id: string;
  readonly source_content_id: string | null;
  readonly canonical_url: string;
  readonly content_type: string;
  readonly title: string;
  readonly author: string | null;
  readonly published_at: string | null;
  readonly description: string | null;
  readonly content_summary: string;
  readonly content_excerpt: string | null;
  readonly content_truncated: number;
  readonly cover_url: string | null;
  readonly status: string;
  readonly created_at: string;
  readonly expires_at: string;
}

interface MatchRow extends DatabaseRow {
  readonly id: string;
  readonly candidate_id: string;
  readonly interest_id: string;
  readonly relevance: string;
  readonly match_reason: string;
}

export interface CreateCandidateSupplyRepositoryOptions {
  readonly database: DatabaseConnection;
  readonly clock: { now(): string };
  readonly ids: {
    createCandidateId(): string;
    createInterestMatchId(): string;
  };
}

/** Creates the sole persistence owner for Candidate Supply business facts. */
export function createCandidateSupplyRepository(
  input: DatabaseConnection | CreateCandidateSupplyRepositoryOptions,
): CandidateSupplyRepository {
  const options = isOptions(input)
    ? input
    : {
        database: input,
        clock: { now: () => new Date().toISOString() },
        ids: {
          createCandidateId: () => `candidate:${randomUUID()}`,
          createInterestMatchId: () => `candidate-interest-match:${randomUUID()}`,
        },
      };
  const { database } = options;
  return {
    findCandidateById(id) {
      return database.transaction({
        operation: () => {
          expireCandidate(database, id, options.clock.now());
          return readCandidateWithMatches(database, id);
        },
      });
    },
    findCandidateByIdentity(identity) {
      return database.transaction({
        operation: () => {
          const row = readCandidateByIdentity(database, normalizeIdentity(identity));
          if (!row) return undefined;
          expireCandidate(database, row.id, options.clock.now());
          return readCandidateWithMatches(database, row.id);
        },
      });
    },
    getCandidatePoolSnapshot(settings) {
      return database.transaction({
        operation: () => getCandidatePoolSnapshot(database, options.clock.now(), settings),
      });
    },
    submitCandidate(request) {
      return database.transaction({
        operation: () => submitCandidate(database, options, request),
      });
    },
  };
}

function submitCandidate(
  database: DatabaseConnection,
  options: CreateCandidateSupplyRepositoryOptions,
  request: SubmitCandidateRequest,
): CandidateSubmissionResult {
  const content = SourceContentDetailSchema.parse(request.content);
  const contentSummary = requireBoundedText(request.contentSummary, 'contentSummary', 1000);
  const settings = requireSettings(request.settings);
  const excerpt = candidateExcerpt(content.contentText ?? content.description, settings);
  const matches = uniqueMatches(request.matches);
  const activeMatches = findActiveMatches(database, matches);
  if (activeMatches.length === 0) return ignored('no_active_interest');

  const now = parseTimestamp(options.clock.now());
  expireAvailableCandidates(database, now);
  const canonicalUrl = normalizeContentUrl(content.canonicalUrl);
  const identity: CandidateIdentity = {
    sourceId: content.sourceId,
    ...(content.sourceContentId ? { sourceContentId: content.sourceContentId } : {}),
    canonicalUrl,
    contentIdentity: canonicalContentIdentity({ canonicalUrl }),
  };
  const existing = readCandidateByIdentity(database, identity);
  if (existing && existing.status !== 'available') return ignored('terminal_duplicate');

  if (existing) {
    const existingInterestIds = new Set(
      readMatches(database, existing.id).map(({ interestId }) => interestId),
    );
    const additions = activeMatches.filter(({ interestId }) => !existingInterestIds.has(interestId));
    if (additions.length === 0) return ignored('duplicate_match');
    const inserted = insertMatches(database, options, existing.id, additions);
    return {
      status: 'matched_existing',
      candidate: candidateFromRow(existing),
      interestMatches: readMatches(database, existing.id),
      addedCandidateCount: 0,
      addedInterestMatchCount: inserted.length,
    };
  }

  if (candidatePoolCount(database, now) >= Math.min(settings.targetCount, settings.maximumCount)) {
    return ignored('capacity_reached');
  }

  const id = options.ids.createCandidateId();
  const expiresAt = candidateExpiresAt(now, settings.candidateValidityDays);
  database.prepare({ sql: `
    INSERT INTO discovery_candidates (
      id, content_identity, source_id, source_content_id, canonical_url, content_type,
      title, author, published_at, description, content_summary, content_excerpt,
      content_truncated, cover_url, status, created_at, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'available', ?, ?)
  ` }).run([
    id,
    identity.contentIdentity,
    content.sourceId,
    content.sourceContentId ?? null,
    canonicalUrl,
    content.contentType,
    content.title.trim(),
    content.author?.trim() ?? null,
    content.publishedAt ?? null,
    content.description?.trim() ?? null,
    contentSummary,
    excerpt.contentExcerpt ?? null,
    excerpt.contentTruncated ? 1 : 0,
    content.coverUrl ?? null,
    now,
    expiresAt,
  ]);
  const inserted = insertMatches(database, options, id, activeMatches);
  if (inserted.length === 0) throw new Error('A new Candidate requires at least one active Interest match.');
  const stored = readCandidateWithMatches(database, id);
  if (!stored) throw new Error('Candidate disappeared after submission.');
  return {
    status: 'created',
    candidate: stored.candidate,
    interestMatches: stored.interestMatches,
    addedCandidateCount: 1,
    addedInterestMatchCount: inserted.length,
  };
}

function getCandidatePoolSnapshot(
  database: DatabaseConnection,
  at: string,
  settingsInput: CandidatePoolSettings,
): CandidatePoolSnapshot {
  const settings = requireSettings(settingsInput);
  const asOf = parseTimestamp(at);
  expireAvailableCandidates(database, asOf);
  const activeInterests = database.prepare<{ interest_id: string }>({ sql: `
    SELECT interest_id FROM discovery_interests
    WHERE status = 'active'
    ORDER BY created_at, interest_id
  ` }).all().map(({ interest_id }) => interest_id);
  const rows = database.prepare<CandidateRow>({ sql: `
    SELECT DISTINCT c.*
    FROM discovery_candidates c
    JOIN discovery_candidate_interest_matches m ON m.candidate_id = c.id
    JOIN discovery_interests i ON i.interest_id = m.interest_id AND i.status = 'active'
    WHERE c.status = 'available' AND c.expires_at > ?
    ORDER BY c.created_at, c.id
  ` }).all([asOf]);
  const activeSet = new Set(activeInterests);
  const candidates = rows.map((row): CandidateWithMatches => ({
    candidate: candidateFromRow(row),
    interestMatches: readMatches(database, row.id)
      .filter(({ interestId }) => activeSet.has(interestId)),
  }));
  const availableByInterest = Object.fromEntries(activeInterests.map((interestId) => [
    interestId,
    candidates.filter(({ interestMatches }) => (
      interestMatches.some((match) => match.interestId === interestId)
    )).length,
  ]));
  const availableCount = candidates.length;
  return {
    asOf,
    minimumCount: settings.minimumCount,
    targetCount: settings.targetCount,
    maximumCount: settings.maximumCount,
    availableCount,
    minimumShortfall: Math.max(0, settings.minimumCount - availableCount),
    targetShortfall: Math.max(0, settings.targetCount - availableCount),
    availableByInterest,
    candidates,
  };
}

function findActiveMatches(
  database: DatabaseConnection,
  matches: readonly {
    readonly interestId: string;
    readonly relevance: string;
    readonly matchReason: string;
  }[],
): readonly {
  readonly interestId: string;
  readonly relevance: 'direct' | 'adjacent' | 'exploration';
  readonly matchReason: string;
}[] {
  if (matches.length === 0) return [];
  const placeholders = matches.map(() => '?').join(', ');
  const active = new Set(database.prepare<{ interest_id: string }>({ sql: `
    SELECT interest_id FROM discovery_interests
    WHERE status = 'active' AND interest_id IN (${placeholders})
  ` }).all(matches.map(({ interestId }) => interestId)).map(({ interest_id }) => interest_id));
  return matches
    .filter(({ interestId }) => active.has(interestId))
    .map(({ interestId, relevance, matchReason }) => ({
      interestId,
      relevance: CandidateRelevanceSchema.parse(relevance),
      matchReason,
    }));
}

function insertMatches(
  database: DatabaseConnection,
  options: CreateCandidateSupplyRepositoryOptions,
  candidateId: string,
  matches: readonly {
    readonly interestId: string;
    readonly relevance: string;
    readonly matchReason: string;
  }[],
): readonly CandidateInterestMatch[] {
  const inserted: CandidateInterestMatch[] = [];
  for (const match of matches) {
    const value = CandidateInterestMatchSchema.parse({
      id: options.ids.createInterestMatchId(),
      candidateId,
      interestId: match.interestId,
      relevance: match.relevance,
      matchReason: match.matchReason,
    });
    database.prepare({ sql: `
      INSERT INTO discovery_candidate_interest_matches (
        id, candidate_id, interest_id, relevance, match_reason
      ) VALUES (?, ?, ?, ?, ?)
    ` }).run([
      value.id,
      value.candidateId,
      value.interestId,
      value.relevance,
      value.matchReason,
    ]);
    inserted.push(value);
  }
  return inserted;
}

function readCandidateByIdentity(
  database: DatabaseConnection,
  identity: CandidateIdentity,
): CandidateRow | undefined {
  if (identity.sourceContentId) {
    return database.prepare<CandidateRow>({ sql: `
      SELECT * FROM discovery_candidates
      WHERE content_identity = ? OR canonical_url = ?
        OR (source_id = ? AND source_content_id = ?)
      ORDER BY created_at, id LIMIT 1
    ` }).get([
      identity.contentIdentity,
      identity.canonicalUrl,
      identity.sourceId,
      identity.sourceContentId,
    ]);
  }
  return database.prepare<CandidateRow>({ sql: `
    SELECT * FROM discovery_candidates
    WHERE content_identity = ? OR canonical_url = ?
    ORDER BY created_at, id LIMIT 1
  ` }).get([identity.contentIdentity, identity.canonicalUrl]);
}

function readCandidateWithMatches(
  database: DatabaseConnection,
  id: string,
): CandidateWithMatches | undefined {
  const row = database.prepare<CandidateRow>({
    sql: 'SELECT * FROM discovery_candidates WHERE id = ?',
  }).get([id]);
  return row
    ? { candidate: candidateFromRow(row), interestMatches: readMatches(database, id) }
    : undefined;
}

function readMatches(database: DatabaseConnection, candidateId: string): readonly CandidateInterestMatch[] {
  return database.prepare<MatchRow>({ sql: `
    SELECT * FROM discovery_candidate_interest_matches
    WHERE candidate_id = ? ORDER BY id
  ` }).all([candidateId]).map((row) => CandidateInterestMatchSchema.parse({
    id: row.id,
    candidateId: row.candidate_id,
    interestId: row.interest_id,
    relevance: row.relevance,
    matchReason: row.match_reason,
  }));
}

function candidatePoolCount(database: DatabaseConnection, at: string): number {
  return database.prepare<{ count: number }>({ sql: `
    SELECT COUNT(DISTINCT c.id) AS count
    FROM discovery_candidates c
    JOIN discovery_candidate_interest_matches m ON m.candidate_id = c.id
    JOIN discovery_interests i ON i.interest_id = m.interest_id AND i.status = 'active'
    WHERE c.status = 'available' AND c.expires_at > ?
  ` }).get([at])?.count ?? 0;
}

function expireAvailableCandidates(database: DatabaseConnection, at: string): void {
  database.prepare({ sql: `
    UPDATE discovery_candidates SET status = 'expired'
    WHERE status = 'available' AND expires_at <= ?
  ` }).run([at]);
}

function expireCandidate(database: DatabaseConnection, id: string, at: string): void {
  database.prepare({ sql: `
    UPDATE discovery_candidates SET status = 'expired'
    WHERE id = ? AND status = 'available' AND expires_at <= ?
  ` }).run([id, parseTimestamp(at)]);
}

function candidateFromRow(row: CandidateRow): Candidate {
  return CandidateSchema.parse({
    id: row.id,
    contentIdentity: row.content_identity,
    sourceId: row.source_id,
    ...(row.source_content_id ? { sourceContentId: row.source_content_id } : {}),
    canonicalUrl: row.canonical_url,
    contentType: row.content_type,
    title: row.title,
    ...(row.author ? { author: row.author } : {}),
    ...(row.published_at ? { publishedAt: row.published_at } : {}),
    ...(row.description ? { description: row.description } : {}),
    contentSummary: row.content_summary,
    ...(row.content_excerpt ? { contentExcerpt: row.content_excerpt } : {}),
    contentTruncated: row.content_truncated === 1,
    ...(row.cover_url ? { coverUrl: row.cover_url } : {}),
    status: row.status,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  });
}

function normalizeIdentity(identity: CandidateIdentity): CandidateIdentity {
  const canonicalUrl = normalizeContentUrl(identity.canonicalUrl);
  return {
    sourceId: requireText(identity.sourceId, 'sourceId'),
    ...(identity.sourceContentId ? { sourceContentId: identity.sourceContentId } : {}),
    canonicalUrl,
    contentIdentity: requireText(identity.contentIdentity, 'contentIdentity'),
  };
}

function uniqueMatches(
  matches: SubmitCandidateRequest['matches'],
): readonly {
  readonly interestId: string;
  readonly relevance: 'direct' | 'adjacent' | 'exploration';
  readonly matchReason: string;
}[] {
  const unique = new Map<string, {
    readonly relevance: 'direct' | 'adjacent' | 'exploration';
    readonly matchReason: string;
  }>();
  for (const match of matches) {
    const interestId = requireText(match.interestId, 'interestId');
    if (!unique.has(interestId)) {
      unique.set(interestId, {
        relevance: CandidateRelevanceSchema.parse(match.relevance),
        matchReason: requireBoundedText(match.matchReason, 'matchReason', 1000),
      });
    }
  }
  return [...unique].map(([interestId, match]) => ({ interestId, ...match }));
}

function requireSettings(settings: CandidatePoolSettings): CandidatePoolSettings {
  if (!Number.isInteger(settings.minimumCount) || settings.minimumCount <= 0) {
    throw new Error('minimumCount must be a positive integer.');
  }
  if (!Number.isInteger(settings.maximumCount) || settings.maximumCount <= 0) {
    throw new Error('maximumCount must be a positive integer.');
  }
  if (settings.targetCount !== Math.floor(settings.maximumCount * 0.8)
    || settings.minimumCount >= settings.targetCount) {
    throw new Error('Candidate Pool settings are inconsistent.');
  }
  if (!Number.isInteger(settings.candidateValidityDays) || settings.candidateValidityDays <= 0) {
    throw new Error('candidateValidityDays must be a positive integer.');
  }
  if (!Number.isInteger(settings.candidateContentExcerptMaxCharacters)
    || settings.candidateContentExcerptMaxCharacters <= 0) {
    throw new Error('candidateContentExcerptMaxCharacters must be a positive integer.');
  }
  return settings;
}

/** Forms a code-point-safe prefix while preserving whether Source evidence was incomplete. */
function candidateExcerpt(
  sourceText: string | undefined,
  settings: CandidatePoolSettings,
): Pick<Candidate, 'contentExcerpt' | 'contentTruncated'> {
  if (!sourceText) return { contentTruncated: false };
  const characters = [...sourceText];
  const contentTruncated = characters.length > settings.candidateContentExcerptMaxCharacters;
  return {
    contentExcerpt: characters.slice(0, settings.candidateContentExcerptMaxCharacters).join(''),
    contentTruncated,
  };
}

function parseTimestamp(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error('Clock returned an invalid timestamp.');
  return new Date(timestamp).toISOString();
}

function requireText(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} cannot be empty.`);
  return normalized;
}

function requireBoundedText(value: string, field: string, maxCharacters: number): string {
  const normalized = requireText(value, field);
  if ([...normalized].length > maxCharacters) {
    throw new Error(`${field} cannot exceed ${maxCharacters} characters.`);
  }
  return normalized;
}

function ignored(
  reason: Extract<CandidateSubmissionResult, { readonly status: 'ignored' }>['reason'],
): CandidateSubmissionResult {
  return { status: 'ignored', reason, addedCandidateCount: 0, addedInterestMatchCount: 0 };
}

function isOptions(
  input: DatabaseConnection | CreateCandidateSupplyRepositoryOptions,
): input is CreateCandidateSupplyRepositoryOptions {
  return 'database' in input;
}
