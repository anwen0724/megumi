/*
 * Owns atomic Candidate Supply persistence and exposes business-shaped Pool and Query operations.
 */
import { randomUUID } from 'node:crypto';
import type { DatabaseConnection, DatabaseRow } from '@megumi/database';
import {
  CandidateAdmissionDecisionSchema,
  CandidateSchema,
  SourceContentDetailSchema,
  SourceContentSchema,
  type Candidate,
  type CandidateAdmissionDecision,
  type CandidateMaterialResult,
  type CandidatePoolSnapshot,
  type CandidateQueryOutcome,
  type CandidateStatus,
  type CandidateSupplyRepository,
} from '../candidate-supply/candidate-supply';
import {
  assertCandidateTransition,
  candidateExpiresAt,
  candidatePoolGap,
  candidateQueryKey,
  candidateSupplyThresholds,
  isCandidateContentAssessable,
  normalizeCandidateQuery,
} from '../candidate-supply/candidate-pool';
import {
  canonicalContentIdentity,
  sourceContentIdentity,
} from '../daily-discovery/content-identity';
import type { SourceContent } from '../sources/discovery-source';

const ACTIVE_STATUSES: readonly CandidateStatus[] = [
  'preparing', 'pending_admission', 'available', 'reserved',
];

export function createCandidateSupplyRepository(
  database: DatabaseConnection,
): CandidateSupplyRepository {
  return {
    beginQuery: (input) => database.transaction({
      operation: () => beginQuery(database, input),
    }),
    commitSearchResult: (input) => database.transaction({
      operation: () => commitSearchResult(database, input),
    }),
    failQuery: (input) => database.transaction({
      operation: () => failQuery(database, input),
    }),
    interruptRunningQueries: (now) => database.prepare({ sql: `
      UPDATE discovery_candidate_queries
      SET status = 'interrupted', completed_at = ?, failure_code = 'process_interrupted',
          failure_message = 'The owning process ended before this Query settled.'
      WHERE status = 'running'
    ` }).run([parseTimestamp(now)]).changes,
    readCandidate: (candidateId) => readCandidate(database, candidateId),
    commitCandidateDetail: (input) => database.transaction({
      operation: () => commitCandidateDetail(database, input),
    }),
    commitAdmission: (input) => database.transaction({
      operation: () => commitAdmission(database, input),
    }),
    getPoolSnapshot: (input) => database.transaction({
      operation: () => getPoolSnapshot(database, input),
    }),
    listRecentQueryOutcomes: (input) => listRecentQueryOutcomes(database, input),
    isQueryCoolingDown: (input) => isQueryCoolingDown(database, input),
  };
}

function beginQuery(
  database: DatabaseConnection,
  input: Parameters<CandidateSupplyRepository['beginQuery']>[0],
): CandidateQueryOutcome {
  const query = input.query.normalize('NFKC').trim();
  if (!query || query.length > 200) throw new Error('Candidate Query must contain 1..200 characters.');
  const targetInterestIds = [...new Set(input.targetInterestIds)].sort();
  assertActiveInterests(database, targetInterestIds);
  const normalizedQuery = normalizeCandidateQuery(query);
  const key = candidateQueryKey({ ...input, query, targetInterestIds });
  database.prepare({ sql: `
    INSERT INTO discovery_candidate_queries (
      query_id, execution_id, query_key, source_id, query_text, normalized_query,
      mode, target_interest_ids_json, status, started_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'running', ?)
  ` }).run([
    input.queryId, input.executionId, key, input.sourceId, query, normalizedQuery,
    input.mode, JSON.stringify(targetInterestIds), parseTimestamp(input.startedAt),
  ]);
  return requireQuery(database, input.queryId);
}

