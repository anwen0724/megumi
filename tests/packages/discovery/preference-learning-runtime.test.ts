/*
 * Exercises Preference learning with real SQLite business facts and fake model I/O.
 */
// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPreferenceLearningRuntime, type PreferenceLearningFacts, type PreferenceLearningRuntime } from '@megumi/discovery';
import type { DatabaseConnection } from '@megumi/database';
import type { Observability } from '@megumi/observability';
import { completedMessage, model } from '../context/context-test-fixtures';
import { createLearningFixture, now, seedRecommendation, setReaction } from './preference-learning-fixtures';

const resources: Array<{ database: DatabaseConnection; runtime: PreferenceLearningRuntime }> = [];
afterEach(async () => { for (const resource of resources.splice(0)) { await resource.runtime.shutdown(); resource.database.close(); } });

function setup() {
  const { database, repository } = createLearningFixture();
  seedRecommendation(database, 1); setReaction(database, 1, 'liked');
  let material: PreferenceLearningFacts | undefined;
  const timers: Array<{ delay: number; callback: () => void }> = [];
  const errors: unknown[] = [];
  const context = { build: vi.fn(async () => {
    material = runtime.getActivePreferenceLearningFacts('work:1');
    if (!material) throw new Error('Context must receive the active snapshot.');
    return { status: 'ready' as const, prompt: { systemPrompt: 'learn', messages: [], tools: [] } };
  }) };
  const models = { completeSimple: vi.fn(async () => {
    if (!material) throw new Error('Expected Context material.');
    return completedMessage(JSON.stringify({ scopes: material.currentPreferences.map(({ preferenceSet }) => ({
      preferenceSetId: preferenceSet.id, baseRevision: preferenceSet.revision,
      preferences: [{ id: '', polarity: 'positive', dimension: 'topic', statement: 'Agent implementation',
        supportingRecommendationIds: ['recommendation:1'] }],
    })) }));
  }) };
  const observability: Observability = {
    withTrace: vi.fn(async (_options, operation) => operation()),
    withSpan: vi.fn(async (_options, operation) => operation()),
    recordContent: vi.fn(), recordEvent: vi.fn(), linkTrace: vi.fn(),
  };
  const runtime = createPreferenceLearningRuntime({
    repository, context, models, observability, resolveModel: async () => model,
    ids: { createBatchId: () => 'work:1', createModelCallId: () => 'model:1' },
    now: () => '2026-08-27T08:11:00.000Z', onBackgroundError: (error) => errors.push(error),
    timers: {
      set(delay, callback) { const entry = { delay, callback }; timers.push(entry); return entry; },
      clear(handle) { const index = timers.indexOf(handle as typeof timers[number]); if (index >= 0) timers.splice(index, 1); },
    },
  });
  resources.push({ database, runtime });
  return { database, repository, runtime, context, models, observability, timers, errors };
}

describe('Preference Learning Runtime', () => {
  it('runs one completion, creates UUID preferences and releases the active snapshot', async () => {
    const { repository, runtime, context, models, observability } = setup();
    await runtime.start({ automaticTriggers: false });
    expect(context.build).not.toHaveBeenCalled();
    runtime.notifyReactionChanged();
    await vi.waitFor(() => expect(repository.getPreferenceLearningCompletion('recommendation:1')?.status).toBe('learned'));
    await runtime.shutdown();
    expect(runtime.getActivePreferenceLearningFacts('work:1')).toBeUndefined();
    expect(models.completeSimple).toHaveBeenCalledTimes(1);
    expect(repository.listPreferenceSetDetails()[0].preferences[0].preference.id).toMatch(/^[a-f0-9-]{36}$/u);
    expect(context.build).toHaveBeenCalledWith(expect.objectContaining({
      modelCallContext: expect.objectContaining({ run: expect.objectContaining({ kind: 'preference_learning', batchId: 'work:1' }), tools: [] }),
    }));
    expect(observability.withTrace).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'preference_learning', correlation: { preferenceLearningBatchId: 'work:1', recommendationIds: ['recommendation:1'] },
    }), expect.any(Function));
    expect(observability.recordContent).toHaveBeenCalledWith(expect.objectContaining({ kind: 'preference.committed' }));
  });

  it('retries transient completion failures finitely without acknowledging feedback', async () => {
    const { repository, runtime, models, timers } = setup();
    models.completeSimple.mockImplementation(async () => ({ ...completedMessage(), stopReason: 'error', errorMessage: 'temporary failure' }));
    await runtime.start();
    for (let attempt = 1; attempt <= 2; attempt++) {
      await vi.waitFor(() => expect(timers).toHaveLength(1));
      expect(timers[0].delay).toBe(60_000);
      timers.shift()?.callback();
    }
    await vi.waitFor(() => expect(models.completeSimple).toHaveBeenCalledTimes(3));
    await vi.waitFor(() => expect(runtime.getActivePreferenceLearningFacts('work:1')).toBeUndefined());
    expect(timers).toHaveLength(0);
    expect(repository.getPreferenceLearningCompletion('recommendation:1')?.status).toBe('pending');
    expect(repository.listPreferenceSetDetails()[0].preferences).toEqual([]);
  });

  it('rejects invented nonempty preference IDs instead of treating them as database identities', async () => {
    const { repository, runtime, models, errors } = setup();
    models.completeSimple.mockImplementation(async () => {
      const facts = runtime.getActivePreferenceLearningFacts('work:1');
      if (!facts) throw new Error('Expected active facts.');
      return completedMessage(JSON.stringify({ scopes: facts.currentPreferences.map(({ preferenceSet }) => ({
        preferenceSetId: preferenceSet.id, baseRevision: preferenceSet.revision,
        preferences: [{ id: 'model-invented-id', polarity: 'positive', dimension: 'topic',
          statement: 'Agent implementation', supportingRecommendationIds: ['recommendation:1'] }],
      })) }));
    });
    await runtime.start();
    await vi.waitFor(() => expect(errors).toHaveLength(1));
    expect(repository.findPreferenceById('model-invented-id')).toBeUndefined();
    expect(repository.getPreferenceLearningCompletion('recommendation:1')?.status).toBe('pending');
  });

  it('does not repeat invalid model output automatically', async () => {
    const { repository, runtime, models, timers, errors } = setup();
    models.completeSimple.mockImplementation(async () => completedMessage('not json'));
    await runtime.start();
    await vi.waitFor(() => expect(errors).toHaveLength(1));
    expect(timers).toHaveLength(0);
    expect(repository.getPreferenceLearningCompletion('recommendation:1')?.status).toBe('pending');
  });

  it('cancels without committing and recovers unlearned feedback after restart', async () => {
    const { repository, runtime, models, timers } = setup();
    let release: (() => void) | undefined;
    models.completeSimple.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => { release = resolve; });
      return completedMessage('{"scopes":[]}');
    });
    await runtime.start();
    await vi.waitFor(() => expect(models.completeSimple).toHaveBeenCalledTimes(1));
    runtime.notifyReactionChanged(); runtime.notifyReactionChanged();
    expect(models.completeSimple).toHaveBeenCalledTimes(1);
    const stopping = runtime.shutdown();
    release?.();
    await stopping;
    expect(repository.getPreferenceLearningCompletion('recommendation:1')?.learnedReactionRevision).toBe(0);
    expect(timers).toHaveLength(0);
    await runtime.start();
    await vi.waitFor(() => expect(repository.getPreferenceLearningCompletion('recommendation:1')?.status).toBe('learned'));
    expect(models.completeSimple).toHaveBeenCalledTimes(2);
  });
});
