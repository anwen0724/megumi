// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSetupWizardStore } from '@megumi/desktop/renderer/features/setup-wizard';

const settingsGet = vi.fn();
const settingsUpdate = vi.fn();
const providerUpdate = vi.fn();
const providerSetApiKey = vi.fn();

function installMegumiMock() {
  Object.defineProperty(window, 'megumi', {
    configurable: true,
    value: {
      settings: {
        get: settingsGet,
        update: settingsUpdate,
      },
      provider: {
        update: providerUpdate,
        setApiKey: providerSetApiKey,
      },
    },
  });
}

describe('setup wizard store', () => {
  beforeEach(() => {
    installMegumiMock();
    settingsGet.mockReset();
    settingsUpdate.mockReset();
    providerUpdate.mockReset();
    providerSetApiKey.mockReset();
    useSetupWizardStore.setState(useSetupWizardStore.getInitialState(), true);
  });

  it('detects incomplete setup from settings', async () => {
    settingsGet.mockResolvedValue({
      ok: true,
      data: {
        settings: {
          language: 'zh-CN',
          theme: 'midnight-blue',
          setup: { completed: false },
          memory: { enabled: false },
          compaction: { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 },
          providers: {},
          permissions: {},
        },
      },
    });

    await useSetupWizardStore.getState().hydrate();

    expect(useSetupWizardStore.getState().status).toBe('ready');
    expect(useSetupWizardStore.getState().setupCompleted).toBe(false);
  });

  it('completes setup with one settings update and clears the transient API key from state', async () => {
    settingsUpdate.mockResolvedValue({
      ok: true,
      data: {
        settings: {
          language: 'en-US',
          theme: 'graphite-dark',
          setup: { completed: true, completedAt: '2026-06-29T12:00:00.000Z' },
          memory: { enabled: false },
          compaction: { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 },
          providers: {},
          permissions: {},
        },
      },
    });
    await useSetupWizardStore.getState().completeSetup({
      language: 'en-US',
      theme: 'graphite-dark',
      providerId: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      modelIds: ['gpt-5.5'],
      apiKey: 'sk-test-secret',
      completedAt: '2026-06-29T12:00:00.000Z',
    });

    expect(providerUpdate).not.toHaveBeenCalled();
    expect(providerSetApiKey).not.toHaveBeenCalled();
    expect(settingsUpdate).toHaveBeenCalledWith(expect.objectContaining({
      payload: {
        language: 'en-US',
        theme: 'graphite-dark',
        providers: {
          openai: {
            enabled: true,
            baseUrl: 'https://api.openai.com/v1',
            models: ['gpt-5.5'],
            apiKey: 'sk-test-secret',
          },
        },
        setup: {
          completed: true,
          completedAt: '2026-06-29T12:00:00.000Z',
        },
      },
    }));
    expect(settingsUpdate).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(useSetupWizardStore.getState())).not.toContain('sk-test-secret');
    expect(useSetupWizardStore.getState().setupCompleted).toBe(true);
  });

  it('writes setup completion to settings when provider configuration is skipped', async () => {
    settingsUpdate.mockResolvedValue({
      ok: true,
      data: {
        settings: {
          language: 'zh-CN',
          theme: 'sage-mist',
          setup: { completed: true, completedAt: '2026-06-29T12:00:00.000Z' },
          memory: { enabled: false },
          compaction: { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 },
          providers: {},
          permissions: {},
        },
      },
    });

    await useSetupWizardStore.getState().completeSetup({
      language: 'zh-CN',
      theme: 'sage-mist',
      providerId: 'deepseek',
      modelIds: [],
      skipProvider: true,
      completedAt: '2026-06-29T12:00:00.000Z',
    });

    expect(providerUpdate).not.toHaveBeenCalled();
    expect(providerSetApiKey).not.toHaveBeenCalled();
    expect(settingsUpdate).toHaveBeenCalledWith(expect.objectContaining({
      payload: {
        language: 'zh-CN',
        theme: 'sage-mist',
        setup: {
          completed: true,
          completedAt: '2026-06-29T12:00:00.000Z',
        },
      },
    }));
    expect(settingsUpdate).toHaveBeenCalledTimes(1);
    expect(useSetupWizardStore.getState().setupCompleted).toBe(true);
  });

  it('does not leave the wizard when settings update does not confirm setup completion', async () => {
    settingsUpdate.mockResolvedValue({
      ok: true,
      data: {
        settings: {
          language: 'zh-CN',
          theme: 'midnight-blue',
          setup: { completed: false },
          memory: { enabled: false },
          compaction: { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 },
          providers: {},
          permissions: {},
        },
      },
    });

    await useSetupWizardStore.getState().completeSetup({
      language: 'zh-CN',
      theme: 'midnight-blue',
      providerId: 'deepseek',
      modelIds: ['deepseek-v4-flash'],
      skipProvider: true,
      completedAt: '2026-06-29T12:00:00.000Z',
    });

    expect(useSetupWizardStore.getState()).toMatchObject({
      status: 'error',
      setupCompleted: false,
      error: 'Setup completion was not saved.',
    });
  });
});
