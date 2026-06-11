// @vitest-environment node
import path from 'path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { MegumiHomeConfig } from '@megumi/desktop/main/services/project/megumi-home.service';
import {
  MegumiHomeConfigParseError,
  MegumiHomeConfigService,
  type MegumiHomeConfigFileSystem,
} from '@megumi/desktop/main/services/project/megumi-home-config.service';

class MemoryConfigFileSystem implements MegumiHomeConfigFileSystem {
  readonly jsonFiles = new Map<string, unknown>();

  async readJson(filePath: string): Promise<unknown> {
    if (!this.jsonFiles.has(filePath)) {
      throw new Error(`Missing file: ${filePath}`);
    }

    return this.jsonFiles.get(filePath);
  }
}

const configPath = path.resolve('C:/Users/anwen/.megumi/config.json');

function createConfig(overrides: Partial<MegumiHomeConfig> = {}): MegumiHomeConfig {
  return {
    version: 1,
    app: {
      theme: 'megumi-warm',
      language: 'zh-CN',
    },
    chat: {
      defaultProvider: 'deepseek',
    },
    providers: {
      deepseek: {
        enabled: true,
        kind: 'openai-compatible',
        displayName: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com',
        defaultModel: 'deepseek-v4-flash',
        apiKeyEnv: 'DEEPSEEK_API_KEY',
      },
      openai: {
        enabled: true,
        kind: 'openai-compatible',
        displayName: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        defaultModel: 'gpt-5.5',
        apiKeyEnv: 'OPENAI_API_KEY',
      },
      anthropic: {
        enabled: false,
        kind: 'anthropic',
        displayName: 'Anthropic',
        baseUrl: 'https://api.anthropic.com',
        defaultModel: 'claude-sonnet-4-6',
        apiKeyEnv: 'ANTHROPIC_API_KEY',
      },
    },
    ...overrides,
  };
}

describe('MegumiHomeConfigService', () => {
  let fileSystem: MemoryConfigFileSystem;

  beforeEach(() => {
    fileSystem = new MemoryConfigFileSystem();
  });

  it('loads config from Megumi Home', async () => {
    fileSystem.jsonFiles.set(configPath, createConfig());

    const service = new MegumiHomeConfigService({
      configPath,
      fileSystem,
    });

    await expect(service.loadConfig()).resolves.toEqual(createConfig());
  });

  it('returns built-in provider settings from config without exposing apiKey', async () => {
    fileSystem.jsonFiles.set(
      configPath,
      createConfig({
        providers: {
          deepseek: {
            enabled: true,
            kind: 'openai-compatible',
            displayName: 'DeepSeek Proxy',
            baseUrl: 'https://proxy.local/deepseek',
            defaultModel: 'deepseek-v4-pro',
            apiKey: 'sk-config-deepseek',
          },
          openai: {
            enabled: false,
            kind: 'openai-compatible',
            displayName: 'OpenAI',
            baseUrl: 'https://api.openai.com/v1',
            defaultModel: 'gpt-5.5',
            apiKeyEnv: 'OPENAI_API_KEY',
          },
          anthropic: {
            enabled: false,
            kind: 'anthropic',
            displayName: 'Anthropic',
            baseUrl: 'https://api.anthropic.com',
            defaultModel: 'claude-sonnet-4-6',
            apiKeyEnv: 'ANTHROPIC_API_KEY',
          },
        },
      }),
    );

    const service = new MegumiHomeConfigService({
      configPath,
      fileSystem,
    });

    expect(await service.getProviderSettings('deepseek')).toMatchObject({
      providerId: 'deepseek',
      kind: 'openai-compatible',
      displayName: 'DeepSeek Proxy',
      enabled: true,
      baseUrl: 'https://proxy.local/deepseek',
      defaultModelId: 'deepseek-v4-pro',
    });
    expect(JSON.stringify(await service.getProviderSettings('deepseek'))).not.toContain('sk-config-deepseek');
  });

  it('lists built-in provider settings in existing provider order', async () => {
    fileSystem.jsonFiles.set(configPath, createConfig());

    const service = new MegumiHomeConfigService({
      configPath,
      fileSystem,
    });

    expect((await service.listProviderSettings()).map((settings) => settings.providerId)).toEqual([
      'deepseek',
      'openai',
      'anthropic',
    ]);
  });

  it('returns configured apiKeyEnv and plaintext apiKey without renderer-safe callers using raw key', async () => {
    fileSystem.jsonFiles.set(
      configPath,
      createConfig({
        providers: {
          ...createConfig().providers,
          deepseek: {
            enabled: true,
            kind: 'openai-compatible',
            displayName: 'DeepSeek',
            baseUrl: 'https://api.deepseek.com',
            defaultModel: 'deepseek-v4-flash',
            apiKeyEnv: 'CUSTOM_DEEPSEEK_KEY',
            apiKey: 'sk-config-deepseek',
          },
        },
      }),
    );

    const service = new MegumiHomeConfigService({
      configPath,
      fileSystem,
    });

    expect(await service.getProviderApiKeyEnv('deepseek')).toBe('CUSTOM_DEEPSEEK_KEY');
    expect(await service.getPlaintextProviderApiKey('deepseek')).toBe('sk-config-deepseek');
  });

  it('throws a typed parse error for invalid config shape', async () => {
    fileSystem.jsonFiles.set(configPath, {
      version: 1,
      providers: [],
    });

    const service = new MegumiHomeConfigService({
      configPath,
      fileSystem,
    });

    await expect(service.loadConfig()).rejects.toBeInstanceOf(MegumiHomeConfigParseError);
  });

  it('wraps config read failures in a typed parse error with the config path', async () => {
    const service = new MegumiHomeConfigService({
      configPath,
      fileSystem: {
        async readJson() {
          throw new SyntaxError('Expected comma in JSON at position 41');
        },
      },
    });

    await expect(service.loadConfig()).rejects.toMatchObject({
      name: 'MegumiHomeConfigParseError',
      code: 'megumi_home_config_parse_error',
      configPath,
      message: 'Megumi config could not be read: Expected comma in JSON at position 41',
    });
  });
});

