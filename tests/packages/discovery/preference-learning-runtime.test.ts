/*
 * Verifies lazy learning failure, cancellation and diagnostics using real persisted inputs.
 */
// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { createPreferenceLearningRuntime, type PreferenceLearningFacts, type PreferenceLearningRuntime } from '@megumi/discovery';
import type { DatabaseConnection } from '@megumi/database';
import { completedMessage, model } from '../context/context-test-fixtures';
import { createLearningFixture, seedRecommendation, now } from './preference-learning-fixtures';

const resources: Array<{ database: DatabaseConnection; runtime: PreferenceLearningRuntime }> = [];
afterEach(async () => { for (const { database, runtime } of resources.splice(0)) { await runtime.shutdown(); database.close(); } });

function setup() {
  const { database, repository } = createLearningFixture();
  seedRecommendation(database, 1);
  repository.updateState({ recommendationId: 'recommendation:1', action: 'set_reaction', reaction: 'liked' });
  let facts: PreferenceLearningFacts | undefined;
  const models = { completeSimple: vi.fn(async () => {
    if (!facts) throw new Error('Missing facts');
    return completedMessage(JSON.stringify({ scopes: facts.currentPreferences.map(({ preferenceSet }) => ({
      preferenceSetId: preferenceSet.id, baseRevision: preferenceSet.revision, reviewedPreferenceIds: facts?.reviewedPreferenceIds,
      outcome: 'changed', changes: [{ kind: 'add', statement: '实测对比', polarity: 'positive', dimension: 'content_type',
        evidence: [{ recommendationId: 'recommendation:1', relation: 'support', explanation: 'The liked item compares measured results.' }] }],
    })) }));
  }) };
  const resolveModel = vi.fn(async () => model);
  const context = { build: vi.fn(async () => {
    facts = runtime.getActivePreferenceLearningFacts('batch');
    return { status: 'ready' as const, prompt: { systemPrompt: 'Learn from feedback.', messages: [], tools: [] } };
  }) };
  const runtime = createPreferenceLearningRuntime({ repository, models, context, resolveModel,
    ids: { createBatchId: () => 'batch', createModelCallId: () => 'call' }, now: () => now });
  resources.push({ database, runtime });
  return { database, repository, runtime, models, context, resolveModel };
}

it('commits generated identities and releases the active snapshot', async () => {
  const { repository, runtime } = setup();
  expect((await runtime.preparePreferencesForRecommendation({ requestId: 'r' })).status).toBe('updated');
  expect(repository.listPreferenceSetDetails({ effectiveOnly: true })[0].preferences[0].preference.id).toMatch(/^[a-f0-9-]{36}$/u);
  expect(runtime.getActivePreferenceLearningFacts('batch')).toBeUndefined();
});

it('leaves malformed model output pending without automatically repeating it', async () => {
  const { repository, runtime, models } = setup();
  models.completeSimple.mockImplementation(async () => completedMessage('not JSON'));
  expect((await runtime.preparePreferencesForRecommendation({ requestId: 'r' })).status).toBe('degraded');
  expect(models.completeSimple).toHaveBeenCalledTimes(1);
  expect(repository.getPreferenceLearningCompletion('recommendation:1')?.status).toBe('pending');
});

it('bounds transient failures to three attempts within one demand', async () => {
  const { runtime, models } = setup();
  models.completeSimple.mockImplementation(async () => ({ ...completedMessage(), stopReason: 'error', errorMessage: 'temporary' }));
  expect((await runtime.preparePreferencesForRecommendation({ requestId: 'r' })).status).toBe('degraded');
  expect(models.completeSimple).toHaveBeenCalledTimes(3);
  await runtime.start();
  runtime.notifyReactionChanged();
  expect(models.completeSimple).toHaveBeenCalledTimes(3);
});

it('cancels a non-cooperative model and prevents a late response from committing', async () => {
  const { runtime, repository, models } = setup();
  let release: ((value: ReturnType<typeof completedMessage>) => void) | undefined;
  models.completeSimple.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
  const controller = new AbortController();
  const operation = runtime.preparePreferencesForRecommendation({ requestId: 'r', signal: controller.signal });
  await vi.waitFor(() => expect(models.completeSimple).toHaveBeenCalledOnce());
  controller.abort();
  expect((await operation).status).toBe('cancelled');
  release?.(completedMessage('{"scopes":[]}'));
  expect(repository.listPreferenceSetDetails()[0].preferences).toEqual([]);
});

it('rejects required context that exceeds its budget before paying for a model call', async () => {
  const { runtime, models, context } = setup();
  context.build.mockImplementation(async () => ({ status: 'ready', prompt: { systemPrompt: '证据'.repeat(100000), messages: [], tools: [] } }));
  const result = await runtime.preparePreferencesForRecommendation({ requestId: 'r' });
  expect(result).toMatchObject({ status: 'degraded', failures: [{ code: 'input_too_large' }] });
  expect(models.completeSimple).not.toHaveBeenCalled();
});

it('keeps a user edit when an older model result arrives after the correction', async () => {
  const { runtime, repository, database, models } = setup();
  await runtime.preparePreferencesForRecommendation({ requestId: 'first' });
  const preference = repository.listPreferenceSetDetails()[0].preferences[0].preference;
  seedRecommendation(database, 2);
  repository.updateState({ recommendationId: 'recommendation:2', action: 'set_reaction', reaction: 'liked' });
  const original = models.completeSimple.getMockImplementation();
  let release: (() => void) | undefined;
  models.completeSimple.mockImplementationOnce(async () => {
    if (!original) throw new Error('Missing scripted provider.');
    const stale = await original();
    await new Promise<void>((resolve) => { release = resolve; });
    return stale;
  }).mockImplementation(async () => completedMessage('invalid output on fresh retry'));
  const pending = runtime.preparePreferencesForRecommendation({ requestId: 'second' });
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  repository.editPreference({ preferenceId: preference.id, expectedRevision: preference.revision, statement: '也愿意看新手内容，避免纯推广', now });
  release?.();
  const result = await pending;
  expect(result.status).toBe('degraded');
  expect(result.preferences[0].preferences).toHaveLength(1);
  expect(result.preferences[0].preferences[0].preference).toMatchObject({ id: preference.id, origin: 'user', statement: '也愿意看新手内容，避免纯推广' });
  expect(result.guard.scopes[0].policyRevision).toBeGreaterThan(0);
});

it('excludes invalidated preferences when learning fails instead of reviving the previous inference', async () => {
  const { runtime, repository, models } = setup();
  await runtime.preparePreferencesForRecommendation({ requestId: 'first' });
  repository.updateState({ recommendationId: 'recommendation:1', action: 'set_reaction', reaction: null });
  models.completeSimple.mockImplementation(async () => completedMessage('invalid JSON'));
  const result = await runtime.preparePreferencesForRecommendation({ requestId: 'after-withdrawal' });
  expect(result.status).toBe('degraded');
  expect(result.preferences[0].preferences).toEqual([]);
  expect(result.scopeResults[0].status).toBe('pending');
  expect(repository.listPreferenceSetDetails()[0].preferences[0].preference.status).toBe('needs_review');
});
