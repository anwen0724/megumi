// Verifies the host interface builds a real model step provider by default,
// so it can call models standalone without a UI shell supplying one.
// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { composeCodingAgentRuntime } from '@megumi/coding-agent/composition';
import {
  createSettingsService,
  type SettingsRaw,
} from '@megumi/coding-agent/settings';
import type { CodingAgentHostInterface } from '@megumi/coding-agent/host-interface';

function memorySettingsService(initial: SettingsRaw = {}) {
  let rawSettings = initial;
  return createSettingsService({
    file_store: {
      readRawSettings: () => rawSettings,
      writeRawSettings(next) {
        rawSettings = next;
      },
    },
  });
}

describe('Coding Agent host interface default model step provider', () => {
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

  it('composes a runnable session runtime without a caller-provided model step provider', async () => {
    temporaryHome = await mkdtemp(path.join(os.tmpdir(), 'megumi-default-model-step-'));

    runtime = composeCodingAgentRuntime({
      homePaths: {
        homePath: temporaryHome,
        sqlitePath: temporaryHome,
        settingsPath: path.join(temporaryHome, 'settings.json'),
      },
      runtimeLogger: {
        warn: () => undefined,
      },
      // No modelCallProviderService: the product must build its own.
      appSettingsProvider: memorySettingsService(),
      memorySettingsProvider: {
        isMemoryEnabled: () => false,
      },
      permissionSettingsProvider: {
        loadForProject: async () => ({ allow: [], ask: [], deny: [] }),
      },
    });

    expect(runtime.session).toBeDefined();
    expect(typeof runtime.input.send).toBe('function');
  });
});

