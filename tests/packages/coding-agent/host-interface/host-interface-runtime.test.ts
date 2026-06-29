// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { composeCodingAgentRuntime } from '@megumi/coding-agent/composition';
import type { RuntimeEvent } from '@megumi/shared/runtime';
import {
  mergeRawAppSettings,
  resolveAppSettings,
  type AppSettingsRaw,
} from '@megumi/shared/settings';
import type { ModelCallCompletionResult } from '@megumi/coding-agent/agent-loop/model-call';
import type { CodingAgentHostInterface } from '@megumi/coding-agent/host-interface';

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
    let rawSettings: AppSettingsRaw = {};

    runtime = composeCodingAgentRuntime({
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
        completeModelCall: async (): Promise<ModelCallCompletionResult> => ({ ok: true, text: '' }),
        cancelModelCall: () => false,
      },
      appSettingsProvider: {
        getResolvedSettings: () => resolveAppSettings(rawSettings),
        updateSettings(patch) {
          rawSettings = mergeRawAppSettings(rawSettings, patch);
          return resolveAppSettings(rawSettings);
        },
      },
      memorySettingsProvider: {
        isMemoryEnabled: () => false,
      },
      permissionSettingsProvider: {
        loadForProject: async () => ({ allow: [], ask: [], deny: [] }),
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
      providers: expect.arrayContaining([
        expect.objectContaining({ providerId: 'openai' }),
      ]),
    });
  });
});
