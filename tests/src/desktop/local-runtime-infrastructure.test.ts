// @vitest-environment node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createLocalDesktopRuntime } from '../../../src/desktop';
import type { DesktopHostAdapters } from '../../../src/desktop/composition/create-host-adapters';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fsp.rm(root, { recursive: true, force: true })));
});

async function tempRoot(): Promise<string> {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'megumi-local-infra-'));
  roots.push(root);
  return root;
}

function fakeHosts(root: string, env: Record<string, string | undefined> = { DEEPSEEK_API_KEY: 'sk-env-secret' }): DesktopHostAdapters {
  return {
    clipboardHost: { readText: () => '', writeText: () => undefined },
    dialogHost: { openProjectDirectory: async () => root },
    environmentHost: { get: (key) => env[key] },
    fileHost: {
      readFile: (filePath) => fs.promises.readFile(filePath),
      writeFile: (filePath, data) => fs.promises.writeFile(filePath, data),
    },
    megumiHomeHost: { getMegumiHome: () => path.join(root, '.megumi') },
    processHost: { spawn },
    secureStorageHost: {
      encrypt: (value) => Buffer.from(value, 'utf8'),
      decrypt: (value) => value.toString('utf8'),
      isAvailable: () => true,
    },
    shellHost: { openPath: async () => undefined },
  };
}

describe('local runtime desktop infrastructure composition', () => {
  it('initializes home, database path, stores, provider resolver, project repository, and logger', async () => {
    const root = await tempRoot();
    const runtime = createLocalDesktopRuntime({
      hosts: fakeHosts(root),
      workspaceRoot: root,
      now: () => '2026-06-19T00:00:00.000Z',
    });

    expect(runtime.megumiHomePaths.databasePath).toBe(path.join(root, '.megumi', 'sqlite', 'megumi.sqlite3'));
    expect(fs.existsSync(runtime.megumiHomePaths.versionPath)).toBe(true);
    expect(runtime.settingsStore.getResolvedSettings().chat.defaultProvider).toBe('deepseek');
    await expect(runtime.providerSettingsStore.resolveCredential('deepseek')).resolves.toEqual({
      type: 'api_key',
      value: 'sk-env-secret',
    });
    const project = runtime.projectRepository.upsertFromPath({
      path: root,
      name: 'workspace',
      status: 'available',
      now: '2026-06-19T00:00:00.000Z',
    });
    expect(runtime.projectRepository.listProjects()).toEqual([project]);
    runtime.runtimeLogger.info('runtime.started', { apiKey: 'sk-runtime-secret' });
    expect(fs.readFileSync(runtime.megumiHomePaths.runtimeLogPath, 'utf8')).not.toContain('sk-runtime-secret');

    await runtime.stop();
  });

  it('resolves runtime provider credentials from customized environment keys', async () => {
    const root = await tempRoot();
    const runtime = createLocalDesktopRuntime({
      hosts: fakeHosts(root, { CUSTOM_DEEPSEEK_KEY: 'sk-custom-runtime-env' }),
      workspaceRoot: root,
      now: () => '2026-06-19T00:00:00.000Z',
    });

    runtime.providerSettingsStore.updateProviderSettings('deepseek', {
      apiKeyEnv: 'CUSTOM_DEEPSEEK_KEY',
    });

    expect(runtime.providerSettingsStore.listProviderStatuses().find((provider) => provider.providerId === 'deepseek')).toMatchObject({
      providerId: 'deepseek',
      hasApiKey: true,
      credentialSource: 'environment',
      envOverrideActive: true,
      apiKeyEnv: 'CUSTOM_DEEPSEEK_KEY',
    });
    await expect(runtime.providerSettingsStore.resolveCredential('deepseek')).resolves.toEqual({
      type: 'api_key',
      value: 'sk-custom-runtime-env',
    });

    await runtime.stop();
  });
});
