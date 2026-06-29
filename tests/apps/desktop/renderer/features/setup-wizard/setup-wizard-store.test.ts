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
          chat: { defaultProvider: 'deepseek' },
          providers: {},
          permissions: {},
        },
      },
    });

    await useSetupWizardStore.getState().hydrate();

    expect(useSetupWizardStore.getState().status).toBe('ready');
    expect(useSetupWizardStore.getState().setupCompleted).toBe(false);
  });

  it('completes setup and clears the transient API key from state', async () => {
    settingsUpdate.mockResolvedValue({
      ok: true,
      data: {
        settings: {
          language: 'en-US',
          theme: 'graphite-dark',
          setup: { completed: true, completedAt: '2026-06-29T12:00:00.000Z' },
          memory: { enabled: false },
          compaction: { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 },
          chat: { defaultProvider: 'openai' },
          providers: {},
          permissions: {},
        },
      },
    });
    providerUpdate.mockResolvedValue({ ok: true, data: {} });
    providerSetApiKey.mockResolvedValue({ ok: true, data: {} });

    await useSetupWizardStore.getState().completeSetup({
      language: 'en-US',
      theme: 'graphite-dark',
      providerId: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      defaultModelId: 'gpt-5.5',
      apiKey: 'sk-test-secret',
      completedAt: '2026-06-29T12:00:00.000Z',
    });

    expect(providerUpdate).toHaveBeenCalledWith(expect.objectContaining({
      payload: {
        providerId: 'openai',
        enabled: true,
        baseUrl: 'https://api.openai.com/v1',
        defaultModelId: 'gpt-5.5',
      },
    }));
    expect(providerSetApiKey).toHaveBeenCalledWith(expect.objectContaining({
      payload: {
        providerId: 'openai',
        apiKey: 'sk-test-secret',
      },
    }));
    expect(settingsUpdate).toHaveBeenCalledWith(expect.objectContaining({
      payload: {
        language: 'en-US',
        theme: 'graphite-dark',
        chat: { defaultProvider: 'openai' },
        setup: {
          completed: true,
          completedAt: '2026-06-29T12:00:00.000Z',
        },
      },
    }));
    expect(JSON.stringify(useSetupWizardStore.getState())).not.toContain('sk-test-secret');
    expect(useSetupWizardStore.getState().setupCompleted).toBe(true);
  });

  it('allows completing setup without provider credentials', async () => {
    settingsUpdate.mockResolvedValue({
      ok: true,
      data: {
        settings: {
          language: 'zh-CN',
          theme: 'midnight-blue',
          setup: { completed: true },
          memory: { enabled: false },
          compaction: { enabled: true, reserveTokens: 16384, keepRecentTokens: 20000 },
          chat: { defaultProvider: 'deepseek' },
          providers: {},
          permissions: {},
        },
      },
    });

    await useSetupWizardStore.getState().completeSetup({
      language: 'zh-CN',
      theme: 'midnight-blue',
      providerId: 'deepseek',
      defaultModelId: 'deepseek-v4-flash',
      skipProvider: true,
      completedAt: '2026-06-29T12:00:00.000Z',
    });

    expect(providerUpdate).not.toHaveBeenCalled();
    expect(providerSetApiKey).not.toHaveBeenCalled();
    expect(settingsUpdate).toHaveBeenCalled();
  });
});
