/* Verifies Evaluation model sources resolve through Megumi Settings and AI CredentialStore boundaries. */
// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { EvaluationRunConfigSchema } from '../../evals/agent/contracts/evaluation-run-config';
import { resolveEvaluationModels } from '../../evals/agent/adapters/evaluation-model-source';

let temporaryHome: string | undefined;
afterEach(async () => {
  if (temporaryHome) await rm(temporaryHome, { recursive: true, force: true });
  temporaryHome = undefined;
});

describe('Evaluation model source', () => {
  it('resolves current and configured models with credentials from Megumi Settings', async () => {
    temporaryHome = await createMegumiHome();
    const config = EvaluationRunConfigSchema.parse(runConfig({
      candidateModel: { source: 'current' },
      graderModel: {
        source: 'configured',
        providerId: 'second-provider',
        modelId: 'second-model',
      },
    }));

    const models = await resolveEvaluationModels({
      config,
      megumiHomePath: temporaryHome,
      environment: {},
    });

    expect(models.candidate).toMatchObject({
      source: 'current',
      config: { providerId: 'current-provider', modelId: 'current-model' },
    });
    expect(models.grader).toMatchObject({
      source: 'configured',
      config: { providerId: 'second-provider', modelId: 'second-model' },
    });
    await expect(models.candidate.credentials.read('current-provider')).resolves.toEqual({
      type: 'api_key',
      key: 'current-secret',
    });
    await expect(models.grader.credentials.read('second-provider')).resolves.toEqual({
      type: 'api_key',
      key: 'second-secret',
    });
  });

  it('normalizes a custom model and maps an explicit Settings credential without changing Settings', async () => {
    temporaryHome = await createMegumiHome();
    const settingsPath = path.join(temporaryHome, 'settings.json');
    const settingsBefore = await readFile(settingsPath, 'utf8');
    const config = EvaluationRunConfigSchema.parse(runConfig({
      candidateModel: customModel({ source: 'settings', providerId: 'current-provider' }),
      graderModel: customModel({ source: 'environment', environmentVariable: 'CUSTOM_EVAL_KEY' }),
    }));

    const models = await resolveEvaluationModels({
      config,
      megumiHomePath: temporaryHome,
      environment: { CUSTOM_EVAL_KEY: 'environment-secret' },
    });

    expect(models.candidate).toMatchObject({
      source: 'custom',
      config: {
        providerId: 'custom-provider',
        modelId: 'custom-model',
        api: 'openai-completions',
        baseUrl: 'https://custom.example.test/v1',
      },
    });
    await expect(models.candidate.credentials.read('custom-provider')).resolves.toEqual({
      type: 'api_key',
      key: 'current-secret',
    });
    await expect(models.grader.credentials.read('custom-provider')).resolves.toEqual({
      type: 'api_key',
      key: 'environment-secret',
    });
    await expect(readFile(settingsPath, 'utf8')).resolves.toBe(settingsBefore);
  });
});

function runConfig(models: Readonly<Record<'candidateModel' | 'graderModel', unknown>>) {
  return {
    profile: 'controlled',
    taskIds: ['conversation.test'],
    suiteIds: [],
    ...models,
    budget: { maxTasks: 1 },
    runRoot: '.megumi/evaluation',
  };
}

function customModel(credential: Readonly<Record<string, string>>) {
  return {
    source: 'custom',
    providerId: 'custom-provider',
    modelId: 'custom-model',
    api: 'openai-completions',
    baseUrl: 'https://custom.example.test/v1',
    contextWindowTokens: 64_000,
    maxOutputTokens: 2_048,
    credential,
  };
}

async function createMegumiHome(): Promise<string> {
  const home = await mkdtemp(path.join(os.tmpdir(), 'megumi-evaluation-model-source-'));
  await writeFile(path.join(home, 'settings.json'), `${JSON.stringify({
    model_selection: { provider_id: 'current-provider', model_id: 'current-model' },
    providers: {
      'current-provider': provider('current-model', 'current-secret'),
      'second-provider': provider('second-model', 'second-secret'),
    },
  }, null, 2)}\n`, 'utf8');
  return home;
}

function provider(modelId: string, apiKey: string) {
  return {
    enabled: true,
    api: 'openai-completions',
    base_url: 'https://example.test/v1',
    api_key: apiKey,
    models: {
      [modelId]: { context_window_tokens: 64_000, max_output_tokens: 2_048 },
    },
  };
}
