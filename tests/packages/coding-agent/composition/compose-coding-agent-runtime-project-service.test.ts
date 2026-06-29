// @vitest-environment node
// Verifies the composed host interface exposes a project service that works
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
import type { CodingAgentHostInterface } from '@megumi/coding-agent/host-interface';

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
  let runtime: CodingAgentHostInterface | undefined;

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
      modelCallProviderService: {
        streamModelCall: async function* () {},
        completeModelCall: async () => ({ ok: true, text: '' }),
        cancelModelCall: () => false,
      } as never,
      appSettingsProvider: appSettingsProvider(),
      memorySettingsProvider: { isMemoryEnabled: () => false },
      permissionSettingsProvider: { loadForProject: async () => ({ allow: [], ask: [], deny: [] }) },
    });

    expect(await runtime.workspace.useExistingProject()).toEqual({ cancelled: true });
    expect(runtime.workspace.listProjects()).resolves.toEqual([]);
  });

  it('upserts and lists a project when a directory picker is injected', async () => {
    home = await mkdtemp(path.join(os.tmpdir(), 'megumi-project-service-picker-'));
    runtime = composeCodingAgentRuntime({
      homePaths: { homePath: home, sqlitePath: home, settingsPath: path.join(home, 'settings.json') },
      runtimeLogger: { warn: () => undefined },
      modelCallProviderService: {
        streamModelCall: async function* () {},
        completeModelCall: async () => ({ ok: true, text: '' }),
        cancelModelCall: () => false,
      } as never,
      appSettingsProvider: appSettingsProvider(),
      memorySettingsProvider: { isMemoryEnabled: () => false },
      permissionSettingsProvider: { loadForProject: async () => ({ allow: [], ask: [], deny: [] }) },
      directoryPicker: { chooseDirectory: async () => ({ canceled: false, filePaths: [home!] }) },
    });

    const result = await runtime.workspace.useExistingProject();
    expect(result.cancelled).toBe(false);
    const listed = await runtime.workspace.listProjects();
    expect(listed.length).toBe(1);
  });
});
