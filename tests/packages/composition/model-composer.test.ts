/* Verifies model preparation against real settings files and injected external model streams. */
// @vitest-environment node
import { createApplicationModels } from '@megumi/application/compose-modules';
import { readModelCatalog } from '@megumi/application/settings/resolve-model';
import { createSettings } from '@megumi/application/settings/settings-store';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createScriptedStreams } from './compose-test-application';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    fs.rmSync(directory, { recursive: true, force: true });
});

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'megumi-models-'));
  directories.push(directory);
  const globalSettingsPath = path.join(directory, 'settings.json');
  const credentialsPath = path.join(directory, 'credentials.json');
  const settings = createSettings({
    globalSettingsPath,
    credentialsPath,
    readEnvironment: () => undefined,
  });
  return { directory, globalSettingsPath, credentialsPath, settings };
}

describe('Application model configuration', () => {
  it('prepares a callable custom model and keeps selected parameters fixed while reading current credentials', async () => {
    const files = fixture();
    const configuration = (baseUrl: string) => ({
      providers: {
        local: {
          api: 'openai-completions',
          baseUrl,
          models: { small: { contextWindowTokens: 8192, maxOutputTokens: 1024 } },
        },
      },
    });
    fs.writeFileSync(
      files.globalSettingsPath,
      JSON.stringify(configuration('https://first.example/v1')),
    );
    files.settings.updateCredential({
      target: { kind: 'provider', providerId: 'local' },
      value: 'first-key',
    });
    const scripted = createScriptedStreams(['reply']);
    const models = createApplicationModels({
      settingsForWorkspace: () => files.settings,
      apiImplementations: { 'openai-completions': scripted.streams }
    });
    const prepared = await models.resolveModel({ selection: { providerId: 'local', modelId: 'small' } });
    if (prepared.status !== 'ok') throw new Error(prepared.failure.message);
    fs.writeFileSync(
      files.globalSettingsPath,
      JSON.stringify(configuration('https://second.example/v1')),
    );
    const second = await models.resolveModel({ selection: { providerId: 'local', modelId: 'small' } });
    if (second.status !== 'ok') throw new Error(second.failure.message);
    expect(prepared.model.baseUrl).toBe('https://first.example/v1');
    expect(second.model.baseUrl).toBe('https://second.example/v1');
    const response = await models.ai.completeSimple(prepared.model, {
      messages: [{ role: 'user', content: 'Hello', timestamp: 0 }],
    });
    expect(response.content).toEqual([{ type: 'text', text: 'reply' }]);
    files.settings.updateCredential({
      target: { kind: 'provider', providerId: 'local' },
      value: null,
    });
    const unauthenticated = await models.ai.completeSimple(prepared.model, { messages: [] });
    expect(unauthenticated.stopReason).toBe('error');
  });

  it('uses the AI catalog and applies only explicitly configured model fields', () => {
    const files = fixture();
    fs.writeFileSync(
      files.globalSettingsPath,
      JSON.stringify({
        providers: {
          deepseek: {
            name: 'My DeepSeek',
            models: { 'deepseek-flash': { name: 'Fast', maxOutputTokens: 2048 } },
          },
        },
      }),
    );
    const result = readModelCatalog(files.settings);
    if (result.status !== 'ok') throw new Error('Expected catalog');
    const provider = result.providers.find((item) => item.id === 'deepseek');
    expect(result.providers.map((item) => item.id)).toEqual(['deepseek']);
    expect(provider?.models.map((item) => item.model.id)).toEqual(['deepseek-flash']);
    expect(result.catalog.find((item) => item.id === 'deepseek')?.models.length).toBeGreaterThan(1);
    expect(provider?.name).toBe('My DeepSeek');
    expect(provider?.models.find((item) => item.model.id === 'deepseek-flash')).toMatchObject({
      model: { name: 'Fast', maxTokens: 2048, contextWindow: 1_000_000 },
      enabled: true,
      custom: false,
    });
    expect(fs.readFileSync(files.globalSettingsPath, 'utf8')).not.toContain('contextWindowTokens');
  });
});
