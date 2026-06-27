// Verifies the product runtime builds a real model step provider by default,
// so it can call models standalone without a UI shell supplying one.
// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { composeCodingAgentRuntime } from '@megumi/coding-agent/composition';
import {
  mergeRawAppSettings,
  resolveAppSettings,
  type AppSettingsRaw,
} from '@megumi/shared/settings';
import type { CodingAgentProductRuntime } from '@megumi/coding-agent/product-runtime';

describe('Coding Agent product runtime default model step provider', () => {
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

  it('composes a runnable session runtime without a caller-provided model step provider', async () => {
    temporaryHome = await mkdtemp(path.join(os.tmpdir(), 'megumi-default-model-step-'));
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
      // No modelStepProviderService: the product must build its own.
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

    expect(runtime.sessionService).toBeDefined();
    expect(runtime.agentRunService).toBeDefined();
    expect(typeof runtime.agentRunService.sendSessionMessage).toBe('function');
  });
});
