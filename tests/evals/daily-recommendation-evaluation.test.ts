/*
 * Verifies Daily Recommendation Evaluation against fixed behavior Cases and
 * Recommendation facts committed through the real transactional repository.
 */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createDatabase, migrateDatabase } from '@megumi/database';
import {
  createDailyRecommendationRepository,
  createDiscoveryRepository,
  type DiscoveryRepository,
} from '@megumi/discovery';
import {
  DAILY_RECOMMENDATION_FIXED_CASES,
  evaluateDailyRecommendationCase,
  type DailyRecommendationEvaluationCase,
} from '../../evals/agent/daily-recommendation';

const now = '2026-08-27T08:00:00.000Z';

describe('Daily Recommendation Evaluation', () => {
  it('passes every fixed Agent Behavior Case and covers the required decision conditions', () => {
    const results = DAILY_RECOMMENDATION_FIXED_CASES.map(evaluateDailyRecommendationCase);

    expect(results.every(({ passed }) => passed)).toBe(true);
    expect(DAILY_RECOMMENDATION_FIXED_CASES.map(({ caseId }) => caseId)).toEqual([
      'mixed-relevance-interest-and-feedback',
      'read-full-content-on-demand',
      'publication-conflict-replacement',
      'candidate-shortage',
    ]);
    expect(new Set(DAILY_RECOMMENDATION_FIXED_CASES.flatMap(({ windowCandidates }) => (
      windowCandidates.map(({ relevance }) => relevance)
    )))).toEqual(new Set(['direct', 'adjacent', 'exploration']));
    expect(new Set(DAILY_RECOMMENDATION_FIXED_CASES.flatMap(({ feedback }) => (
      feedback.map(({ signal }) => signal)
    )))).toEqual(new Set(['liked', 'disliked', 'hidden', 'favorite', 'watch_later']));
  });

  it('reports selection, coverage, relevance, Tool use, and publication conflicts from replayable facts', () => {
    const result = evaluateDailyRecommendationCase(requireCase('publication-conflict-replacement'));

    expect(result.metrics).toEqual({
      requestedCount: 2,
      actualTarget: 2,
      windowCount: 3,
      publishedCount: 2,
      interestCoverage: { window: 2, published: 2 },
      relevance: {
        window: { direct: 2, adjacent: 1, exploration: 0 },
        published: { direct: 1, adjacent: 1, exploration: 0 },
      },
      calls: { model: 2, read: 0, publish: 2 },
      publicationAttempts: 2,
      conflicts: 1,
    });
  });

  it('fails explicitly when Tool output and persisted Recommendation facts diverge', () => {
    const source = requireCase('candidate-shortage');
    const invalid: DailyRecommendationEvaluationCase = {
      ...source,
      observation: {
        ...source.observation,
        recommendations: [
          { candidateId: 'candidate:outside-window', recommendationReason: '' },
          source.observation.recommendations[1]!,
        ],
      },
    };

    const result = evaluateDailyRecommendationCase(invalid);

    expect(result.passed).toBe(false);
    expect(result.issues.map(({ code }) => code)).toEqual(expect.arrayContaining([
      'candidate_outside_window',
      'missing_recommendation_reason',
      'publication_table_mismatch',
      'unexpected_selection',
    ]));
  });

  it('recomputes a passing report from a fixed clock, temporary database, Tool call, and business rows', () => {
    const database = createDatabase({ filename: ':memory:' });
    try {
      migrateDatabase({ database });
      const discovery = createDiscoveryRepository({ database });
      discovery.changeInterest({
        action: 'create', interestId: 'interest:agents', description: 'Agent runtime', now,
      });
      discovery.changeInterest({
        action: 'create', interestId: 'interest:typescript', description: 'TypeScript contracts', now,
      });
      const direct = admitCandidate(discovery, 'direct', ['interest:agents'], 'Runtime boundaries');
      const adjacent = admitCandidate(discovery, 'adjacent', ['interest:typescript'], 'Typed tool contracts');
      const exploration = admitCandidate(discovery, 'exploration', [], 'Local first systems');
      const repository = createDailyRecommendationRepository(database);
      const snapshot = repository.readSnapshot({ now, requestedCount: 3 });
      const selectedCandidateIds = [direct, adjacent, exploration];
      repository.claimBatch({
        batchId: 'batch:evaluation', localDate: '2026-08-27', timezone: 'Asia/Shanghai',
        executionId: 'execution:evaluation', requestedCount: 3,
        actualTarget: snapshot.window.actualTarget, now,
      });
      const publication = repository.publish({
        batchId: 'batch:evaluation', executionId: 'execution:evaluation', publishedAt: now,
        allowedCandidateIds: snapshot.window.candidates.map(({ candidateId }) => candidateId),
        items: selectedCandidateIds.map((candidateId, index) => ({
          recommendationId: `recommendation:${index}`,
          candidateId,
          recommendationReason: `Fixed reason ${index}.`,
        })),
      });
      if (publication.status !== 'published') throw new Error('Expected fixed Evaluation publication to succeed.');
      const evaluationCase: DailyRecommendationEvaluationCase = {
        caseId: 'repository-facts',
        description: 'Reconstructs metrics from a real temporary Repository transaction.',
        fixedNow: now,
        activeInterestIds: snapshot.activeInterests.map(({ interestId }) => interestId),
        windowCandidates: snapshot.window.candidates.map((candidate) => ({
          candidateId: candidate.candidateId,
          contentIdentity: candidate.contentIdentity,
          topicKey: candidate.title,
          relevance: candidate.admission.relevance,
          matchedInterestIds: candidate.admission.matchedInterestIds,
          summarySufficient: true,
        })),
        recentTopicKeys: [],
        feedback: [],
        observation: {
          batch: {
            requestedCount: publication.batch.requestedCount,
            actualTarget: publication.batch.actualTarget,
          },
          modelCallCount: 1,
          toolCalls: [{
            name: 'publish_daily_recommendations',
            candidateIds: selectedCandidateIds,
            status: publication.status,
          }],
          recommendations: publication.recommendations.map((recommendation) => ({
            candidateId: requireCandidateId(recommendation.candidateId),
            recommendationReason: recommendation.recommendationReason,
          })),
        },
        expected: {
          selectedCandidateIds,
          readCandidateIds: [],
          publicationStatuses: ['published'],
        },
      };

      const report = evaluateDailyRecommendationCase(evaluationCase);

      expect(report).toMatchObject({
        passed: true,
        metrics: {
          requestedCount: 3,
          actualTarget: 3,
          windowCount: 3,
          publishedCount: 3,
          interestCoverage: { window: 2, published: 2 },
          relevance: {
            window: { direct: 1, adjacent: 1, exploration: 1 },
            published: { direct: 1, adjacent: 1, exploration: 1 },
          },
          calls: { model: 1, read: 0, publish: 1 },
          publicationAttempts: 1,
          conflicts: 0,
        },
      });
    } finally {
      database.close();
    }
  });
});

