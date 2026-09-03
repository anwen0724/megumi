/* Verifies Candidate Supply Agent tools keep search evidence transient and persist only submitted facts. */
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDatabase, migrateDatabase, type DatabaseConnection } from '@megumi/database';
import {
  createCandidateSupplyAttempts,
  createCandidateSupplyRepository,
  createDiscoveryRepository,
  createSourceRegistry,
  type CandidateSupplyRepository,
  type DiscoverySource,
} from '@megumi/discovery';

const now = '2026-09-03T00:00:00.000Z';
const settings = {
  minimumCount: 1,
  targetCount: 4,
  maximumCount: 5,
  candidateValidityDays: 30,
  candidateContentExcerptMaxCharacters: 8_000,
};

describe('CandidateSupplyAttempts', () => {
  let database: DatabaseConnection;
  let repository: CandidateSupplyRepository;

  beforeEach(() => {
    database = createDatabase({ filename: ':memory:' });
    migrateDatabase({ database });
    createDiscoveryRepository({ database }).applyInterestChange({
      action: 'create', interestId: 'interest:1', description: 'Agent architecture', now,
    });
    let candidate = 0;
    let match = 0;
    repository = createCandidateSupplyRepository({
      database,
      clock: { now: () => now },
      ids: {
        createCandidateId: () => `candidate:${++candidate}`,
        createInterestMatchId: () => `match:${++match}`,
      },
    });
  });

  afterEach(() => database.close());

  it('keeps Source search results out of business tables until the Agent submits them', async () => {
    const attempts = createCandidateSupplyAttempts();
    attempts.start(attemptInput(repository, source()));

    const searched = await attempts.searchContent(toolRequest({
      sourceId: 'source:1',
      query: 'Agent architecture',
      mode: 'relevance',
      limit: 10,
      targetInterestIds: ['interest:1'],
    }));

    expect(searched).toMatchObject({
      content: {
        status: 'success',
        results: [expect.objectContaining({
          resultId: expect.any(String),
          content: expect.objectContaining({ title: 'Agent architecture' }),
        })],
      },
    });
    expect(database.prepare<{ count: number }>({
      sql: 'SELECT COUNT(*) AS count FROM discovery_candidates',
    }).get()?.count).toBe(0);

    const resultId = (searched.content as { results: Array<{ resultId: string }> }).results[0]!.resultId;
    const submitted = await attempts.submitCandidates(toolRequest({
      items: [{
        resultId,
        contentSummary: 'A grounded summary of Agent architecture patterns.',
        matches: [{
          interestId: 'interest:1',
          relevance: 'direct',
          matchReason: 'Directly discusses Agent architecture.',
        }],
      }],
    }));

    expect(submitted).toMatchObject({
      content: {
        status: 'submitted',
        addedCandidateCount: 1,
        addedInterestMatchCount: 1,
      },
    });
    expect(repository.findCandidateById('candidate:1')).toMatchObject({
      candidate: {
        status: 'available',
        contentSummary: 'A grounded summary of Agent architecture patterns.',
        contentExcerpt: 'Concrete patterns and implementation trade-offs.',
        contentTruncated: false,
      },
    });
  });

  it('keeps Source detail transient until submission and then persists bounded evidence', async () => {
    const attempts = createCandidateSupplyAttempts();
    attempts.start(attemptInput(repository, source()));
    const searched = await attempts.searchContent(toolRequest({
      sourceId: 'source:1', query: 'Agent', mode: 'recent', limit: 1, targetInterestIds: [],
    }));
    const resultId = (searched.content as { results: Array<{ resultId: string }> }).results[0]!.resultId;

    const read = await attempts.readSourceCandidate(toolRequest({ resultId }));

    expect(read).toMatchObject({
      content: {
        status: 'success',
        result: {
          resultId,
          content: expect.objectContaining({ contentText: 'Full implementation detail.' }),
        },
      },
    });
    expect(database.prepare<{ count: number }>({
      sql: 'SELECT COUNT(*) AS count FROM discovery_candidates',
    }).get()?.count).toBe(0);

    await attempts.submitCandidates(toolRequest({
      items: [{
        resultId,
        contentSummary: 'The Source explains implementation details.',
        matches: [{
          interestId: 'interest:1', relevance: 'direct', matchReason: 'Direct implementation guidance.',
        }],
      }],
    }));

    expect(repository.findCandidateById('candidate:1')).toMatchObject({
      candidate: {
        contentSummary: 'The Source explains implementation details.',
        contentExcerpt: 'Full implementation detail.',
        contentTruncated: false,
      },
      interestMatches: [expect.objectContaining({
        matchReason: 'Direct implementation guidance.',
      })],
    });
  });

  it('isolates one Source failure and permits a later Source call in the same execution', async () => {
    const failing = source('source:failed');
    failing.search = async () => ({
      status: 'failed',
      failure: { code: 'network_error', message: 'Unavailable.', retryable: true },
    });
    const attempts = createCandidateSupplyAttempts();
    attempts.start({
      ...attemptInput(repository, source()),
      sourceRegistry: createSourceRegistry([failing, source()]),
      enabledSourceIds: ['source:failed', 'source:1'],
    });

    await expect(attempts.searchContent(toolRequest({
      sourceId: 'source:failed', query: 'Agent', mode: 'recent', limit: 1, targetInterestIds: [],
    }))).resolves.toMatchObject({ isError: true, content: { code: 'network_error' } });
    await expect(attempts.searchContent(toolRequest({
      sourceId: 'source:1', query: 'Agent', mode: 'recent', limit: 1, targetInterestIds: [],
    }))).resolves.toMatchObject({ content: { status: 'success' } });
    expect(attempts.summarize('execution:1')).toMatchObject({
      sourceFailureCount: 1,
      searchResultCount: 1,
    });
  });

  it('records Source provider responses and normalized results as Trace evidence', async () => {
    const recordContent = vi.fn();
    const attempts = createCandidateSupplyAttempts({
      observability: {
        withTrace: async (_request, operation) => operation(),
        withSpan: async (_request, operation) => operation(),
        recordContent,
        recordEvent: () => undefined,
        linkTrace: () => undefined,
      },
    });
    attempts.start(attemptInput(repository, source()));

    await attempts.searchContent(toolRequest({
      sourceId: 'source:1', query: 'Agent', mode: 'recent', limit: 1, targetInterestIds: [],
    }));

    expect(recordContent).toHaveBeenCalledWith(expect.objectContaining({ kind: 'source.provider_response' }));
    expect(recordContent).toHaveBeenCalledWith(expect.objectContaining({ kind: 'source.result' }));
  });

  it('does not implement a Candidate Supply search or read budget', async () => {
    const attempts = createCandidateSupplyAttempts();
    attempts.start(attemptInput(repository, source()));

    for (let index = 0; index < 13; index += 1) {
      await expect(attempts.searchContent(toolRequest({
        sourceId: 'source:1',
        query: `Agent ${index}`,
        mode: 'relevance',
        limit: 1,
        targetInterestIds: ['interest:1'],
      }))).resolves.not.toMatchObject({ isError: true });
    }
  });
});

