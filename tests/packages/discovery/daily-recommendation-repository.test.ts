/* Verifies Daily Recommendation's consistent Pool snapshot and atomic publication interface. */
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, migrateDatabase, type DatabaseConnection } from '@megumi/database';
import {
  createDailyRecommendationRepository,
  createDiscoveryRepository,
  type DiscoveryRepository,
} from '@megumi/discovery';

const now = '2026-08-27T08:00:00.000Z';

describe('DailyRecommendationRepository', () => {
  let database: DatabaseConnection;
  let discovery: DiscoveryRepository;

  beforeEach(() => {
    database = createDatabase({ filename: ':memory:' });
    migrateDatabase({ database });
    discovery = createDiscoveryRepository({ database });
    discovery.changeInterest({
      action: 'create', interestId: 'interest:1', description: 'Agent architecture', now,
    });
  });

  afterEach(() => database.close());

  it('reads eligible Candidate, active Assessment, Interest, and history facts in one bounded snapshot', () => {
    const direct = admitCandidate(discovery, 'direct', ['interest:1'], 'Direct guide');
    const exploration = admitCandidate(discovery, 'exploration', [], 'Exploration guide');
    const repository = createDailyRecommendationRepository(database);

    const snapshot = repository.readSnapshot({ now, requestedCount: 5 });

    expect(snapshot.window).toMatchObject({ availableCount: 2, actualTarget: 2, requestedCount: 5 });
    expect(snapshot.window.candidates.map(({ candidateId }) => candidateId)).toEqual([
      direct,
      exploration,
    ]);
    expect(snapshot.activeInterests).toEqual([
      expect.objectContaining({ interestId: 'interest:1', description: 'Agent architecture' }),
    ]);
    expect(snapshot.recentRecommendations).toEqual([]);
    expect(snapshot.pendingFeedback).toEqual([]);
  });

  it('atomically creates immutable Recommendations, consumes Candidates, and publishes the Batch', () => {
    const first = admitCandidate(discovery, 'direct', ['interest:1'], 'First guide');
    const second = admitCandidate(discovery, 'exploration', [], 'Second guide');
    const repository = createDailyRecommendationRepository(database);
    repository.claimBatch({
      batchId: 'batch:1', localDate: '2026-08-27', timezone: 'Asia/Shanghai',
      executionId: 'execution:1', requestedCount: 5, actualTarget: 2, now,
    });
    const command = {
      batchId: 'batch:1',
      executionId: 'execution:1',
      publishedAt: now,
      allowedCandidateIds: [first, second],
      items: [
        { recommendationId: 'recommendation:1', candidateId: second, recommendationReason: 'Broaden the topic.' },
        { recommendationId: 'recommendation:2', candidateId: first, recommendationReason: 'Directly useful.' },
      ],
    } as const;

    const published = repository.publish(command);

    expect(published).toMatchObject({ status: 'published' });
    if (published.status !== 'published') throw new Error('Expected publication to succeed.');
    expect(published.recommendations.map(({ candidateId, position }) => ({ candidateId, position }))).toEqual([
      { candidateId: second, position: 0 },
      { candidateId: first, position: 1 },
    ]);
    expect(discovery.readCandidate(first)?.status).toBe('consumed');
    expect(discovery.readCandidate(second)?.status).toBe('consumed');
    expect(repository.getBatch('2026-08-27')).toMatchObject({
      status: 'published', requestedCount: 5, actualTarget: 2, resultCount: 2,
    });

    expect(repository.publish(command)).toEqual({
      status: 'already_published',
      batch: published.batch,
      recommendations: published.recommendations,
    });

    const publishedBasis = database.prepare<PublishedBasisRow>({ sql: `
      SELECT assessment_id, assessment_version, matched_interest_ids_json,
        interest_revisions_json, preference_revisions_json, content_evidence_json
      FROM discovery_recommendations WHERE recommendation_id = ?
    ` }).get(['recommendation:2']);
    expect(publishedBasis).toMatchObject({
      assessment_id: expect.any(String),
      assessment_version: 'candidate-admission:v1',
      matched_interest_ids_json: '["interest:1"]',
      interest_revisions_json: '[{"interestId":"interest:1","revision":1}]',
      preference_revisions_json: '[{"scopeKey":"interest:interest:1","revision":0}]',
    });
    expect(JSON.parse(publishedBasis?.content_evidence_json ?? '')).toEqual({
      sourceId: 'open_web',
      canonicalUrl: 'https://example.com/first-guide',
      title: 'First guide',
      description: 'First guide with concrete implementation detail.',
      completeness: 'partial',
    });

    const feedbackAt = '2026-08-27T08:01:00.000Z';
    discovery.updateRecommendationState({
      recommendationId: 'recommendation:2', action: 'set_reaction', reaction: 'liked',
      feedbackId: 'feedback:2', feedbackChangeId: 'feedback-change:2', now: feedbackAt,
    });
    discovery.updateRecommendationState({
      recommendationId: 'recommendation:2', action: 'set_favorite', favorite: true,
      now: '2026-08-27T08:02:00.000Z',
    });
    expect(repository.readSnapshot({ now, requestedCount: 5 }).pendingFeedback).toEqual([
      expect.objectContaining({
        feedbackId: 'feedback:2', reaction: 'liked', changedAt: feedbackAt,
      }),
    ]);
  });

  it('rolls back the whole selection when one Candidate becomes unavailable before publication', () => {
    const first = admitCandidate(discovery, 'direct', ['interest:1'], 'First guide');
    const second = admitCandidate(discovery, 'adjacent', ['interest:1'], 'Second guide');
    const repository = createDailyRecommendationRepository(database);
    repository.claimBatch({
      batchId: 'batch:main', localDate: '2026-08-27', timezone: 'Asia/Shanghai',
      executionId: 'execution:main', requestedCount: 2, actualTarget: 2, now,
    });
    repository.claimBatch({
      batchId: 'batch:other', localDate: '2026-08-26', timezone: 'Asia/Shanghai',
      executionId: 'execution:other', requestedCount: 1, actualTarget: 1, now,
    });
    expect(repository.publish({
      batchId: 'batch:other', executionId: 'execution:other', publishedAt: now,
      allowedCandidateIds: [first],
      items: [{ recommendationId: 'recommendation:other', candidateId: first, recommendationReason: 'Other.' }],
    }).status).toBe('published');

    const result = repository.publish({
      batchId: 'batch:main', executionId: 'execution:main', publishedAt: now,
      allowedCandidateIds: [first, second],
      items: [
        { recommendationId: 'recommendation:main:1', candidateId: first, recommendationReason: 'First.' },
        { recommendationId: 'recommendation:main:2', candidateId: second, recommendationReason: 'Second.' },
      ],
    });

    expect(result).toEqual({ status: 'selection_conflict', unavailableCandidateIds: [first] });
    expect(discovery.readCandidate(second)?.status).toBe('available');
    expect(repository.getBatch('2026-08-27')).toMatchObject({ status: 'running', resultCount: 0 });
  });

  it('reuses the same failed Batch for at most three execution attempts', () => {
    const repository = createDailyRecommendationRepository(database);
    const claim = (executionId: string) => repository.claimBatch({
      batchId: `ignored:${executionId}`,
      localDate: '2026-08-27',
      timezone: 'UTC',
      executionId,
      requestedCount: 5,
      actualTarget: 1,
      now,
    });
    const fail = (executionId: string) => repository.failBatch({
      batchId: 'ignored:execution:1',
      executionId,
      failedAt: now,
      failureCode: 'model_call_failed',
      failureMessage: 'Temporary model failure.',
    });

    expect(claim('execution:1')).toMatchObject({
      status: 'claimed', batch: { batchId: 'ignored:execution:1', attemptCount: 1 },
    });
    fail('execution:1');
    expect(claim('execution:2')).toMatchObject({
      status: 'claimed',
      batch: { batchId: 'ignored:execution:1', executionId: 'execution:2', attemptCount: 2, automaticRetryCount: 1 },
    });
    fail('execution:2');
    expect(claim('execution:3')).toMatchObject({
      status: 'claimed',
      batch: { batchId: 'ignored:execution:1', executionId: 'execution:3', attemptCount: 3, automaticRetryCount: 2 },
    });
    fail('execution:3');
    expect(claim('execution:4')).toMatchObject({
      status: 'failed', batch: { batchId: 'ignored:execution:1', attemptCount: 3 },
    });
  });
});

