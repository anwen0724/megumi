/* Runs Recommendation products against real storage and AI with controlled HTTP responses. */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createModels, createProvider } from '@megumi/ai';
import { openAICompletionsApi } from '@megumi/ai/api/openai-completions.lazy';
import { createAgent } from '@megumi/agent';
import { PRODUCT_EXECUTION_POLICY } from '@megumi/application/application-policy';
import { createDatabase, migrateDatabase } from '@megumi/application/storage';
import { createSettings } from '@megumi/application/settings/settings-store';
import { createDiscoveryRepository } from '@megumi/application/recommendation/recommendation-storage';
import { model as baseModel } from '../context/context-test-fixtures';

export function createHttpProductFixture(now: () => string) {
  const root = mkdtempSync(path.join(tmpdir(), 'megumi-product-http-'));
  const database = createDatabase({ filename: ':memory:' });
  migrateDatabase({ database });
  const globalSettingsPath = path.join(root, 'settings.json');
  const settings = createSettings({ globalSettingsPath, credentialsPath: path.join(root, 'credentials.json'),
    readEnvironment: () => undefined });
  const repository = createDiscoveryRepository({ database, clock: { now } });
  const model = { ...baseModel, maxTokens: 512, contextWindow: 64000 };
  const ai = createModels();
  ai.setProvider(createProvider({ id: model.provider, models: [model], api: openAICompletionsApi(),
    auth: { apiKey: { name: 'Test', resolve: async () => ({ auth: { apiKey: 'test' } }) } } }));
  return { root, database, globalSettingsPath, settings, repository, model, agent: createAgent({ ai }),
    preparation: { instructionDocuments: [], resolveModel: async () => model,
      policy: { ...PRODUCT_EXECUTION_POLICY, maxModelCallAttempts: 1, providerRequestMaxRetries: 0 } },
    cleanup() { database.close(); rmSync(root, { recursive: true, force: true }); },
  };
}