function attemptInput(repository: CandidateSupplyRepository, discoverySource: DiscoverySource) {
  return {
    executionId: 'execution:1',
    startedAt: now,
    trigger: 'startup' as const,
    repository,
    sourceRegistry: createSourceRegistry([discoverySource]),
    enabledSourceIds: [discoverySource.descriptor.id],
    settings,
    now: () => now,
  };
}

function toolRequest(input: unknown) {
  return {
    executionId: 'execution:1',
    signal: new AbortController().signal,
    input,
  };
}

function source(id = 'source:1'): DiscoverySource {
  return {
    descriptor: {
      id, name: id, access: 'public_http',
      supportedModes: ['relevance', 'recent'], supportsRead: true,
    },
    getAvailability: () => ({ state: 'ready' }),
    async search(request) {
      request.onProviderResponse?.({ status: 200, body: { items: 1 } });
      return {
        status: 'success',
        items: [{
          sourceId: id,
          sourceName: id,
          sourceContentId: 'article:1',
          canonicalUrl: `https://example.com/${id}/article/1`,
          contentType: 'article',
          title: 'Agent architecture',
          description: 'Concrete patterns and implementation trade-offs.',
        }],
      };
    },
    async read() {
      return {
        status: 'success',
        detail: {
          sourceId: id,
          sourceName: id,
          sourceContentId: 'article:1',
          canonicalUrl: `https://example.com/${id}/article/1`,
          contentType: 'article',
          title: 'Agent architecture',
          contentText: 'Full implementation detail.',
        },
      };
    },
  };
}