function commitSearchResult(
  database: DatabaseConnection,
  input: Parameters<CandidateSupplyRepository['commitSearchResult']>[0],
): CandidateMaterialResult {
  const query = requireRunningQuery(database, input.queryId);
  const completedAt = parseTimestamp(input.completedAt);
  const items = input.items.map((item) => SourceContentSchema.parse(item));
  let activeCount = countActiveCandidates(database);
  let newCandidateCount = 0;
  let mergedCandidateCount = 0;
  let alreadyRecommendedCount = 0;
  let capacityRejectedCount = 0;
  const candidates = new Map<string, Candidate>();

  for (const item of items) {
    const contentIdentity = canonicalContentIdentity(item);
    const sourceIdentity = sourceContentIdentity(item);
    if (recommendationExists(database, contentIdentity)) {
      alreadyRecommendedCount += 1;
      continue;
    }
    const existing = findCandidate(database, contentIdentity, sourceIdentity);
    if (!existing && activeCount >= input.hardLimit) {
      capacityRejectedCount += 1;
      continue;
    }
    const candidate = existing
      ? mergeCandidate(database, existing, item, completedAt)
      : insertCandidate(database, item, contentIdentity, completedAt);
    if (existing) mergedCandidateCount += 1;
    else {
      newCandidateCount += 1;
      activeCount += 1;
    }
    upsertCandidateSource(database, candidate.candidateId, item, sourceIdentity, completedAt);
    database.prepare({ sql: `
      INSERT OR IGNORE INTO discovery_candidate_query_results (query_id, candidate_id, result_kind)
      VALUES (?, ?, ?)
    ` }).run([input.queryId, candidate.candidateId, existing ? 'merged' : 'created']);
    candidates.set(candidate.candidateId, candidate);
  }

  const invalidResultCount = input.invalidResultCount ?? 0;
  database.prepare({ sql: `
    UPDATE discovery_candidate_queries
    SET status = 'succeeded', raw_result_count = ?, invalid_result_count = ?,
        new_candidate_count = ?, merged_candidate_count = ?, already_recommended_count = ?,
        capacity_rejected_count = ?, completed_at = ?
    WHERE query_id = ? AND status = 'running'
  ` }).run([
    items.length + invalidResultCount,
    invalidResultCount,
    newCandidateCount,
    mergedCandidateCount,
    alreadyRecommendedCount,
    capacityRejectedCount,
    completedAt,
    input.queryId,
  ]);
  return { query: requireQuery(database, query.queryId), candidates: [...candidates.values()] };
}

function failQuery(
  database: DatabaseConnection,
  input: Parameters<CandidateSupplyRepository['failQuery']>[0],
): CandidateQueryOutcome {
  requireRunningQuery(database, input.queryId);
  database.prepare({ sql: `
    UPDATE discovery_candidate_queries
    SET status = ?, completed_at = ?, failure_code = ?, failure_message = ?
    WHERE query_id = ? AND status = 'running'
  ` }).run([
    input.status, parseTimestamp(input.completedAt), input.failureCode, input.failureMessage, input.queryId,
  ]);
  return requireQuery(database, input.queryId);
}

function insertCandidate(
  database: DatabaseConnection,
  item: SourceContent,
  contentIdentity: string,
  now: string,
): Candidate {
  const status = isCandidateContentAssessable(item) ? 'pending_admission' : 'preparing';
  const candidateId = `candidate:${randomUUID()}`;
  database.prepare({ sql: `
    INSERT INTO discovery_candidates (
      candidate_id, content_identity, status, primary_source_id, primary_source_name,
      source_content_id, canonical_url, content_type, title, author, content_published_at,
      description, cover_url, first_seen_at, last_seen_at, expires_at, status_updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ` }).run([
    candidateId, contentIdentity, status, item.sourceId, item.sourceName,
    item.sourceContentId ?? null, item.canonicalUrl, item.contentType, item.title,
    item.author ?? null, item.publishedAt ?? null, item.description ?? null,
    item.coverUrl ?? null, now, now, candidateExpiresAt(item.contentType, now, status), now,
  ]);
  return requireCandidate(database, candidateId);
}

