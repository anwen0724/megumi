// @vitest-environment node
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { composeCodingAgentHostInterface } from '@megumi/coding-agent/composition';
import type { RuntimeEvent } from '@megumi/shared/runtime';
import {
  createSettingsService,
  type SettingsRaw,
} from '@megumi/coding-agent/settings';
import type { CodingAgentHostInterface } from '@megumi/coding-agent/host-interface';

type LegacyModelCallCompletionResult =
  | { ok: true; text: string; structuredOutput?: unknown }
  | { ok: false; error: { code: string; message: string } };

describe('Coding Agent host interface runtime', () => {
  let temporaryHome: string | undefined;
  let runtime: CodingAgentHostInterface | undefined;

  afterEach(async () => {
    runtime?.dispose();
    runtime = undefined;
    if (temporaryHome) {
      await rm(temporaryHome, { recursive: true, force: true });
      temporaryHome = undefined;
    }
  });

  it('composes product services without importing or constructing desktop shell modules', async () => {
    temporaryHome = await mkdtemp(path.join(os.tmpdir(), 'megumi-host-interface-'));
    let rawSettings: SettingsRaw = {};

    runtime = composeCodingAgentHostInterface({
      homePaths: {
        homePath: temporaryHome,
        sqlitePath: temporaryHome,
        settingsPath: path.join(temporaryHome, 'settings.json'),
      },
      runtimeLogger: {
        warn: () => undefined,
      },
      modelCallProviderService: {
        streamModelCall: async function* (): AsyncIterable<RuntimeEvent> {},
        completeModelCall: async (): Promise<LegacyModelCallCompletionResult> => ({ ok: true, text: '' }),
        cancelModelCall: () => false,
      },
      appSettingsProvider: createSettingsService({
        file_store: {
          readRawSettings: () => rawSettings,
          writeRawSettings(next) {
            rawSettings = next;
          },
        },
      }),
      memorySettingsProvider: {
        isMemoryEnabled: () => false,
      },
    });

    expect(runtime.session).toBeDefined();
    expect(typeof runtime.input.send).toBe('function');
    expect(typeof runtime.input.cancel).toBe('function');
    expect(runtime.session.createDraft).toBeDefined();
    expect(runtime.session.cancelDraft).toBeDefined();
    expect(runtime.artifacts).toBeDefined();
    expect(runtime.workspace).toBeDefined();
    expect(runtime.settings.provider).toBeDefined();
    const hostRecord = runtime as unknown as Record<string, unknown>;
    expect(hostRecord.execution).toBeUndefined();
    expect(hostRecord.recovery).toBeUndefined();
    expect(hostRecord.context).toBeUndefined();
    expect(hostRecord.tools).toBeUndefined();
    expect(hostRecord.branch).toBeUndefined();
    await expect(runtime.settings.provider.list()).resolves.toEqual({
      providers: [],
    });
  });

  it('routes host settings updates through the Settings Service storage port', async () => {
    temporaryHome = await mkdtemp(path.join(os.tmpdir(), 'megumi-host-settings-'));
    let rawSettings = {};
    const writes: unknown[] = [];

    runtime = composeCodingAgentHostInterface({
      homePaths: {
        homePath: temporaryHome,
        sqlitePath: temporaryHome,
        settingsPath: path.join(temporaryHome, 'settings.json'),
      },
      runtimeLogger: {
        warn: () => undefined,
      },
      modelCallProviderService: {
        streamModelCall: async function* (): AsyncIterable<RuntimeEvent> {},
        completeModelCall: async (): Promise<LegacyModelCallCompletionResult> => ({ ok: true, text: '' }),
        cancelModelCall: () => false,
      },
      settingsStorage: {
        readRawSettings: () => rawSettings,
        writeRawSettings(next) {
          rawSettings = next;
          writes.push(rawSettings);
        },
      },
      memorySettingsProvider: {
        isMemoryEnabled: () => false,
      },
    });

    const result = runtime.settings.update({
      theme: 'sage-mist',
      setup: {
        completed: true,
        completedAt: '2026-06-29T14:00:00.000Z',
      },
    });

    expect(writes).toEqual([{
      theme: 'sage-mist',
      setup: {
        completed: true,
        completed_at: '2026-06-29T14:00:00.000Z',
      },
    }]);
    expect(result.settings.setup.completed).toBe(true);
    expect(runtime.settings.get().settings.theme).toBe('sage-mist');
  });

  it('persists host settings to home settings.json by default without a UI shell provider', async () => {
    temporaryHome = await mkdtemp(path.join(os.tmpdir(), 'megumi-host-settings-file-'));
    const settingsPath = path.join(temporaryHome, 'settings.json');

    runtime = composeCodingAgentHostInterface({
      homePaths: {
        homePath: temporaryHome,
        sqlitePath: temporaryHome,
        settingsPath,
      },
      runtimeLogger: {
        warn: () => undefined,
      },
      modelCallProviderService: {
        streamModelCall: async function* (): AsyncIterable<RuntimeEvent> {},
        completeModelCall: async (): Promise<LegacyModelCallCompletionResult> => ({ ok: true, text: '' }),
        cancelModelCall: () => false,
      },
      memorySettingsProvider: {
        isMemoryEnabled: () => false,
      },
    });

    runtime.settings.update({
      language: 'zh-CN',
      theme: 'sage-mist',
      setup: {
        completed: true,
        completedAt: '2026-06-29T15:00:00.000Z',
      },
    });

    expect(JSON.parse(await readFile(settingsPath, 'utf8'))).toEqual({
      language: 'zh-CN',
      theme: 'sage-mist',
      setup: {
        completed: true,
        completed_at: '2026-06-29T15:00:00.000Z',
      },
    });

    runtime.dispose();
    runtime = composeCodingAgentHostInterface({
      homePaths: {
        homePath: temporaryHome,
        sqlitePath: temporaryHome,
        settingsPath,
      },
      runtimeLogger: {
        warn: () => undefined,
      },
      modelCallProviderService: {
        streamModelCall: async function* (): AsyncIterable<RuntimeEvent> {},
        completeModelCall: async (): Promise<LegacyModelCallCompletionResult> => ({ ok: true, text: '' }),
        cancelModelCall: () => false,
      },
      memorySettingsProvider: {
        isMemoryEnabled: () => false,
      },
    });

    expect(runtime.settings.get().settings.setup.completed).toBe(true);
    expect(runtime.settings.get().settings.theme).toBe('sage-mist');
  });

  it('persists provider settings to the same home settings.json by default', async () => {
    temporaryHome = await mkdtemp(path.join(os.tmpdir(), 'megumi-host-provider-file-'));
    const settingsPath = path.join(temporaryHome, 'settings.json');

    runtime = composeCodingAgentHostInterface({
      homePaths: {
        homePath: temporaryHome,
        sqlitePath: temporaryHome,
        settingsPath,
      },
      runtimeLogger: {
        warn: () => undefined,
      },
      modelCallProviderService: {
        streamModelCall: async function* (): AsyncIterable<RuntimeEvent> {},
        completeModelCall: async (): Promise<LegacyModelCallCompletionResult> => ({ ok: true, text: '' }),
        cancelModelCall: () => false,
      },
      memorySettingsProvider: {
        isMemoryEnabled: () => false,
      },
    });

    await runtime.settings.provider.update({
      providerId: 'openai',
      enabled: true,
      baseUrl: 'https://api.openai.com/v1',
      modelIds: ['gpt-5.5'],
    });
    await runtime.settings.provider.setApiKey({
      providerId: 'openai',
      apiKey: 'sk-test-secret',
    });

    expect(JSON.parse(await readFile(settingsPath, 'utf8'))).toEqual({
      providers: {
        openai: {
          enabled: true,
          base_url: 'https://api.openai.com/v1',
          models: ['gpt-5.5'],
          api_key: 'sk-test-secret',
        },
      },
    });
  });
});

