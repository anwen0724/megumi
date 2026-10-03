/* Verifies Recommendation's frozen Candidate reads, ordered expansion, and terminal publication tools. */
// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { resolveRecommendationDiscussion } from '@megumi/application/recommendation/recommendation-discussion';
import { createDatabase, migrateDatabase, type DatabaseConnection } from '@megumi/application/storage/index';
import {
  createRecommendationRepository,
} from '@megumi/application/recommendation/recommendation-storage';

import { createCandidateWorkset } from '@megumi/application/recommendation/daily/candidate-workset';
import { publishRecommendations, type RecommendationCandidate } from '@megumi/application/recommendation/daily/publish-recommendations';

const databases: DatabaseConnection[] = [];
const now = '2026-09-03T00:00:00.000Z';

describe('Recommendation tools', () => {
  afterEach(() => {
    for (const database of databases.splice(0)) database.close();
  });

  it('exposes only the initial working set before deterministic expansion', async () => {
    const { workset } = setup();

    await expect(workset.readRecommendationCandidate(tool('execution:1', { candidateId: 'candidate:3' })))
      .resolves.toMatchObject({ isError: true, content: { code: 'candidate_not_exposed' } });
    await expect(workset.expandRecommendationWorkingSet(tool('execution:1', {})))
      .resolves.toMatchObject({ content: { status: 'expanded', candidateIds: ['candidate:3'] } });
    await expect(workset.readRecommendationCandidate(tool('execution:1', { candidateId: 'candidate:3' })))
      .resolves.toMatchObject({ content: { status: 'read', candidate: { candidate: { id: 'candidate:3' } } } });
  });

  it('requires the actual target and accepts a draft without publishing it', async () => {
    const { workset, repository } = setup();
    await expect(workset.submitRecommendations(tool('execution:1', {
      items: [{ candidateId: 'candidate:1', recommendationReason: 'Relevant.' }],
    }))).resolves.toMatchObject({ isError: true, content: { code: 'selection_count_invalid' } });

    const result = await workset.submitRecommendations(tool('execution:1', {
      items: [
        { candidateId: 'candidate:1', recommendationReason: 'Relevant one.' },
        { candidateId: 'candidate:2', recommendationReason: 'Relevant two.' },
      ],
    }));

    expect(result).toMatchObject({ content: { status: 'accepted', count: 2 } });
    expect(repository.getCollection('2026-09-03', true)).toBeUndefined();
  });

  it('associates only a visible published recommendation with a new discussion', async () => {
    const { workset, repository } = setup();
    await workset.submitRecommendations(tool('execution:1', { items: [
      { candidateId: 'candidate:1', recommendationReason: 'Relevant one.' },
      { candidateId: 'candidate:2', recommendationReason: 'Relevant two.' },
    ] }));
    const publication = publishRecommendations({ workset, repository, publishedAt: now, signal: new AbortController().signal });
    if (publication.status !== 'published') throw new Error('Expected a published collection');
    const recommendationId = publication.collection.items[0].id;
    expect(resolveRecommendationDiscussion({ recommendationId }, repository)).toMatchObject({
      status: 'resolved', reference: { recommendationId, recommendationReason: 'Relevant one.' },
    });
    expect(resolveRecommendationDiscussion({ recommendationId, sessionId: 'existing' }, repository)).toMatchObject({
      status: 'rejected', error: { code: 'RECOMMENDATION_REQUIRES_NEW_SESSION' },
    });
    expect(resolveRecommendationDiscussion({ recommendationId: 'missing' }, repository)).toMatchObject({
      status: 'rejected', error: { code: 'RECOMMENDATION_NOT_FOUND' },
    });
  });
});

function setup() {
  const database = createDatabase({ filename: ':memory:' });
  databases.push(database);
  migrateDatabase({ database });
  for (let index = 1; index <= 3; index += 1) seedCandidate(database, index);
  let id = 0;
  const repository = createRecommendationRepository({
    database,
    ids: { createId: () => `generated:${++id}` },
    clock: { now: () => now },
  });
  const workset = createCandidateWorkset({
    requestId: 'request:1',
    localDate: '2026-09-03',
    snapshotAt: now,
    actualTarget: 2,
    workingSetCount: 2,
    rankedCandidates: [candidate(1), candidate(2), candidate(3)],
    exclusions: [],
    interestRevisions: [{ interestId: 'interest:1', revision: 1 }],
    preferenceRevisions: [],
    interests: [],
    preferences: [],
    history: [],
  });
  return { workset, repository };
}

function candidate(index: number): RecommendationCandidate {
  return {
    candidate: {
      id: `candidate:${index}`,
      contentIdentity: `identity:${index}`,
      sourceId: 'source:1',
      canonicalUrl: `https://example.com/${index}`,
      contentType: 'article',
      title: `Candidate ${index}`,
      contentSummary: `Summary ${index}`,
      contentTruncated: false,
      status: 'available',
      createdAt: now,
      expiresAt: '2026-09-04T00:00:00.000Z',
    },
    sourceName: 'Source One',
    interestMatches: [{
      id: `match:${index}`,
      candidateId: `candidate:${index}`,
      interestId: 'interest:1',
      relevance: 'direct',
      matchReason: 'Direct match.',
    }],
  };
}

function seedCandidate(database: DatabaseConnection, index: number): void {
  database.prepare({ sql: `
    INSERT INTO discovery_candidates (
      id, content_identity, source_id, canonical_url, content_type, title,
      content_summary, content_truncated, status, created_at, expires_at
    ) VALUES (?, ?, 'source:1', ?, 'article', ?, ?, 0, 'available', ?, ?)
  ` }).run([
    `candidate:${index}`, `identity:${index}`, `https://example.com/${index}`,
    `Candidate ${index}`, `Summary ${index}`, now, '2026-09-04T00:00:00.000Z',
  ]);
}

function tool(executionId: string, input: unknown) {
  return { executionId, input, signal: new AbortController().signal };
}