function mergeCandidate(
  database: DatabaseConnection,
  current: Candidate,
  item: SourceContent,
  now: string,
): Candidate {
  if (current.status === 'consumed') return current;
  const preferIncoming = current.primarySourceId === 'open_web' && item.sourceId !== 'open_web';
  const materialChanged = [item.title, item.description, item.author]
    .some((value, index) => value && value !== [current.title, current.description, current.author][index]);
  const recoveredStatus = current.status === 'expired' && materialChanged
    ? (isCandidateContentAssessable(item) ? 'pending_admission' : 'preparing')
    : current.status;
  database.prepare({ sql: `
    UPDATE discovery_candidates SET
      status = ?, primary_source_id = ?, primary_source_name = ?, source_content_id = ?,
      canonical_url = ?, content_type = ?, title = ?, author = ?, content_published_at = ?,
      description = ?, cover_url = ?, last_seen_at = ?, expires_at = ?, status_updated_at = ?
    WHERE candidate_id = ?
  ` }).run([
    recoveredStatus,
    preferIncoming ? item.sourceId : current.primarySourceId,
    preferIncoming ? item.sourceName : current.primarySourceName,
    chooseField(current.sourceContentId, item.sourceContentId, preferIncoming),
    preferIncoming ? item.canonicalUrl : current.canonicalUrl,
    preferIncoming ? item.contentType : current.contentType,
    chooseField(current.title, item.title, preferIncoming),
    chooseField(current.author, item.author, preferIncoming),
    chooseField(current.publishedAt, item.publishedAt, preferIncoming),
    chooseField(current.description, item.description, preferIncoming),
    chooseField(current.coverUrl, item.coverUrl, preferIncoming),
    now,
    recoveredStatus === current.status
      ? current.expiresAt
      : candidateExpiresAt(item.contentType, now, recoveredStatus as 'preparing' | 'pending_admission'),
    recoveredStatus === current.status ? current.statusUpdatedAt : now,
    current.candidateId,
  ]);
  return requireCandidate(database, current.candidateId);
}

function upsertCandidateSource(
  database: DatabaseConnection,
  candidateId: string,
  item: SourceContent,
  sourceIdentity: string,
  now: string,
): void {
  database.prepare({ sql: `
    INSERT INTO discovery_candidate_sources (
      candidate_source_id, candidate_id, source_identity, source_id, source_name,
      source_content_id, canonical_url, first_seen_at, last_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_identity) DO UPDATE SET last_seen_at = excluded.last_seen_at
  ` }).run([
    `candidate-source:${randomUUID()}`, candidateId, sourceIdentity, item.sourceId,
    item.sourceName, item.sourceContentId ?? null, item.canonicalUrl, now, now,
  ]);
}

function commitCandidateDetail(
  database: DatabaseConnection,
  input: Parameters<CandidateSupplyRepository['commitCandidateDetail']>[0],
): Candidate {
  const current = requireCandidate(database, input.candidateId);
  if (current.status !== 'preparing') throw new Error('Only a preparing Candidate can be read.');
  const detail = SourceContentDetailSchema.parse(input.detail);
  if (sourceContentIdentity(detail) !== sourceContentIdentity(candidateAsSourceContent(current))) {
    throw new Error('Candidate detail does not match the stored Source identity.');
  }
  const now = parseTimestamp(input.now);
  const status = isCandidateContentAssessable(detail) ? 'pending_admission' : 'preparing';
  database.prepare({ sql: `
    UPDATE discovery_candidates SET description = ?, content_text = ?, author = ?,
      content_published_at = ?, cover_url = ?, status = ?, status_updated_at = ?, expires_at = ?
    WHERE candidate_id = ?
  ` }).run([
    detail.description ?? current.description ?? null,
    detail.contentText ?? current.contentText ?? null,
    detail.author ?? current.author ?? null,
    detail.publishedAt ?? current.publishedAt ?? null,
    detail.coverUrl ?? current.coverUrl ?? null,
    status,
    status === current.status ? current.statusUpdatedAt : now,
    status === current.status ? current.expiresAt : candidateExpiresAt(current.contentType, now, status),
    current.candidateId,
  ]);
  return requireCandidate(database, current.candidateId);
}