function requireCase(caseId: string): DailyRecommendationEvaluationCase {
  const evaluationCase = DAILY_RECOMMENDATION_FIXED_CASES.find((item) => item.caseId === caseId);
  if (!evaluationCase) throw new Error(`Missing fixed Daily Recommendation Case: ${caseId}`);
  return evaluationCase;
}

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
  const material = repository.commitSearchResult({
    queryId: `query:${suffix}`, completedAt: now, hardLimit: 100,
    items: [{
      sourceId: 'open_web', sourceName: 'example.com', sourceContentId: suffix,
      canonicalUrl: `https://example.com/${suffix}`, contentType: 'article', title,
      description: `${title} with enough fixed Evaluation detail.`,
    }],
  }).candidates[0];
  if (!material) throw new Error('Expected fixed Candidate material.');
  repository.commitAdmission({
    executionId: 'execution:supply', assessmentVersion: 'candidate-admission:v1', assessedAt: now,
    decisions: [{
      candidateId: material.candidateId,
      decision: 'admit',
      relevance,
      matchedInterestIds: [...matchedInterestIds],
      contentValue: 'substantive',
      novelty: 'novel',
      temporalValidity: 'valid',
      negativeConstraint: 'clear',
      reason: `${title} is useful.`,
    }],
  });
  return material.candidateId;
}

function requireCandidateId(candidateId: string | undefined): string {
  if (!candidateId) throw new Error('Expected published Recommendation to retain its Candidate ID.');
  return candidateId;
}