function admitCandidate(
  repository: DiscoveryRepository,
  relevance: 'direct' | 'adjacent' | 'exploration',
  matchedInterestIds: readonly string[],
  title: string,
): string {
  const suffix = title.toLowerCase().replaceAll(' ', '-');
  repository.beginQuery({
    queryId: `query:${suffix}`, executionId: 'execution:supply', sourceId: 'open_web',
    query: title, mode: 'relevance', targetInterestIds: matchedInterestIds, startedAt: now,
  });
  const candidate = repository.commitSearchResult({
    queryId: `query:${suffix}`, completedAt: now, hardLimit: 100,
    items: [{
      sourceId: 'open_web', sourceName: 'example.com', sourceContentId: suffix,
      canonicalUrl: `https://example.com/${suffix}`, contentType: 'article', title,
      description: `${title} with concrete implementation detail.`,
    }],
  }).candidates[0];
  if (!candidate) throw new Error('Expected Candidate material.');
  repository.commitAdmission({
    executionId: 'execution:supply', assessmentVersion: 'candidate-admission:v1', assessedAt: now,
    decisions: [{
      candidateId: candidate.candidateId,
      decision: 'admit',
      relevance,
      matchedInterestIds: [...matchedInterestIds],
      contentValue: 'substantive',
      novelty: 'novel',
      temporalValidity: 'valid',
      negativeConstraint: 'clear',
      reason: `${title} is useful.`,
      interestRevisions: matchedInterestIds.map((interestId) => ({ interestId, revision: 1 })),
      preferenceRevisions: matchedInterestIds.map((interestId) => ({
        scopeKey: `interest:${interestId}`, revision: 0,
      })),
      preferenceAlignment: [],
    }],
  });
  return candidate.candidateId;
}

interface PublishedBasisRow {
  readonly assessment_id: string | null;
  readonly assessment_version: string | null;
  readonly matched_interest_ids_json: string;
  readonly interest_revisions_json: string;
  readonly preference_revisions_json: string;
  readonly content_evidence_json: string;
}
