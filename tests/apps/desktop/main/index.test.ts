// @vitest-environment node
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const homePath = 'C:/tmp/megumi-runtime-logger-review';
  const logsPath = `${homePath}/logs`;
  return {
    homePath,
    logsPath,
    loadEnvFile: vi.fn(),
    initializeElectronMegumiHomeSync: vi.fn(() => ({
      homePath,
      configPath: `${homePath}/config.json`,
      configSchemaPath: `${homePath}/config.schema.json`,
      readmePath: `${homePath}/README.md`,
      versionPath: `${homePath}/version.json`,
      sqlitePath: `${homePath}/sqlite`,
      secretsPath: `${homePath}/secrets`,
      providerSecretsPath: `${homePath}/secrets/providers`,
      logsPath,
      cachePath: `${homePath}/cache`,
      tmpPath: `${homePath}/tmp`,
    })),
    registerAllHandlers: vi.fn(),
    registerRuntimeProcessErrorHandlers: vi.fn(),
    registerAppLifecycle: vi.fn(),
    createMainWindow: vi.fn(),
  };
});

vi.mock('@megumi/desktop/main/config/env', () => ({
  loadEnvFile: mocks.loadEnvFile,
}));

vi.mock('@megumi/desktop/main/services/megumi-home.service', () => ({
  initializeElectronMegumiHomeSync: mocks.initializeElectronMegumiHomeSync,
}));

vi.mock('@megumi/desktop/main/ipc/register-handlers', () => ({
  registerAllHandlers: mocks.registerAllHandlers,
}));

vi.mock('@megumi/desktop/main/app/runtime-process-errors', () => ({
  registerRuntimeProcessErrorHandlers: mocks.registerRuntimeProcessErrorHandlers,
}));

vi.mock('@megumi/desktop/main/app/lifecycle', () => ({
  registerAppLifecycle: mocks.registerAppLifecycle,
}));

vi.mock('@megumi/desktop/main/app/create-window', () => ({
  createMainWindow: mocks.createMainWindow,
}));

describe('main runtime logger composition', () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.loadEnvFile.mockClear();
    mocks.initializeElectronMegumiHomeSync.mockClear();
    mocks.registerAllHandlers.mockClear();
    mocks.registerRuntimeProcessErrorHandlers.mockClear();
    mocks.registerAppLifecycle.mockClear();
    mocks.createMainWindow.mockClear();
    rmSync(mocks.homePath, { recursive: true, force: true });
  });

  afterEach(() => {
    rmSync(mocks.homePath, { recursive: true, force: true });
  });

  it('wires a Megumi Home JSONL runtime logger into process and IPC registration paths', async () => {
    await import('@megumi/desktop/main/index');

    const processLogger = mocks.registerRuntimeProcessErrorHandlers.mock.calls[0]?.[0]?.logger;
    expect(processLogger).toEqual(expect.objectContaining({
      error: expect.any(Function),
      warn: expect.any(Function),
      info: expect.any(Function),
    }));

    const lifecycleOptions = mocks.registerAppLifecycle.mock.calls[0]?.[0];
    lifecycleOptions.registerAllHandlers();

    expect(mocks.registerAllHandlers).toHaveBeenCalledWith({ logger: processLogger });

    processLogger.error('runtime_review_probe', {
      authorization: 'Bearer sk-runtime-secret',
    });

    const logText = readFileSync(join(mocks.logsPath, 'runtime.jsonl'), 'utf8');
    expect(logText).toContain('runtime_review_probe');
    expect(logText).not.toContain('sk-runtime-secret');
    expect(logText).not.toContain('Bearer sk-runtime-secret');
  });
});
