/* Verifies Candidate Supply Agent tools keep search evidence transient and persist only submitted facts. */
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDatabase,
  migrateDatabase,
  type DatabaseConnection,
} from '@megumi/application/storage/index';
import { createCandidateSupplyRepository } from '@megumi/application/recommendation/candidates/candidate-storage';
import { createDiscoveryRepository } from '@megumi/application/recommendation/recommendation-storage';
import {
  createSourceRegistry,
  type DiscoverySource,
} from '@megumi/application/recommendation/sources/source-catalog';
import { type CandidateSupplyRepository } from '@megumi/application/recommendation/candidates/candidate-pool';

import {
  createCollectionTools,
  type CollectionTools,
} from '@megumi/application/recommendation/collection/agent-tools';

function invoke(
  collection: CollectionTools,
  name: string,
  request: ReturnType<typeof toolRequest>,
) {
  const tool = collection.tools.find((tool) => tool.name === name)!;
  return tool.execute(request.input, {
    runId: request.executionId,
    toolCallId: 'call',
    signal: request.signal,
    onOutput() {},
  });
}

const now = '2026-09-03T00:00:00.000Z';
const settings = {
  minimumCount: 1,
  targetCount: 4,
  maximumCount: 5,
  candidateValidityDays: 30,
  candidateContentExcerptMaxCharacters: 8_000,
};

