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
        interestRevisions: [], preferenceRevisions: [], preferenceAlignment: [],
        reason: 'Useful.',
      }],
    })).toThrow('requires a matching active Interest');
    expect(repository.readCandidate(candidateId)?.status).toBe('pending_admission');
  });

  it('rejects inconsistent semantic duplicate assessments outside the provided duplicate set', () => {
    const hidden = searchOne(
      repository, 'query:hidden', 'https://example.com/hidden', 'Seasonal cooking guide',
    ).candidates[0]!;
    const candidate = searchOne(repository, 'query:subject', 'https://different.example.net/subject').candidates[0]!;

    expect(() => repository.commitAdmission({
      executionId: 'execution:1', assessmentVersion: 'candidate-admission:v1', assessedAt: now,
      decisions: [{
        candidateId: candidate.candidateId, decision: 'reject', relevance: 'none', matchedInterestIds: [],
        contentValue: 'substantive', novelty: 'semantic_duplicate', temporalValidity: 'valid',
        negativeConstraint: 'clear', reasonCode: 'semantic_duplicate',
        interestRevisions: [], preferenceRevisions: [], preferenceAlignment: [],
        duplicateOfCandidateId: hidden.candidateId, reason: 'Duplicate.',
      }],
    })).toThrow('provided potential duplicate set');
    expect(repository.readCandidate(candidate.candidateId)?.status).toBe('pending_admission');
  });

  it('rejects a reason code that contradicts the structured assessment dimensions', () => {
    const candidateId = searchOne(repository).candidates[0]!.candidateId;

    expect(() => repository.commitAdmission({
      executionId: 'execution:1', assessmentVersion: 'candidate-admission:v1', assessedAt: now,
      decisions: [{
        candidateId, decision: 'reject', relevance: 'direct',
        matchedInterestIds: [repository.listInterests()[0]!.interestId],
        contentValue: 'substantive', novelty: 'novel', temporalValidity: 'valid',
        negativeConstraint: 'clear', reasonCode: 'stale', reason: 'Contradictory.',
        interestRevisions: [{ interestId: repository.listInterests()[0]!.interestId, revision: 1 }],
        preferenceRevisions: [], preferenceAlignment: [],
      }],
    })).toThrow('does not match its assessment dimensions');
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

  it('derives Query yield from currently available Candidates rather than stale admit assessments', () => {
    for (const [index, queryId] of ['query:1', 'query:2'].entries()) {
      repository.beginQuery({
        queryId, executionId: 'execution:1', sourceId: 'open_web', query: 'same query',
        mode: 'relevance', targetInterestIds: [], startedAt: now,
      });
      const candidate = repository.commitSearchResult({
        queryId, completedAt: now, hardLimit: 20,
        items: [content('open_web', `https://example.com/yield-${index}`)],
      }).candidates[0]!;
      repository.commitAdmission({
        executionId: 'execution:1', assessmentVersion: 'candidate-admission:v1', assessedAt: now,
        decisions: [{
          candidateId: candidate.candidateId, decision: 'admit', relevance: 'exploration',
          matchedInterestIds: [], contentValue: 'substantive', novelty: 'novel',
          temporalValidity: 'valid', negativeConstraint: 'clear', reason: 'Useful exploration.',
          interestRevisions: [], preferenceRevisions: [], preferenceAlignment: [],
        }],
      });
    }
    database.prepare({ sql: "UPDATE discovery_candidates SET status = 'expired'" }).run();

    expect(repository.isQueryCoolingDown({
      sourceId: 'open_web', query: 'same query', mode: 'relevance', targetInterestIds: [],
      now: '2026-08-27T01:00:00.000Z',
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

  it('expires unfinished Candidate material after twenty-four hours', () => {
    const candidate = searchOne(repository).candidates[0]!;

    repository.getPoolSnapshot({
      now: '2026-08-28T00:00:00.000Z', dailyTargetCount: 1, proactiveTargetCount: 0,
    });

    expect(repository.readCandidate(candidate.candidateId)?.status).toBe('expired');
  });

  it('does not evict the last available Candidate covering an active Interest', () => {
    const first = searchOne(repository).candidates[0]!;
    repository.commitAdmission({
      executionId: 'execution:1', assessmentVersion: 'candidate-admission:v1', assessedAt: now,
      decisions: [admit(first.candidateId, repository.listInterests()[0]!.interestId)],
    });
    repository.beginQuery({
      queryId: 'query:capacity', executionId: 'execution:1', sourceId: 'open_web',
      query: 'new material', mode: 'relevance', targetInterestIds: [], startedAt: now,
    });

    const result = repository.commitSearchResult({
      queryId: 'query:capacity', completedAt: now, hardLimit: 1,
      items: [content('open_web', 'https://example.com/new', 'A different systems guide')],
    });

    expect(result.query).toMatchObject({ capacityRejectedCount: 1, newCandidateCount: 0 });
    expect(repository.readCandidate(first.candidateId)?.status).toBe('available');
  });
});

function searchOne(
  repository: DiscoveryRepository,
  queryId = 'query:1',
  url = 'https://example.com/article',
  title = 'A practical Agent architecture guide',
) {
  repository.beginQuery({
    queryId, executionId: 'execution:1', sourceId: 'open_web', query: queryId,
    mode: 'relevance', targetInterestIds: [], startedAt: now,
  });
  return repository.commitSearchResult({
    queryId, completedAt: now, hardLimit: 20, items: [content('open_web', url, title)],
  });
}

function content(
  sourceId: 'open_web' | 'zhihu',
  url = 'https://www.zhihu.com/question/1/answer/2',
  title = 'A practical Agent architecture guide',
) {
  return {
    sourceId,
    sourceName: sourceId === 'zhihu' ? '知乎' : 'Web',
    sourceContentId: sourceId === 'zhihu' ? 'answer:2' : undefined,
    canonicalUrl: url,
    contentType: 'article' as const,
    title,
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
    interestRevisions: [{ interestId, revision: 1 }],
    preferenceRevisions: [{ scopeKey: `interest:${interestId}`, revision: 0 }],
    preferenceAlignment: [],
    reason: 'Directly useful to the active Interest.',
  };
}