function commitAdmission(
  database: DatabaseConnection,
  input: Parameters<CandidateSupplyRepository['commitAdmission']>[0],
): readonly Candidate[] {
  const assessedAt = parseTimestamp(input.assessedAt);
  if (!input.assessmentVersion.trim()) throw new Error('Assessment version is required.');
  const decisions = input.decisions.map((decision) => CandidateAdmissionDecisionSchema.parse(decision));
  if (new Set(decisions.map((decision) => decision.candidateId)).size !== decisions.length) {
    throw new Error('Each Candidate may be assessed once per admission commit.');
  }
  for (const decision of decisions) validateAdmissionDecision(database, decision);

  return decisions.map((decision) => {
    const candidate = requireCandidate(database, decision.candidateId);
    if (candidate.status !== 'pending_admission') {
      throw new Error(`Candidate is not pending admission: ${candidate.candidateId}.`);
    }
    const nextStatus: CandidateStatus = decision.decision === 'admit'
      ? 'available'
      : decision.decision === 'needs_detail'
        ? 'preparing'
        : 'rejected';
    assertCandidateTransition(candidate.status, nextStatus);
    database.prepare({ sql: `
      UPDATE discovery_candidate_assessments SET active = 0 WHERE candidate_id = ? AND active = 1
    ` }).run([candidate.candidateId]);
    database.prepare({ sql: 'DELETE FROM discovery_candidate_interests WHERE candidate_id = ?' })
      .run([candidate.candidateId]);
    const assessmentId = `candidate-assessment:${randomUUID()}`;
    database.prepare({ sql: `
      INSERT INTO discovery_candidate_assessments (
        assessment_id, candidate_id, execution_id, assessment_version, decision,
        relevance, matched_interest_ids_json, content_value, novelty, temporal_validity,
        negative_constraint, duplicate_of_candidate_id, duplicate_of_recommendation_id,
        reason_code, reason, active, assessed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    ` }).run([
      assessmentId, candidate.candidateId, input.executionId, input.assessmentVersion,
      decision.decision,
      decision.decision === 'needs_detail' ? null : decision.relevance,
      JSON.stringify(decision.decision === 'needs_detail' ? [] : decision.matchedInterestIds),
      decision.decision === 'needs_detail' ? null : decision.contentValue,
      decision.decision === 'needs_detail' ? null : decision.novelty,
      decision.decision === 'needs_detail' ? null : decision.temporalValidity,
      decision.decision === 'needs_detail' ? null : decision.negativeConstraint,
      decision.decision === 'reject' ? decision.duplicateOfCandidateId ?? null : null,
      decision.decision === 'reject' ? decision.duplicateOfRecommendationId ?? null : null,
      decision.decision === 'reject' ? decision.reasonCode : null,
      decision.reason,
      assessedAt,
    ]);
    if (decision.decision !== 'needs_detail'
      && (decision.relevance === 'direct' || decision.relevance === 'adjacent')) {
      for (const interestId of decision.matchedInterestIds) {
        database.prepare({ sql: `
          INSERT INTO discovery_candidate_interests (
            candidate_id, interest_id, assessment_id, relation_kind
          ) VALUES (?, ?, ?, ?)
        ` }).run([candidate.candidateId, interestId, assessmentId, decision.relevance]);
      }
    }
    const expiresAt = nextStatus === 'available'
      ? candidateExpiresAt(candidate.contentType, candidate.lastSeenAt, 'available')
      : nextStatus === 'preparing'
        ? candidateExpiresAt(candidate.contentType, assessedAt, 'preparing')
        : new Date(Date.parse(assessedAt) + (90 * 24 * 60 * 60 * 1000)).toISOString();
    database.prepare({ sql: `
      UPDATE discovery_candidates SET status = ?, status_updated_at = ?, expires_at = ?
      WHERE candidate_id = ?
    ` }).run([nextStatus, assessedAt, expiresAt, candidate.candidateId]);
    return requireCandidate(database, candidate.candidateId);
  });
}

function validateAdmissionDecision(
  database: DatabaseConnection,
  decision: CandidateAdmissionDecision,
): void {
  requireCandidate(database, decision.candidateId);
  if (decision.decision === 'needs_detail') return;
  assertActiveInterests(database, decision.matchedInterestIds);
  if ((decision.relevance === 'direct' || decision.relevance === 'adjacent')
    && decision.matchedInterestIds.length === 0) {
    throw new Error(`${decision.relevance} admission requires a matching active Interest.`);
  }
  if ((decision.relevance === 'exploration' || decision.relevance === 'none')
    && decision.matchedInterestIds.length > 0) {
    throw new Error(`${decision.relevance} admission cannot claim an Interest relation.`);
  }
  if (decision.decision === 'reject' && decision.duplicateOfCandidateId) {
    requireCandidate(database, decision.duplicateOfCandidateId);
  }
  if (decision.decision === 'reject' && decision.duplicateOfRecommendationId) {
    const row = database.prepare<{ recommendation_id: string }>({
      sql: 'SELECT recommendation_id FROM discovery_recommendations WHERE recommendation_id = ?',
    }).get([decision.duplicateOfRecommendationId]);
    if (!row) throw new Error('Referenced duplicate Recommendation does not exist.');
  }
}

