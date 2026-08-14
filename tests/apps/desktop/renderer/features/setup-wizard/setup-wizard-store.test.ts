// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSetupWizardStore } from '@megumi/desktop/renderer/features/setup-wizard';
import { useProviderStore } from '@megumi/desktop/renderer/entities/provider';
import { useModelSelectionStore } from '@megumi/desktop/renderer/entities/model-selection';

const settingsUpdate = vi.fn();
const settingsCompleteSetup = vi.fn();
const providerUpdate = vi.fn();
const providerSetApiKey = vi.fn();
const providerList = vi.fn();

function installMegumiMock() {
  Object.defineProperty(window, 'megumi', {
    configurable: true,
    value: {
      settings: {
        update: settingsUpdate,
        completeSetup: settingsCompleteSetup,
      },
      provider: {
        update: providerUpdate,
        setApiKey: providerSetApiKey,
        list: providerList,
      },
    },
  });
}

describe('setup wizard store', () => {
  beforeEach(() => {
    installMegumiMock();
    settingsUpdate.mockReset();
    settingsCompleteSetup.mockReset();
    providerUpdate.mockReset();
    providerSetApiKey.mockReset();
    providerList.mockReset();
    useSetupWizardStore.setState(useSetupWizardStore.getInitialState(), true);
    useProviderStore.setState({ providers: [], catalog: [], status: 'idle', error: null });
    useModelSelectionStore.setState({ selection: undefined });
  });

  it('accepts the bootstrap language and setup projection synchronously', () => {
    useSetupWizardStore.getState().applyBootstrapSettings({ language: 'zh-CN', setupCompleted: false });

    expect(useSetupWizardStore.getState()).toMatchObject({
      status: 'ready',
      language: 'zh-CN',
      setupCompleted: false,
      error: null,
    });
  });

  it('completes setup with one settings update and clears the transient API key from state', async () => {
    settingsCompleteSetup.mockResolvedValue({
      ok: true,
      data: {
        settings: {
          language: 'en-US',
          theme: 'graphite-dark',
          setup: { completed: true, completedAt: '2026-06-29T12:00:00.000Z' },
          memory: { enabled: false },
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
      apiKey: 'TEST_API_KEY_VALUE',
    });

    expect(providerUpdate).not.toHaveBeenCalled();
    expect(providerSetApiKey).not.toHaveBeenCalled();
    expect(settingsUpdate).not.toHaveBeenCalled();
    expect(settingsCompleteSetup).toHaveBeenCalledWith(expect.objectContaining({
      payload: {
        language: 'en-US',
        theme: 'graphite-dark',
        provider: {
          providerId: 'openai',
            enabled: true,
            baseUrl: 'https://api.openai.com/v1',
          modelIds: ['gpt-5.5'],
            apiKey: 'TEST_API_KEY_VALUE',
        },
      },
    }));
    expect(settingsCompleteSetup).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(useSetupWizardStore.getState())).not.toContain('TEST_API_KEY_VALUE');
    expect(useSetupWizardStore.getState().setupCompleted).toBe(true);
  });

  it('refreshes provider and model projections after setup completes', async () => {
    providerList.mockResolvedValue({
      ok: true,
      data: {
        status: 'ok',
        providers: [{
          providerId: 'deepseek',
          displayName: 'DeepSeek',
          enabled: true,
          protocol: 'openai-completions',
          modelIds: ['deepseek-v4-flash'],
          hasApiKey: true,
          credentialSource: 'settings',
        }],
        catalog: [],
      },
    });
    settingsCompleteSetup.mockResolvedValue({
      ok: true,
      data: {
        status: 'completed',
        settings: {
          language: 'zh-CN',
          theme: 'midnight-blue',
          setup: { completed: true, completedAt: '2026-06-29T12:00:00.000Z' },
          memory: { enabled: false },
          modelSelection: { providerId: 'deepseek', modelId: 'deepseek-v4-flash' },
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
      apiKey: 'TEST_API_KEY_VALUE',
    });

    expect(providerList).toHaveBeenCalledTimes(1);
    expect(useProviderStore.getState().providers).toEqual([
      expect.objectContaining({ providerId: 'deepseek' }),
    ]);
    expect(useModelSelectionStore.getState().selection).toEqual({
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
    });
  });

  it('writes setup completion to settings when provider configuration is skipped', async () => {
    settingsCompleteSetup.mockResolvedValue({
      ok: true,
      data: {
        settings: {
          language: 'zh-CN',
          theme: 'sage-mist',
          setup: { completed: true, completedAt: '2026-06-29T12:00:00.000Z' },
          memory: { enabled: false },
          providers: {},
          permissions: {},
        },
      },
    });

    await useSetupWizardStore.getState().completeSetup({
      language: 'zh-CN',
      theme: 'sage-mist',
      modelIds: [],
      skipProvider: true,
    });

    expect(providerUpdate).not.toHaveBeenCalled();
    expect(providerSetApiKey).not.toHaveBeenCalled();
    expect(settingsUpdate).not.toHaveBeenCalled();
    expect(settingsCompleteSetup).toHaveBeenCalledWith(expect.objectContaining({
      payload: {
        language: 'zh-CN',
        theme: 'sage-mist',
      },
    }));
    expect(settingsCompleteSetup).toHaveBeenCalledTimes(1);
    expect(useSetupWizardStore.getState().setupCompleted).toBe(true);
  });

  it('does not leave the wizard when settings update does not confirm setup completion', async () => {
    settingsCompleteSetup.mockResolvedValue({
      ok: true,
      data: {
        settings: {
          language: 'zh-CN',
          theme: 'midnight-blue',
          setup: { completed: false },
          memory: { enabled: false },
          providers: {},
          permissions: {},
        },
      },
    });

    await useSetupWizardStore.getState().completeSetup({
      language: 'zh-CN',
      theme: 'midnight-blue',
      modelIds: ['deepseek-v4-flash'],
      skipProvider: true,
    });

    expect(useSetupWizardStore.getState()).toMatchObject({
      status: 'error',
      setupCompleted: false,
      error: { code: 'setup_incomplete' },
    });
  });
});
