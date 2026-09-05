/*
 * Verifies quality scenarios preserve baseline datasets and install valid real business facts.
 */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { GradingProfileSchema } from '../../evals/agent/grading/grading-contract';
import { loadDataset } from '../../evals/agent/datasets/dataset-loader';
import { createCaseEnvironment } from '../../evals/agent/run/case-environment';
import { resolveCandidateModel } from '../../evals/agent/adapters/candidate-model';

describe('personalization quality datasets', () => {
  it.each(['recommendation-quality', 'preference-quality'])('installs every %s Case through the real initializer without executing a model', async (name) => {
    const profile = GradingProfileSchema.parse(JSON.parse(await readFile(`evals/agent/grading/profiles/${name}.json`, 'utf8')));
    expect(profile.profileId).toBe(name);
    const dataset = await loadDataset({ rootDirectory: 'evals/agent/datasets', identity: `controlled/${name}` });
    expect(dataset.cases).toHaveLength(4);
    const model = await resolveCandidateModel({ config: { source: 'explicit', providerId: 'test', modelId: 'test', api: 'openai-completions',
      baseUrl: 'https://example.test/v1', contextWindowTokens: 16000, maxOutputTokens: 2000, credentialEnvironmentVariable: 'TEST_KEY' },
      environment: { TEST_KEY: 'not-a-real-key' } });
    for (const resolvedCase of dataset.cases) {
      const environment = await createCaseEnvironment({ repositoryRoot: process.cwd(), resolvedCase, candidateModel: model });
      try {
        expect(environment.initialState.discovery.interests.length).toBeGreaterThan(0);
        expect(environment.initialState.discovery.candidates.length).toBeGreaterThan(0);
        if (resolvedCase.case.type === 'preference_learning' && resolvedCase.case.expected?.retainedDirectionIds?.length) {
          expect(environment.initialState.discovery.preferenceEvidence.length).toBeGreaterThan(1);
        }
      } finally { await environment.dispose(); }
    }
  });
  it.each(['conversation', 'interest-understanding', 'candidate-supply', 'recommendation', 'preference-learning'])('retains the original single-case %s baseline', async (name) => {
    const dataset = await loadDataset({ rootDirectory: 'evals/agent/datasets', identity: `controlled/${name}` });
    expect(dataset.cases).toHaveLength(1);
  });
});
