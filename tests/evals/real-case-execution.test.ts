/* Exercises actual composition, database, tools, and business Owners with a scripted external model. */
// @vitest-environment node
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadCase } from '../../evals/agent/datasets/dataset-loader';
import { createCaseEnvironment } from '../../evals/agent/run/case-environment';
import { executeCase } from '../../evals/agent/run/case-execution';
import { createScriptedStreams } from '../packages/composition/compose-test-application';

describe('Real evaluation execution', () => {
  it('drives the ten-minute feedback timer and records a model failure instead of a timeout', async () => {
    const resolved = await loadCase({ rootDirectory: path.resolve('evals/agent/datasets'), identity: 'controlled/preference-learning.learn-source-preference' });
    if (resolved.case.type !== 'preference_learning') throw new Error('Expected Preference Case');
    const resolvedCase = { ...resolved, case: { ...resolved.case, input: { ...resolved.case.input, advanceTimeMs: 600_000 } } };
    const model = testModel();
    const scripted = createScriptedStreams(['invalid preference JSON']);
    const environment = await createCaseEnvironment({ repositoryRoot: process.cwd(), resolvedCase, candidateModel: model, modelStreams: { 'openai-completions': scripted.streams } });
    try {
      const result = await executeCase({ evaluationCase: resolvedCase.case, runtime: environment.runtime, initialStateIds: environment.initialStateIds,
        candidateModel: model.config, now: environment.now, advanceTime: environment.advanceTime!, safetyWallClockLimitMs: 5_000,
      });
      expect(scripted.contexts).toHaveLength(1);
      expect(result).toMatchObject({ terminalState: 'settled', productResult: { completion: { status: 'failed', code: 'preference_learning_failed' } }, ownerFacts: { status: 'pending' } });
      expect(environment.now()).toBe('2026-01-15T08:10:00.000Z');
    } finally { await environment.dispose(); }
  });
});

function testModel() {
  const credential = { type: 'api_key' as const, key: 'test-key' };
  return {
    source: 'explicit' as const,
    config: { providerId: 'test', modelId: 'model', api: 'openai-completions' as const, baseUrl: 'https://example.test/v1', displayName: 'Test model', contextWindowTokens: 64_000, maxOutputTokens: 2_048 },
    credentials: {
      async read() { return credential; }, async list() { return [{ providerId: 'test', type: 'api_key' as const }]; },
      async modify() { throw new Error('read-only'); }, async delete() { throw new Error('read-only'); },
    },
  };
}
