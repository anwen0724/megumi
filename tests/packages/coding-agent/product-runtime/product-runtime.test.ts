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
import type { ModelStepCompletionResult } from '@megumi/agent';
import type { CodingAgentProductRuntime } from '@megumi/coding-agent/product-runtime';

describe('Coding Agent product runtime', () => {
  let temporaryHome: string | undefined;
  let runtime: CodingAgentProductRuntime | undefined;

  afterEach(async () => {
    runtime?.dispose();
    runtime = undefined;
    if (temporaryHome) {
      await rm(temporaryHome, { recursive: true, force: true });
      temporaryHome = undefined;
    }
  });

  it('composes product services without importing or constructing desktop shell modules', async () => {
    temporaryHome = await mkdtemp(path.join(os.tmpdir(), 'megumi-product-runtime-'));
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
      modelStepProviderService: {
        streamModelStep: async function* (): AsyncIterable<RuntimeEvent> {},
        completeModelStep: async (): Promise<ModelStepCompletionResult> => ({ ok: true, text: '' }),
        cancelModelStep: () => false,
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

    expect(runtime.sessionRunService).toBeDefined();
    expect(runtime.recoveryService).toBeDefined();
    expect(runtime.artifactService).toBeDefined();
    expect(runtime.memoryService).toBeDefined();
    expect(runtime.runContextService).toBeDefined();
    expect(runtime.providerSettingsService).toBeDefined();
    expect(runtime.toolService.listTools().length).toBeGreaterThan(0);
    await expect(runtime.providerSettingsService.listProviderStatuses()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ providerId: 'openai' }),
      ]),
    );
  });
});