function getPoolSnapshot(
  database: DatabaseConnection,
  input: Parameters<CandidateSupplyRepository['getPoolSnapshot']>[0],
): CandidatePoolSnapshot {
  const now = parseTimestamp(input.now);
  database.prepare({ sql: `
    UPDATE discovery_candidates SET status = 'expired', status_updated_at = ?
    WHERE status IN ('preparing', 'pending_admission', 'available') AND expires_at <= ?
  ` }).run([now, now]);
  const thresholds = candidateSupplyThresholds(input.dailyTargetCount, input.proactiveTargetCount);
  const counts = emptyCounts();
  for (const row of database.prepare<StatusCountRow>({ sql: `
    SELECT status, COUNT(*) AS count FROM discovery_candidates GROUP BY status
  ` }).all()) counts[requireCandidateStatus(row.status)] = row.count;
  const uncoveredInterestIds = database.prepare<InterestIdRow>({ sql: `
    SELECT i.interest_id
    FROM discovery_interests i
    WHERE i.status = 'active'
      AND NOT EXISTS (
        SELECT 1 FROM discovery_candidate_interests ci
        JOIN discovery_candidates c ON c.candidate_id = ci.candidate_id
        WHERE ci.interest_id = i.interest_id AND c.status = 'available'
      )
    ORDER BY i.interest_id
  ` }).all().map((row) => row.interest_id);
  const gap = candidatePoolGap({
    availableCount: counts.available,
    thresholds,
    uncoveredInterestIds,
    ...(input.dailyShortfall !== undefined ? { dailyShortfall: input.dailyShortfall } : {}),
    ...(input.proactiveShortfall !== undefined ? { proactiveShortfall: input.proactiveShortfall } : {}),
  });
  const pendingCandidates = database.prepare<CandidateRow>({ sql: `
    SELECT * FROM discovery_candidates
    WHERE status IN ('preparing', 'pending_admission')
    ORDER BY CASE status WHEN 'pending_admission' THEN 0 ELSE 1 END, first_seen_at, candidate_id
    LIMIT 50
  ` }).all().map(candidateFromRow);
  const nextRecheckAt = gap.totalShortfall > 0 || gap.uncoveredInterestIds.length > 0
    ? undefined
    : calculateNextRecheckAt(database, thresholds.lowWatermark);
  return {
    thresholds,
    counts,
    activeCount: ACTIVE_STATUSES.reduce((sum, status) => sum + counts[status], 0),
    gap,
    pendingCandidates,
    ...(nextRecheckAt ? { nextRecheckAt } : {}),
  };
}

function calculateNextRecheckAt(
  database: DatabaseConnection,
  lowWatermark: number,
): string | undefined {
  const available = database.prepare<ExpiryRow>({ sql: `
    SELECT candidate_id, expires_at FROM discovery_candidates
    WHERE status = 'available' ORDER BY expires_at, candidate_id
  ` }).all();
  const thresholdIndex = Math.max(0, available.length - lowWatermark);
  const inventoryExpiry = available[thresholdIndex]?.expires_at;
  const interestExpiry = database.prepare<ExpiryRow>({ sql: `
    SELECT ci.interest_id AS candidate_id, MAX(c.expires_at) AS expires_at
    FROM discovery_candidate_interests ci
    JOIN discovery_candidates c ON c.candidate_id = ci.candidate_id AND c.status = 'available'
    JOIN discovery_interests i ON i.interest_id = ci.interest_id AND i.status = 'active'
    GROUP BY ci.interest_id ORDER BY expires_at LIMIT 1
  ` }).get()?.expires_at;
  return [inventoryExpiry, interestExpiry].filter((value): value is string => Boolean(value)).sort()[0];
}

function listRecentQueryOutcomes(
  database: DatabaseConnection,
  input: Parameters<CandidateSupplyRepository['listRecentQueryOutcomes']>[0],
): readonly CandidateQueryOutcome[] {
  const cutoff = new Date(Date.parse(parseTimestamp(input.now)) - (input.withinDays * 24 * 60 * 60 * 1000)).toISOString();
  const limit = Math.max(1, Math.min(50, input.limit));
  return database.prepare<QueryRow>({ sql: `
    SELECT * FROM discovery_candidate_queries
    WHERE started_at >= ? ORDER BY started_at DESC, query_id DESC LIMIT ?
  ` }).all([cutoff, limit]).map(queryFromRow);
}

