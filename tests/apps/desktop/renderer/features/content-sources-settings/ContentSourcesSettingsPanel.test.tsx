// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContentSourcesSettingsPanel } from '@megumi/desktop/renderer/features/content-sources-settings';

describe('ContentSourcesSettingsPanel', () => {
  const getSettings = vi.fn();
  const updateSettings = vi.fn();
  const getCredential = vi.fn();
  const setCredential = vi.fn();
  const deleteCredential = vi.fn();
  const getConfiguration = vi.fn();
  const connectSource = vi.fn();
  const refreshSource = vi.fn();
  const refreshSources = vi.fn();
  const getWebSearchApiKey = vi.fn();

  beforeEach(() => {
    getSettings.mockReset().mockResolvedValue(ok({
      status: 'ok',
      settings: settings(),
      unknownKeys: [],
    }));
    updateSettings.mockReset().mockResolvedValue(ok({ status: 'updated', settings: settings() }));
    getCredential.mockReset().mockImplementation(async (request) => ok({
      status: 'ok', sourceId: request.payload.sourceId, configured: request.payload.sourceId === 'zhihu',
      ...(request.payload.sourceId === 'zhihu' ? { credential: 'saved-zhihu-secret' } : {}),
    }));
    setCredential.mockReset().mockImplementation(async (request) => ok({
      status: 'ok', sourceId: request.payload.sourceId, configured: true,
    }));
    deleteCredential.mockReset().mockImplementation(async (request) => ok({
      status: 'ok', sourceId: request.payload.sourceId, configured: false,
    }));
    getConfiguration.mockReset().mockResolvedValue(ok(configuration()));
    connectSource.mockReset().mockImplementation(async (request) => ok(
      configuration().sources.find((source) => source.sourceId === request.payload.sourceId),
    ));
    refreshSource.mockReset().mockImplementation(async (request) => ok(
      configuration().sources.find((source) => source.sourceId === request.payload.sourceId),
    ));
    refreshSources.mockReset().mockResolvedValue(ok(configuration()));
    getWebSearchApiKey.mockReset().mockResolvedValue(ok({ status: 'found', value: 'web-secret', source: 'settings' }));
    Object.defineProperty(window, 'megumi', {
      configurable: true,
      value: {
        settings: {
          get: getSettings,
          update: updateSettings,
          getWebSearchApiKey,
          getDiscoverySourceCredential: getCredential,
          setDiscoverySourceCredential: setCredential,
          deleteDiscoverySourceCredential: deleteCredential,
        },
        discovery: { getConfiguration, connectSource, refreshSource, refreshSources },
      },
    });
  });

  it('reveals saved credentials on demand, opens browser login, and checks all sources together', async () => {
    const user = userEvent.setup();
    render(<ContentSourcesSettingsPanel />);

    await screen.findAllByRole('button', { name: 'Configure' });
    const zhihuRow = document.querySelector('[data-source-id="zhihu"]');
    if (!zhihuRow) throw new Error('Expected the Zhihu source row.');
    await user.click(within(zhihuRow as HTMLElement).getByRole('button', { name: 'Configure' }));
    const secret = within(zhihuRow as HTMLElement).getByLabelText('知乎 Access Secret');
    expect(secret).toHaveAttribute('type', 'password');
    expect(secret).toHaveValue('saved-zhihu-secret');
    await user.click(within(zhihuRow as HTMLElement).getByRole('button', { name: 'Show API key' }));
    expect(secret).toHaveAttribute('type', 'text');
    await user.clear(secret);
    await user.type(secret, 'zhihu-secret');
    await user.click(within(zhihuRow as HTMLElement).getByRole('button', { name: 'Save 知乎 credential' }));

    await waitFor(() => expect(setCredential).toHaveBeenCalledWith(expect.objectContaining({
      payload: { sourceId: 'zhihu', credential: 'zhihu-secret' },
    })));
    expect(secret).toHaveValue('zhihu-secret');
    expect(screen.getByText('Configured', { selector: '[data-source-id="zhihu"] *' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Log in to 小红书' }));
    expect(connectSource).toHaveBeenCalledWith(expect.objectContaining({
      payload: { sourceId: 'xiaohongshu' },
    }));

    await user.click(screen.getByRole('button', { name: 'Check all sources' }));
    expect(refreshSources).toHaveBeenCalledWith(expect.objectContaining({ payload: {} }));
    expect(refreshSource).not.toHaveBeenCalled();
  });
});

function settings() {
  return {
    language: 'zh-CN', theme: 'midnight-blue', setup: { completed: true }, memory: { enabled: false },
    voice: {
      inputDeviceId: 'default', outputDeviceId: 'default', recognitionLanguage: 'auto',
      readAloudEnabled: false,
      tts: { provider: 'minimax', voiceId: 'default', hasApiKey: false, credentialSource: 'missing' },
    },
    web: { search: { provider: 'brave', hasApiKey: true, credentialSource: 'settings' } },
    providers: {}, permissions: { mode: 'ask', rules: [], catalog: { operations: [], tools: [] } },
  };
}

function configuration() {
  return {
    conversationRecognitionEnabled: false,
    dailyGenerationTime: '08:00',
    dailyTargetCount: 20,
    sources: [
      source('bilibili', '哔哩哔哩', 'public_http', 'ready'),
      source('open_web', '开放 Web', 'configured_provider', 'ready'),
      source('xiaohongshu', '小红书', 'browser_session', 'login_required'),
      source('douyin', '抖音', 'browser_session', 'login_required'),
      source('zhihu', '知乎', 'configured_provider', 'not_configured'),
      source('twitter', 'X (Twitter)', 'configured_provider', 'not_configured'),
    ],
  };
}

function source(sourceId: string, name: string, access: string, connectionState: string) {
  return {
    sourceId, name, access, connectionState, enabled: true,
    supportedModes: ['relevance'], supportsRead: false,
  };
}

function ok(data: unknown) {
  return { ok: true, data, meta: {} };
}
