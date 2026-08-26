/* Verifies Candidate Supply persistence at the stable Pool and admission boundary. */
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, migrateDatabase, type DatabaseConnection } from '@megumi/database';
import {
  createDiscoveryRepository,
  type CandidateAdmissionDecision,
  type DiscoveryRepository,
} from '@megumi/discovery';

const now = '2026-08-27T00:00:00.000Z';

describe('CandidateSupplyRepository', () => {
  let database: DatabaseConnection;
  let repository: DiscoveryRepository;

  beforeEach(() => {
    database = createDatabase({ filename: ':memory:' });
    migrateDatabase({ database });
    repository = createDiscoveryRepository({ database });
    repository.changeInterest({
      action: 'create', interestId: 'interest:1', description: 'Agent architecture', now,
    });
  });
  afterEach(() => database.close());

  it('atomically persists a Query and merges stable Candidate identities', () => {
    const interestId = repository.listInterests()[0]?.interestId;
    expect(interestId).toBeDefined();
    repository.beginQuery({
      queryId: 'query:1', executionId: 'execution:1', sourceId: 'open_web',
      query: '  Agent   Architecture ', mode: 'relevance',
      targetInterestIds: [interestId!], startedAt: now,
    });

    const result = repository.commitSearchResult({
      queryId: 'query:1', completedAt: now, hardLimit: 20,
      items: [content('open_web'), content('zhihu')],
    });

    expect(result.query).toMatchObject({
      status: 'succeeded', normalizedQuery: 'agent architecture',
      rawResultCount: 2, newCandidateCount: 1, mergedCandidateCount: 1,
    });
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      status: 'pending_admission', primarySourceId: 'zhihu',
    });
    expect(database.prepare<{ count: number }>({
      sql: 'SELECT COUNT(*) AS count FROM discovery_candidate_sources',
    }).get()?.count).toBe(2);
  });

  it('commits one complete assessment and Interest relation in one transaction', () => {
    const interestId = repository.listInterests()[0]!.interestId;
    const candidateId = searchOne(repository).candidates[0]!.candidateId;

    const [candidate] = repository.commitAdmission({
      executionId: 'execution:1', assessmentVersion: 'candidate-admission:v1', assessedAt: now,
      decisions: [admit(candidateId, interestId)],
    });

    expect(candidate?.status).toBe('available');
    const snapshot = repository.getPoolSnapshot({
      now, dailyTargetCount: 1, proactiveTargetCount: 0,
    });
    expect(snapshot.counts.available).toBe(1);
    expect(snapshot.gap.uncoveredInterestIds).toEqual([]);
  });

  it('rolls back the whole admission batch when one decision is invalid', () => {
    const first = searchOne(repository, 'query:1', 'https://example.com/a').candidates[0]!;
    const second = searchOne(repository, 'query:2', 'https://example.com/b').candidates[0]!;
    const interestId = repository.listInterests()[0]!.interestId;

    expect(() => repository.commitAdmission({
      executionId: 'execution:1', assessmentVersion: 'candidate-admission:v1', assessedAt: now,
      decisions: [admit(first.candidateId, interestId), admit(second.candidateId, 'interest:missing')],
    })).toThrow('Active Interest not found');

    expect(repository.readCandidate(first.candidateId)?.status).toBe('pending_admission');
    expect(repository.readCandidate(second.candidateId)?.status).toBe('pending_admission');
  });

  it('keeps an assessment failure distinct from a business rejection', () => {
    const candidateId = searchOne(repository).candidates[0]!.candidateId;
    expect(() => repository.commitAdmission({
      executionId: 'execution:1', assessmentVersion: 'candidate-admission:v1', assessedAt: now,
      decisions: [{
        candidateId,
        decision: 'admit',
        relevance: 'direct',
        matchedInterestIds: [],
        contentValue: 'substantive',
        novelty: 'novel',
        temporalValidity: 'valid',
        negativeConstraint: 'clear',
        reason: 'Useful.',
      }],
    })).toThrow('requires a matching active Interest');
    expect(repository.readCandidate(candidateId)?.status).toBe('pending_admission');
  });

  it('reports the low-watermark and zero-coverage gaps deterministically', () => {
    const snapshot = repository.getPoolSnapshot({
      now, dailyTargetCount: 4, proactiveTargetCount: 2,
    });
    expect(snapshot.thresholds).toEqual({ lowWatermark: 6, target: 10, hardLimit: 20 });
    expect(snapshot.gap.totalShortfall).toBe(10);
    expect(snapshot.gap.uncoveredInterestIds).toHaveLength(1);
  });

  it('cools down only after two settled zero-admission Query outcomes', () => {
    for (const queryId of ['query:1', 'query:2']) {
      repository.beginQuery({
        queryId, executionId: 'execution:1', sourceId: 'open_web', query: 'same query',
        mode: 'relevance', targetInterestIds: [], startedAt: now,
      });
      repository.commitSearchResult({
        queryId, completedAt: now, hardLimit: 20,
        items: [content('open_web', `https://example.com/${queryId}`)],
      });
    }
    expect(repository.isQueryCoolingDown({
      sourceId: 'open_web', query: 'same query', mode: 'relevance', targetInterestIds: [], now,
    })).toBe(true);
  });

  it('persists Source failure backoff and clears it after success', () => {
    expect(repository.settleSourceAttempt({
      sourceId: 'source:1', result: 'failed', failureCode: 'network_error', now,
    })).toMatchObject({
      consecutiveFailureCount: 1,
      retryAt: '2026-08-27T00:05:00.000Z',
    });
    expect(repository.settleSourceAttempt({
      sourceId: 'source:1', result: 'success', now: '2026-08-27T00:06:00.000Z',
    })).toMatchObject({ consecutiveFailureCount: 0 });
    expect(repository.readSourceState('source:1')?.retryAt).toBeUndefined();
  });
});

function searchOne(
  repository: DiscoveryRepository,
  queryId = 'query:1',
  url = 'https://example.com/article',
) {
  repository.beginQuery({
    queryId, executionId: 'execution:1', sourceId: 'open_web', query: queryId,
    mode: 'relevance', targetInterestIds: [], startedAt: now,
  });
  return repository.commitSearchResult({
    queryId, completedAt: now, hardLimit: 20, items: [content('open_web', url)],
  });
}

function content(sourceId: 'open_web' | 'zhihu', url = 'https://www.zhihu.com/question/1/answer/2') {
  return {
    sourceId,
    sourceName: sourceId === 'zhihu' ? '知乎' : 'Web',
    sourceContentId: sourceId === 'zhihu' ? 'answer:2' : undefined,
    canonicalUrl: url,
    contentType: 'article' as const,
    title: 'A practical Agent architecture guide',
    description: 'A concrete guide with architecture trade-offs and implementation examples.',
  };
}

function admit(candidateId: string, interestId: string): CandidateAdmissionDecision {
  return {
    candidateId,
    decision: 'admit',
    relevance: 'direct',
    matchedInterestIds: [interestId],
    contentValue: 'substantive',
    novelty: 'novel',
    temporalValidity: 'valid',
    negativeConstraint: 'clear',
    reason: 'Directly useful to the active Interest.',
  };
}