function isQueryCoolingDown(
  database: DatabaseConnection,
  input: Parameters<CandidateSupplyRepository['isQueryCoolingDown']>[0],
): boolean {
  const nowMs = Date.parse(parseTimestamp(input.now));
  const key = candidateQueryKey(input);
  const cutoff = new Date(nowMs - (7 * 24 * 60 * 60 * 1000)).toISOString();
  const rows = database.prepare<QueryRow>({ sql: `
    SELECT * FROM discovery_candidate_queries
    WHERE query_key = ? AND status <> 'running' AND completed_at >= ?
    ORDER BY completed_at DESC, query_id DESC LIMIT 2
  ` }).all([key, cutoff]);
  if (rows.length < 2 || rows.some((row) => row.status !== 'succeeded')) return false;
  const newestCompletedAt = rows[0]?.completed_at;
  if (!newestCompletedAt || nowMs >= Date.parse(newestCompletedAt) + (24 * 60 * 60 * 1000)) return false;
  return rows.every((row) => queryAvailableYield(database, row.query_id) === 0);
}

function queryAvailableYield(database: DatabaseConnection, queryId: string): number {
  return database.prepare<{ count: number }>({ sql: `
    SELECT COUNT(DISTINCT qr.candidate_id) AS count
    FROM discovery_candidate_query_results qr
    JOIN discovery_candidate_assessments a ON a.candidate_id = qr.candidate_id
    WHERE qr.query_id = ? AND a.active = 1 AND a.decision = 'admit'
  ` }).get([queryId])?.count ?? 0;
}

function findCandidate(
  database: DatabaseConnection,
  contentIdentity: string,
  sourceIdentity: string,
): Candidate | undefined {
  const row = database.prepare<CandidateRow>({ sql: `
    SELECT DISTINCT c.* FROM discovery_candidates c
    LEFT JOIN discovery_candidate_sources s ON s.candidate_id = c.candidate_id
    WHERE c.content_identity = ? OR s.source_identity = ? LIMIT 1
  ` }).get([contentIdentity, sourceIdentity]);
  return row ? candidateFromRow(row) : undefined;
}

function recommendationExists(database: DatabaseConnection, contentIdentity: string): boolean {
  return Boolean(database.prepare<{ recommendation_id: string }>({
    sql: 'SELECT recommendation_id FROM discovery_recommendations WHERE content_identity = ? LIMIT 1',
  }).get([contentIdentity]));
}

function countActiveCandidates(database: DatabaseConnection): number {
  return database.prepare<{ count: number }>({ sql: `
    SELECT COUNT(*) AS count FROM discovery_candidates
    WHERE status IN ('preparing', 'pending_admission', 'available', 'reserved')
  ` }).get()?.count ?? 0;
}

function assertActiveInterests(database: DatabaseConnection, interestIds: readonly string[]): void {
  for (const interestId of interestIds) {
    const row = database.prepare<{ interest_id: string }>({
      sql: "SELECT interest_id FROM discovery_interests WHERE interest_id = ? AND status = 'active'",
    }).get([interestId]);
    if (!row) throw new Error(`Active Interest not found: ${interestId}.`);
  }
}

function requireRunningQuery(database: DatabaseConnection, queryId: string): CandidateQueryOutcome {
  const query = requireQuery(database, queryId);
  if (query.status !== 'running') throw new Error(`Candidate Query is already settled: ${queryId}.`);
  return query;
}

function requireQuery(database: DatabaseConnection, queryId: string): CandidateQueryOutcome {
  const row = database.prepare<QueryRow>({
    sql: 'SELECT * FROM discovery_candidate_queries WHERE query_id = ?',
  }).get([queryId]);
  if (!row) throw new Error(`Candidate Query not found: ${queryId}.`);
  return queryFromRow(row);
}

function queryFromRow(row: QueryRow): CandidateQueryOutcome {
  return {
    queryId: row.query_id,
    executionId: row.execution_id,
    sourceId: row.source_id,
    query: row.query_text,
    normalizedQuery: row.normalized_query,
    mode: row.mode,
    targetInterestIds: parseStringArray(row.target_interest_ids_json),
    status: row.status,
    rawResultCount: row.raw_result_count,
    invalidResultCount: row.invalid_result_count,
    newCandidateCount: row.new_candidate_count,
    mergedCandidateCount: row.merged_candidate_count,
    alreadyRecommendedCount: row.already_recommended_count,
    capacityRejectedCount: row.capacity_rejected_count,
    startedAt: row.started_at,
    ...(row.completed_at ? { completedAt: row.completed_at } : {}),
    ...(row.failure_code ? { failureCode: row.failure_code } : {}),
  };
}

