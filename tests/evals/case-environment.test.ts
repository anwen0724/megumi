/* Verifies that every Evaluation Case runs inside its own real Product environment. */
// @vitest-environment node
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadCase } from '../../evals/agent/datasets/dataset-loader';
import { createCaseEnvironment } from '../../evals/agent/run/case-environment';
import { createDatabase } from '@megumi/database';
import { getDiscoveryState } from '@megumi/discovery';

let temporaryRoot: string | undefined;

afterEach(() => {
  if (temporaryRoot) rmSync(temporaryRoot, { recursive: true, force: true });
  temporaryRoot = undefined;
});

describe('Case Environment', () => {
  it.each([false, true])('validates shared Preference feedback scope (unrelated Interest: %s)', async (unrelated) => {
    const resolved = await loadCase({ rootDirectory: path.join(process.cwd(), 'evals/agent/datasets'), identity: 'controlled/preference-learning.learn-source-preference' });
    if (resolved.case.type !== 'preference_learning') throw new Error('Expected Preference Case');
    const recommendation = resolved.case.initialState.recommendations[0]!;
    const interest = resolved.case.initialState.interests[0]!;
    const creation = createCaseEnvironment({ repositoryRoot: process.cwd(), candidateModel: resolvedModel(), resolvedCase: { ...resolved, case: {
      ...resolved.case, initialState: { ...resolved.case.initialState,
        interests: [...resolved.case.initialState.interests, ...(unrelated ? [{ referenceId: 'unrelated', description: 'Gardening', status: 'active' as const }] : [])],
        recommendations: [{ ...recommendation, reaction: 'liked', reactionRevision: 1, learnedReaction: 'liked', learnedReactionRevision: 1 }],
        preferences: ['first', 'second'].map((id) => ({ id, interestReferenceId: unrelated ? 'unrelated' : interest.referenceId, polarity: 'positive', dimension: 'source', statement: id,
          supportingRecommendationReferenceIds: [recommendation.referenceId],
        })),
      },
    } } });
    if (unrelated) {
      await expect(creation.then(async (unexpected) => { await unexpected.dispose(); })).rejects.toThrow(/Interest scope/u);
      return;
    }
    const environment = await creation;
    try {
      const database = createDatabase({ filename: environment.paths.database });
      try {
        const facts = getDiscoveryState(database);
        expect(facts.preferences).toHaveLength(2);
        expect(facts.preferenceEvidence).toHaveLength(2);
        expect(facts.recommendationStates[0]).toMatchObject({ reactionRevision: 1, learnedReactionRevision: 1, reaction: 'liked' });
        expect(facts.recommendations[0]?.localDate).toBe('2026-01-14');
      } finally { database.close(); }
    } finally { await environment.dispose(); }
  });
  it('installs 180 existing Candidates without changing the production replenishment target', async () => {
    const resolvedCase = await loadCase({ rootDirectory: path.join(process.cwd(), 'evals/agent/datasets'), identity: 'controlled/recommendation.select-relevant-candidate' });
    if (resolvedCase.case.type !== 'recommendation') throw new Error('Expected Recommendation');
    const candidate = resolvedCase.case.initialState.candidates[0]!;
    const expanded = {
      ...resolvedCase,
      case: {
        ...resolvedCase.case,
        initialState: { ...resolvedCase.case.initialState, candidates: Array.from({ length: 180 }, (_, index) => ({
          ...candidate, referenceId: `candidate-${index}`, canonicalUrl: `https://example.test/content/${index}`,
        })) },
      },
    };
    const environment = await createCaseEnvironment({ repositoryRoot: process.cwd(), resolvedCase: expanded, candidateModel: resolvedModel() });
    try {
      expect(await environment.runtime.host.discovery.getCandidatePool()).toMatchObject({ availableCount: 180, targetCount: 160, maximumCount: 200 });
    } finally { await environment.dispose(); }
  });
  it('installs the authored Candidate body and clock rather than description and wall time', async () => {
    const resolvedCase = await loadCase({
      rootDirectory: path.join(process.cwd(), 'evals', 'agent', 'datasets'),
      identity: 'controlled/recommendation.select-relevant-candidate',
    });
    const environment = await createCaseEnvironment({ repositoryRoot: process.cwd(), resolvedCase, candidateModel: resolvedModel() });
    try {
      const pool = await environment.runtime.host.discovery.getCandidatePool();
      expect(pool?.candidates.find(({ candidate }) => candidate.canonicalUrl === 'https://example.test/evaluation-design')?.candidate).toMatchObject({
        contentExcerpt: 'A guide to Agent evaluation datasets, execution traces, and graders.',
        createdAt: '2026-01-15T08:00:00.000Z',
        expiresAt: '2026-02-14T08:00:00.000Z',
      });
    } finally { await environment.dispose(); }
  });
  it('creates physically isolated Home, Workspace, database, and Trace roots per Case Run', async () => {
    temporaryRoot = mkdtempSync(path.join(tmpdir(), 'megumi-case-environment-test-'));
    const resolvedCase = await loadCase({
      rootDirectory: path.join(process.cwd(), 'evals', 'agent', 'datasets'),
      identity: 'controlled/conversation.create-workspace-note',
    });
    const first = await createCaseEnvironment({
      repositoryRoot: process.cwd(), resolvedCase, candidateModel: resolvedModel(),
      temporaryParent: temporaryRoot,
    });
    const second = await createCaseEnvironment({
      repositoryRoot: process.cwd(), resolvedCase, candidateModel: resolvedModel(),
      temporaryParent: temporaryRoot,
    });

    try {
      expect(first.paths.root).not.toBe(second.paths.root);
      expect(first.paths.home).not.toBe(second.paths.home);
      expect(first.paths.workspace).not.toBe(second.paths.workspace);
      expect(first.paths.database).not.toBe(second.paths.database);
      expect(first.paths.observability).not.toBe(second.paths.observability);
      expect(first.paths.database).toBe(path.join(first.paths.home, 'sqlite', 'megumi.sqlite'));
      expect(first.paths.observability).toBe(path.join(first.paths.home, 'logs', 'observability'));
      expect(existsSync(first.paths.database)).toBe(true);
      expect(existsSync(path.join(first.paths.workspace, 'source.md'))).toBe(true);
      expect(first.paths.home).not.toBe(process.env.MEGUMI_HOME);
    } finally {
      await first.dispose();
      await second.dispose();
    }

    expect(existsSync(first.paths.root)).toBe(false);
    expect(existsSync(second.paths.root)).toBe(false);
  });

  it('installs the authored Initial State for all five business Case types', async () => {
    temporaryRoot = mkdtempSync(path.join(tmpdir(), 'megumi-case-types-test-'));
    const identities = [
      'controlled/conversation.create-workspace-note',
      'controlled/interest-understanding.recognize-explicit-interest',
      'controlled/candidate-supply.refill-agent-candidates',
      'controlled/recommendation.select-relevant-candidate',
      'controlled/preference-learning.learn-source-preference',
    ] as const;

    for (const identity of identities) {
      const resolvedCase = await loadCase({
        rootDirectory: path.join(process.cwd(), 'evals', 'agent', 'datasets'),
        identity,
      });
      const environment = await createCaseEnvironment({
        repositoryRoot: process.cwd(), resolvedCase, candidateModel: resolvedModel(),
        temporaryParent: temporaryRoot,
      });
      try {
        expect((await environment.runtime.host.settings.get()).status, identity).toBe('ok');
        expect(await environment.runtime.host.discovery.getHome({ mode: 'timeline' })).toMatchObject({
          candidateSupplyConfirmed: true,
          candidateSupplyStatus: { status: 'idle' },
        });
        expect(existsSync(environment.paths.database), identity).toBe(true);
        expect(environment.resolvedCase.identity).toBe(identity);
      } finally {
        await environment.dispose();
      }
      expect(existsSync(environment.paths.root), identity).toBe(false);
    }
  });
});

function resolvedModel() {
  const credential = { type: 'api_key' as const, key: 'test-key' };
  return {
    source: 'explicit' as const,
    config: {
      providerId: 'test', modelId: 'model', api: 'openai-completions' as const,
      baseUrl: 'https://example.test/v1', displayName: 'Test model',
      contextWindowTokens: 64_000, maxOutputTokens: 2_048,
    },
    credentials: {
      async read(providerId: string) { return providerId === 'test' ? credential : undefined; },
      async list() { return [{ providerId: 'test', type: 'api_key' as const }]; },
      async modify() { throw new Error('read-only'); },
      async delete() { throw new Error('read-only'); },
    },
  };
}
