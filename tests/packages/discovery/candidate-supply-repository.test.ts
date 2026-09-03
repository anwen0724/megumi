/* Verifies Candidate Supply persistence at the Candidate and Candidate Pool boundary. */
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, migrateDatabase, type DatabaseConnection } from '@megumi/database';
import {
  createCandidateSupplyRepository,
  createDiscoveryRepository,
  type CandidateSupplyRepository,
  type DiscoveryRepository,
} from '@megumi/discovery';

const now = '2026-09-03T00:00:00.000Z';
const settings = {
  minimumCount: 2,
  maximumCount: 5,
  targetCount: 4,
  candidateValidityDays: 30,
};

describe('CandidateSupplyRepository', () => {
  let database: DatabaseConnection;
  let interests: DiscoveryRepository;
  let repository: CandidateSupplyRepository;
  let candidateSequence: number;
  let matchSequence: number;

  beforeEach(() => {
    database = createDatabase({ filename: ':memory:' });
    migrateDatabase({ database });
    interests = createDiscoveryRepository({ database });
    interests.applyInterestChange({
      action: 'create', interestId: 'interest:1', description: 'Agent architecture', now,
    });
    interests.applyInterestChange({
      action: 'create', interestId: 'interest:2', description: 'TypeScript', now,
    });
    candidateSequence = 0;
    matchSequence = 0;
    repository = createCandidateSupplyRepository({
      database,
      clock: { now: () => now },
      ids: {
        createCandidateId: () => `candidate:${++candidateSequence}`,
        createInterestMatchId: () => `candidate-interest-match:${++matchSequence}`,
      },
    });
  });

  afterEach(() => database.close());

  it('creates one Candidate and all active Interest matches atomically', () => {
    const result = repository.submitCandidate({
      content: content(),
      selectionReason: 'Directly covers Agent architecture.',
      matches: [
        { interestId: 'interest:1', relevance: 'direct' },
        { interestId: 'interest:2', relevance: 'adjacent' },
      ],
      settings,
    });

    expect(result).toMatchObject({
      status: 'created',
      candidate: {
        id: 'candidate:1',
        sourceId: 'source:1',
        status: 'available',
        selectionReason: 'Directly covers Agent architecture.',
        createdAt: now,
        expiresAt: '2026-10-03T00:00:00.000Z',
      },
      addedCandidateCount: 1,
      addedInterestMatchCount: 2,
    });
    expect(repository.findCandidateById('candidate:1')?.interestMatches).toHaveLength(2);
  });

  it('adds only missing active matches to an existing available Candidate', () => {
    repository.submitCandidate({
      content: content(),
      selectionReason: 'Initial relation.',
      matches: [{ interestId: 'interest:1', relevance: 'direct' }],
      settings,
    });

    const result = repository.submitCandidate({
      content: { ...content(), title: 'Changed metadata must not replace the original' },
      selectionReason: 'Another confirmed relation.',
      matches: [
        { interestId: 'interest:1', relevance: 'adjacent' },
        { interestId: 'interest:2', relevance: 'exploration' },
      ],
      settings,
    });

    expect(result).toMatchObject({
      status: 'matched_existing',
      candidate: { id: 'candidate:1', title: 'Agent architecture in practice' },
      addedCandidateCount: 0,
      addedInterestMatchCount: 1,
    });
    expect(repository.findCandidateById('candidate:1')?.interestMatches).toEqual([
      expect.objectContaining({ id: 'candidate-interest-match:1', interestId: 'interest:1', relevance: 'direct' }),
      expect.objectContaining({ id: 'candidate-interest-match:2', interestId: 'interest:2', relevance: 'exploration' }),
    ]);
  });

  it('ignores a duplicate that is already terminal and never revives it', () => {
    repository.submitCandidate({
      content: content(),
      selectionReason: 'Initial relation.',
      matches: [{ interestId: 'interest:1', relevance: 'direct' }],
      settings,
    });
    database.prepare({ sql: "UPDATE discovery_candidates SET status = 'consumed' WHERE id = 'candidate:1'" }).run();

    expect(repository.submitCandidate({
      content: content(),
      selectionReason: 'Rediscovered.',
      matches: [{ interestId: 'interest:2', relevance: 'direct' }],
      settings,
    })).toMatchObject({
      status: 'ignored',
      reason: 'terminal_duplicate',
      addedCandidateCount: 0,
      addedInterestMatchCount: 0,
    });
    expect(repository.findCandidateById('candidate:1')).toMatchObject({
      candidate: { status: 'consumed' },
      interestMatches: [expect.objectContaining({ interestId: 'interest:1' })],
    });
  });

  it('keeps only matches whose Interests are active at commit time', () => {
    interests.applyInterestChange({
      action: 'pause', interestId: 'interest:2', expectedRevision: 1, now,
    });

    const result = repository.submitCandidate({
      content: content(),
      selectionReason: 'Has one current relation.',
      matches: [
        { interestId: 'interest:1', relevance: 'direct' },
        { interestId: 'interest:2', relevance: 'direct' },
        { interestId: 'interest:missing', relevance: 'adjacent' },
      ],
      settings,
    });

    expect(result).toMatchObject({ status: 'created', addedInterestMatchCount: 1 });
    expect(repository.findCandidateById('candidate:1')?.interestMatches)
      .toEqual([expect.objectContaining({ interestId: 'interest:1' })]);
  });

  it('rolls back a new Candidate when no submitted Interest remains active', () => {
    interests.applyInterestChange({
      action: 'pause', interestId: 'interest:1', expectedRevision: 1, now,
    });

    expect(repository.submitCandidate({
      content: content(),
      selectionReason: 'No longer current.',
      matches: [{ interestId: 'interest:1', relevance: 'direct' }],
      settings,
    })).toMatchObject({ status: 'ignored', reason: 'no_active_interest' });
    expect(database.prepare<{ count: number }>({
      sql: 'SELECT COUNT(*) AS count FROM discovery_candidates',
    }).get()?.count).toBe(0);
  });

  it('derives the global Pool and per-Interest counts from active matches', () => {
    repository.submitCandidate({
      content: content('https://example.com/one'),
      selectionReason: 'Matches both.',
      matches: [
        { interestId: 'interest:1', relevance: 'direct' },
        { interestId: 'interest:2', relevance: 'adjacent' },
      ],
      settings,
    });
    repository.submitCandidate({
      content: content('https://example.com/two'),
      selectionReason: 'Matches TypeScript.',
      matches: [{ interestId: 'interest:2', relevance: 'direct' }],
      settings,
    });

    expect(repository.readCandidatePoolSnapshot(settings)).toMatchObject({
      asOf: now,
      minimumCount: 2,
      targetCount: 4,
      maximumCount: 5,
      availableCount: 2,
      minimumShortfall: 0,
      targetShortfall: 2,
      availableByInterest: { 'interest:1': 1, 'interest:2': 2 },
    });
  });

  it('lazily expires read candidates and excludes them from the same Pool read', () => {
    repository.submitCandidate({
      content: content(),
      selectionReason: 'Temporary.',
      matches: [{ interestId: 'interest:1', relevance: 'direct' }],
      settings: { ...settings, candidateValidityDays: 1 },
    });
    repository = createCandidateSupplyRepository({
      database,
      clock: { now: () => '2026-09-04T00:00:00.000Z' },
      ids: {
        createCandidateId: () => 'candidate:unexpected',
        createInterestMatchId: () => 'candidate-interest-match:unexpected',
      },
    });

    expect(repository.readCandidatePoolSnapshot(settings)).toMatchObject({ availableCount: 0, candidates: [] });
    expect(repository.findCandidateById('candidate:1')).toMatchObject({ candidate: { status: 'expired' } });
  });

  it('refuses new submissions once the current Pool reaches the target', () => {
    const capped = { ...settings, minimumCount: 1, maximumCount: 3, targetCount: 2 };
    for (const url of ['https://example.com/one', 'https://example.com/two']) {
      repository.submitCandidate({
        content: content(url),
        selectionReason: 'Related.',
        matches: [{ interestId: 'interest:1', relevance: 'direct' }],
        settings: capped,
      });
    }

    expect(repository.submitCandidate({
      content: content('https://example.com/three'),
      selectionReason: 'Related.',
      matches: [{ interestId: 'interest:1', relevance: 'direct' }],
      settings: capped,
    })).toMatchObject({ status: 'ignored', reason: 'capacity_reached' });
    expect(repository.readCandidatePoolSnapshot(capped).availableCount).toBe(2);
  });

  it('still adds a missing Interest match after the Pool reaches the target', () => {
    const capped = { ...settings, minimumCount: 1, maximumCount: 3, targetCount: 2 };
    const firstContent = content('https://example.com/one');
    repository.submitCandidate({
      content: firstContent,
      selectionReason: 'Related to Agent architecture.',
      matches: [{ interestId: 'interest:1', relevance: 'direct' }],
      settings: capped,
    });
    repository.submitCandidate({
      content: content('https://example.com/two'),
      selectionReason: 'Related to Agent architecture.',
      matches: [{ interestId: 'interest:1', relevance: 'direct' }],
      settings: capped,
    });

    expect(repository.submitCandidate({
      content: firstContent,
      selectionReason: 'Also related to TypeScript.',
      matches: [{ interestId: 'interest:2', relevance: 'adjacent' }],
      settings: capped,
    })).toMatchObject({
      status: 'matched_existing',
      addedCandidateCount: 0,
      addedInterestMatchCount: 1,
    });
    expect(repository.readCandidatePoolSnapshot(capped).availableByInterest).toEqual({
      'interest:1': 2,
      'interest:2': 1,
    });
  });
});

function content(url = 'https://example.com/article') {
  return {
    sourceId: 'source:1',
    sourceName: 'Source 1',
    sourceContentId: url.split('/').at(-1),
    canonicalUrl: url,
    contentType: 'article' as const,
    title: 'Agent architecture in practice',
    description: 'Concrete implementation patterns.',
  };
}