describe('Collection tools', () => {
  let database: DatabaseConnection;
  let repository: CandidateSupplyRepository;

  beforeEach(() => {
    database = createDatabase({ filename: ':memory:' });
    migrateDatabase({ database });
    createDiscoveryRepository({ database }).applyInterestChange({
      action: 'create',
      interestId: 'interest:1',
      description: 'Agent architecture',
      now,
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
    const collection = createCollectionTools(attemptInput(repository, source()));

    const searched = await invoke(
      collection,
      'search_content',
      toolRequest({
        sourceId: 'source:1',
        query: 'Agent architecture',
        mode: 'relevance',
        limit: 10,
        targetInterestIds: ['interest:1'],
      }),
    );

    expect(searched).toMatchObject({
      content: {
        status: 'success',
        results: [
          expect.objectContaining({
            resultId: expect.any(String),
            content: expect.objectContaining({ title: 'Agent architecture' }),
          }),
        ],
      },
    });
    expect(
      database
        .prepare<{ count: number }>({
          sql: 'SELECT COUNT(*) AS count FROM discovery_candidates',
        })
        .get()?.count,
    ).toBe(0);

    const resultId = (searched.content as { results: Array<{ resultId: string }> }).results[0]!
      .resultId;
    const submitted = await invoke(
      collection,
      'submit_candidates',
      toolRequest({
        items: [
          {
            resultId,
            contentSummary: 'A grounded summary of Agent architecture patterns.',
            matches: [
              {
                interestId: 'interest:1',
                relevance: 'direct',
                matchReason: 'Directly discusses Agent architecture.',
              },
            ],
          },
        ],
      }),
    );

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
    const collection = createCollectionTools(attemptInput(repository, source()));
    const searched = await invoke(
      collection,
      'search_content',
      toolRequest({
        sourceId: 'source:1',
        query: 'Agent',
        mode: 'recent',
        limit: 1,
        targetInterestIds: [],
      }),
    );
    const resultId = (searched.content as { results: Array<{ resultId: string }> }).results[0]!
      .resultId;

    const read = await invoke(collection, 'read_source_candidate', toolRequest({ resultId }));

    expect(read).toMatchObject({
      content: {
        status: 'success',
        result: {
          resultId,
          content: expect.objectContaining({ contentText: 'Full implementation detail.' }),
        },
      },
    });
    expect(
      database
        .prepare<{ count: number }>({
          sql: 'SELECT COUNT(*) AS count FROM discovery_candidates',
        })
        .get()?.count,
    ).toBe(0);

    await invoke(
      collection,
      'submit_candidates',
      toolRequest({
        items: [
          {
            resultId,
            contentSummary: 'The Source explains implementation details.',
            matches: [
              {
                interestId: 'interest:1',
                relevance: 'direct',
                matchReason: 'Direct implementation guidance.',
              },
            ],
          },
        ],
      }),
    );

    expect(repository.findCandidateById('candidate:1')).toMatchObject({
      candidate: {
        contentSummary: 'The Source explains implementation details.',
        contentExcerpt: 'Full implementation detail.',
        contentTruncated: false,
      },
      interestMatches: [
        expect.objectContaining({
          matchReason: 'Direct implementation guidance.',
        }),
      ],
    });
  });

  it('isolates one Source failure and permits a later Source call in the same execution', async () => {
    const failing = source('source:failed');
    failing.search = async () => ({
      status: 'failed',
      failure: { code: 'network_error', message: 'Unavailable.', retryable: true },
    });
    const collection = createCollectionTools({
      ...attemptInput(repository, source()),
      sourceRegistry: createSourceRegistry([failing, source()]),
      enabledSourceIds: ['source:failed', 'source:1'],
    });

    await expect(
      invoke(
        collection,
        'search_content',
        toolRequest({
          sourceId: 'source:failed',
          query: 'Agent',
          mode: 'recent',
          limit: 1,
          targetInterestIds: [],
        }),
      ),
    ).resolves.toMatchObject({ isError: true, content: { code: 'network_error' } });
    await expect(
      invoke(
        collection,
        'search_content',
        toolRequest({
          sourceId: 'source:1',
          query: 'Agent',
          mode: 'recent',
          limit: 1,
          targetInterestIds: [],
        }),
      ),
    ).resolves.toMatchObject({ content: { status: 'success' } });
    expect(collection.summarize()).toMatchObject({
      sourceFailureCount: 1,
      searchResultCount: 1,
    });
  });

  it('records Source provider responses and normalized results as Trace evidence', async () => {
    const recordContent = vi.fn();
    const collection = createCollectionTools({
      ...attemptInput(repository, source()),
      observability: {
        withTrace: async (_request, operation) => operation(),
        withSpan: async (_request, operation) => operation(),
        recordContent,
        recordEvent: () => undefined,
        linkTrace: () => undefined,
      },
    });

    await invoke(
      collection,
      'search_content',
      toolRequest({
        sourceId: 'source:1',
        query: 'Agent',
        mode: 'recent',
        limit: 1,
        targetInterestIds: [],
      }),
    );

    expect(recordContent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'source.provider_response' }),
    );
    expect(recordContent).toHaveBeenCalledWith(expect.objectContaining({ kind: 'source.result' }));
  });

  it.each([
    {
      budget: { maxSearchCalls: 1, maxResultsPerSearch: 2, maxResultsPerAttempt: 10 },
      limits: [2],
    },
    {
      budget: { maxSearchCalls: 5, maxResultsPerSearch: 2, maxResultsPerAttempt: 3 },
      limits: [2, 1],
    },
  ])(
    'enforces configured Twitter search and result limits: $budget',
    async ({ budget, limits }) => {
      const requested: number[] = [];
      const twitter = source('twitter');
      twitter.search = async (request) => {
        requested.push(request.limit);
        return {
          status: 'success',
          items: Array.from({ length: request.limit }, (_, index) => ({
            sourceId: 'twitter',
            sourceName: 'Twitter',
            sourceContentId: String(index),
            canonicalUrl: `https://example.com/post/${index}`,
            contentType: 'post',
            title: 'Agent',
            description: 'Details',
          })),
        };
      };
      const collection = createCollectionTools({
        ...attemptInput(repository, twitter),
        twitterBudget: budget,
      });
      for (const limit of limits) {
        const result = await invoke(
          collection,
          'search_content',
          toolRequest({
            sourceId: 'twitter',
            query: 'Agent',
            mode: 'recent',
            limit: 20,
            targetInterestIds: [],
          }),
        );
        expect(result).toMatchObject({ content: { results: expect.any(Array) } });
        expect((result.content as { results: unknown[] }).results).toHaveLength(limit);
      }
      expect(
        await invoke(
          collection,
          'search_content',
          toolRequest({
            sourceId: 'twitter',
            query: 'More',
            mode: 'recent',
            limit: 20,
            targetInterestIds: [],
          }),
        ),
      ).toMatchObject({ isError: true });
      expect(requested).toEqual(limits);
    },
  );

  it('does not implement a Candidate Supply search or read budget', async () => {
    const collection = createCollectionTools(attemptInput(repository, source()));

    for (let index = 0; index < 13; index += 1) {
      await expect(
        invoke(
          collection,
          'search_content',
          toolRequest({
            sourceId: 'source:1',
            query: `Agent ${index}`,
            mode: 'relevance',
            limit: 1,
            targetInterestIds: ['interest:1'],
          }),
        ),
      ).resolves.not.toMatchObject({ isError: true });
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
    twitterBudget: { maxSearchCalls: 3, maxResultsPerSearch: 20, maxResultsPerAttempt: 40 },
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
      id,
      name: id,
      access: 'public_http',
      supportedModes: ['relevance', 'recent'],
      supportsRead: true,
    },
    getAvailability: () => ({ state: 'ready' }),
    async search(request) {
      request.onProviderResponse?.({ status: 200, body: { items: 1 } });
      return {
        status: 'success',
        items: [
          {
            sourceId: id,
            sourceName: id,
            sourceContentId: 'article:1',
            canonicalUrl: `https://example.com/${id}/article/1`,
            contentType: 'article',
            title: 'Agent architecture',
            description: 'Concrete patterns and implementation trade-offs.',
          },
        ],
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
