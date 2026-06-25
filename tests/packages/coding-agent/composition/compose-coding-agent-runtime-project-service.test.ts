// @vitest-environment node
// Verifies the composed product runtime exposes a project service that works
// without any UI shell injecting a directory picker (defaults to a no-op picker
// that cancels), proving project lifecycle is product behavior.
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

function appSettingsProvider() {
  let rawSettings: AppSettingsRaw = {};
  return {
    getResolvedSettings: () => resolveAppSettings(rawSettings),
    updateSettings(patch: AppSettingsRaw) {
      rawSettings = mergeRawAppSettings(rawSettings, patch);
      return resolveAppSettings(rawSettings);
    },
  };
}

describe('composed runtime project service', () => {
  let home: string | undefined;
  let runtime: CodingAgentProductRuntime | undefined;

  afterEach(async () => {
    runtime?.dispose();
    runtime = undefined;
    if (home) {
      await rm(home, { recursive: true, force: true });
      home = undefined;
    }
  });

  it('exposes a project service whose useExistingProject cancels without a picker', async () => {
    home = await mkdtemp(path.join(os.tmpdir(), 'megumi-project-service-'));
    runtime = composeCodingAgentRuntime({
      homePaths: { homePath: home, sqlitePath: home, settingsPath: path.join(home, 'settings.json') },
      runtimeLogger: { warn: () => undefined },
      modelStepProviderService: {
        streamModelStep: async function* () {},
        completeModelStep: async () => ({ ok: true, text: '' }),
        cancelModelStep: () => false,
      } as never,
      appSettingsProvider: appSettingsProvider(),
      memorySettingsProvider: { isMemoryEnabled: () => false },
      permissionSettingsProvider: { loadForProject: async () => ({ allow: [], ask: [], deny: [] }) },
    });

    expect(await runtime.projectService.useExistingProject()).toEqual({ cancelled: true });
    expect(runtime.projectService.listProjects()).resolves.toEqual([]);
  });

  it('upserts and lists a project when a directory picker is injected', async () => {
    home = await mkdtemp(path.join(os.tmpdir(), 'megumi-project-service-picker-'));
    runtime = composeCodingAgentRuntime({
      homePaths: { homePath: home, sqlitePath: home, settingsPath: path.join(home, 'settings.json') },
      runtimeLogger: { warn: () => undefined },
      modelStepProviderService: {
        streamModelStep: async function* () {},
        completeModelStep: async () => ({ ok: true, text: '' }),
        cancelModelStep: () => false,
      } as never,
      appSettingsProvider: appSettingsProvider(),
      memorySettingsProvider: { isMemoryEnabled: () => false },
      permissionSettingsProvider: { loadForProject: async () => ({ allow: [], ask: [], deny: [] }) },
      directoryPicker: { chooseDirectory: async () => ({ canceled: false, filePaths: [home!] }) },
    });

    const result = await runtime.projectService.useExistingProject();
    expect(result.cancelled).toBe(false);
    const listed = await runtime.projectService.listProjects();
    expect(listed.length).toBe(1);
  });
});