function readCandidate(database: DatabaseConnection, candidateId: string): Candidate | undefined {
  const row = database.prepare<CandidateRow>({
    sql: 'SELECT * FROM discovery_candidates WHERE candidate_id = ?',
  }).get([candidateId]);
  return row ? candidateFromRow(row) : undefined;
}

function requireCandidate(database: DatabaseConnection, candidateId: string): Candidate {
  const candidate = readCandidate(database, candidateId);
  if (!candidate) throw new Error(`Candidate not found: ${candidateId}.`);
  return candidate;
}

function candidateFromRow(row: CandidateRow): Candidate {
  return CandidateSchema.parse({
    candidateId: row.candidate_id,
    contentIdentity: row.content_identity,
    status: row.status,
    primarySourceId: row.primary_source_id,
    primarySourceName: row.primary_source_name,
    ...(row.source_content_id ? { sourceContentId: row.source_content_id } : {}),
    canonicalUrl: row.canonical_url,
    contentType: row.content_type,
    title: row.title,
    ...(row.author ? { author: row.author } : {}),
    ...(row.content_published_at ? { publishedAt: row.content_published_at } : {}),
    ...(row.description ? { description: row.description } : {}),
    ...(row.content_text ? { contentText: row.content_text } : {}),
    ...(row.cover_url ? { coverUrl: row.cover_url } : {}),
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    expiresAt: row.expires_at,
    statusUpdatedAt: row.status_updated_at,
  });
}

function candidateAsSourceContent(candidate: Candidate): SourceContent {
  return SourceContentSchema.parse({
    sourceId: candidate.primarySourceId,
    sourceName: candidate.primarySourceName,
    ...(candidate.sourceContentId ? { sourceContentId: candidate.sourceContentId } : {}),
    canonicalUrl: candidate.canonicalUrl,
    contentType: candidate.contentType,
    title: candidate.title,
    ...(candidate.author ? { author: candidate.author } : {}),
    ...(candidate.publishedAt ? { publishedAt: candidate.publishedAt } : {}),
    ...(candidate.description ? { description: candidate.description } : {}),
    ...(candidate.coverUrl ? { coverUrl: candidate.coverUrl } : {}),
  });
}

function emptyCounts(): Record<CandidateStatus, number> {
  return {
    preparing: 0,
    pending_admission: 0,
    available: 0,
    reserved: 0,
    consumed: 0,
    rejected: 0,
    expired: 0,
  };
}

function requireCandidateStatus(value: string): CandidateStatus {
  return CandidateSchema.shape.status.parse(value);
}

function chooseField<T>(current: T | undefined, incoming: T | undefined, preferIncoming: boolean): T | null {
  return (preferIncoming ? incoming ?? current : current ?? incoming) ?? null;
}

function parseTimestamp(value: string): string {
  if (!Number.isFinite(Date.parse(value))) throw new Error('Expected an ISO timestamp.');
  return value;
}

function parseStringArray(value: string): readonly string[] {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
    throw new Error('Invalid persisted string array.');
  }
  return parsed;
}

type QueryRow = DatabaseRow & {
  query_id: string; execution_id: string; query_key: string; source_id: string;
  query_text: string; normalized_query: string; mode: 'relevance' | 'recent';
  target_interest_ids_json: string;
  status: CandidateQueryOutcome['status']; raw_result_count: number; invalid_result_count: number;
  new_candidate_count: number; merged_candidate_count: number; already_recommended_count: number;
  capacity_rejected_count: number; failure_code: string | null; failure_message: string | null;
  started_at: string; completed_at: string | null;
};
type CandidateRow = DatabaseRow & {
  candidate_id: string; content_identity: string; status: string; primary_source_id: string;
  primary_source_name: string; source_content_id: string | null; canonical_url: string;
  content_type: string; title: string; author: string | null; content_published_at: string | null;
  description: string | null; content_text: string | null; cover_url: string | null;
  first_seen_at: string; last_seen_at: string; expires_at: string; status_updated_at: string;
};
type StatusCountRow = DatabaseRow & { status: string; count: number };
type InterestIdRow = DatabaseRow & { interest_id: string };
type ExpiryRow = DatabaseRow & { candidate_id: string; expires_at: string };
