/* Verifies Candidate Supply Tool operations persist facts before returning model-visible results. */
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, migrateDatabase, type DatabaseConnection } from '@megumi/database';
import {
  createCandidateSupplyAttempts,
  createDiscoveryRepository,
  createSourceRegistry,
  type DiscoveryRepository,
  type DiscoverySource,
} from '@megumi/discovery';

const now = '2026-08-27T00:00:00.000Z';

describe('CandidateSupplyAttempts', () => {
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

  it('returns a persisted admission batch and commits the typed assessment', async () => {
    const attempts = createCandidateSupplyAttempts();
    attempts.start({
      executionId: 'execution:1', repository, sourceRegistry: createSourceRegistry([source()]),
      enabledSourceIds: ['source:1'], initialCandidateIds: [],
      getSnapshot: () => repository.getPoolSnapshot({ now, dailyTargetCount: 1, proactiveTargetCount: 0 }),
      now: () => now,
    });

    const searched = await attempts.searchContent({
      executionId: 'execution:1', signal: new AbortController().signal,
      input: {
        sourceId: 'source:1', query: 'Agent architecture', mode: 'relevance', limit: 10,
        targetInterestIds: ['interest:1'],
      },
    });
    expect(searched.isError).not.toBe(true);
    const searchedContent = searched.content as { admissionBatch: Array<{ candidate: { candidateId: string } }> };
    const candidateId = searchedContent.admissionBatch[0]!.candidate.candidateId;
    expect(repository.readCandidate(candidateId)?.status).toBe('pending_admission');

    const committed = await attempts.commitCandidateAdmission({
      executionId: 'execution:1', signal: new AbortController().signal,
      input: { decisions: [{
        candidateId, decision: 'admit', relevance: 'direct', matchedInterestIds: ['interest:1'],
        contentValue: 'substantive', novelty: 'novel', temporalValidity: 'valid',
        negativeConstraint: 'clear', reason: 'Useful implementation detail.',
      }] },
    });
    expect(committed.isError).not.toBe(true);
    expect(repository.readCandidate(candidateId)?.status).toBe('available');
  });

  it('keeps Source and business commits successful when diagnostic capture throws', async () => {
    const throwingObservability = {
      withTrace: () => { throw new Error('trace unavailable'); },
      withSpan: () => { throw new Error('span unavailable'); },
      recordContent: () => { throw new Error('content unavailable'); },
      recordEvent: () => { throw new Error('event unavailable'); },
      linkTrace: () => { throw new Error('link unavailable'); },
    } as import('@megumi/observability').Observability;
    const attempts = createCandidateSupplyAttempts({ observability: throwingObservability });
    attempts.start({
      executionId: 'execution:1', repository, sourceRegistry: createSourceRegistry([source()]),
      enabledSourceIds: ['source:1'], initialCandidateIds: [],
      getSnapshot: () => repository.getPoolSnapshot({ now, dailyTargetCount: 1, proactiveTargetCount: 0 }),
      now: () => now,
    });

    const result = await attempts.searchContent({
      executionId: 'execution:1', signal: new AbortController().signal,
      input: { sourceId: 'source:1', query: 'Agent', mode: 'recent', limit: 1, targetInterestIds: [] },
    });
    expect(result.isError).not.toBe(true);
    expect(repository.listRecentQueryOutcomes({ now, withinDays: 30, limit: 10 }))
      .toMatchObject([{ status: 'succeeded', newCandidateCount: 1 }]);
  });
});

function source(): DiscoverySource {
  return {
    descriptor: {
      id: 'source:1', name: 'Source 1', access: 'public_http',
      supportedModes: ['relevance', 'recent'], supportsRead: true,
    },
    getAvailability: () => ({ state: 'ready' }),
    async search() {
      return {
        status: 'success',
        items: [{
          sourceId: 'source:1', sourceName: 'Source 1', sourceContentId: 'article:1',
          canonicalUrl: 'https://example.com/article/1', contentType: 'article',
          title: 'Agent architecture', description: 'Concrete patterns and implementation trade-offs.',
        }],
      };
    },
    async read() {
      return {
        status: 'success',
        detail: {
          sourceId: 'source:1', sourceName: 'Source 1', sourceContentId: 'article:1',
          canonicalUrl: 'https://example.com/article/1', contentType: 'article',
          title: 'Agent architecture', contentText: 'Full implementation detail.',
        },
      };
    },
  };
}
