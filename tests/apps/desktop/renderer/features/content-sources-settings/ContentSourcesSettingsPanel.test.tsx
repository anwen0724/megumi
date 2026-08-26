// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
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

  beforeEach(() => {
    getSettings.mockReset().mockResolvedValue(ok({
      status: 'ok',
      settings: settings(),
      unknownKeys: [],
    }));
    updateSettings.mockReset().mockResolvedValue(ok({ status: 'updated', settings: settings() }));
    getCredential.mockReset().mockImplementation(async (request) => ok({
      status: 'ok', sourceId: request.payload.sourceId, configured: false,
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
    Object.defineProperty(window, 'megumi', {
      configurable: true,
      value: {
        settings: {
          get: getSettings,
          update: updateSettings,
          getDiscoverySourceCredentialStatus: getCredential,
          setDiscoverySourceCredential: setCredential,
          deleteDiscoverySourceCredential: deleteCredential,
        },
        discovery: { getConfiguration, connectSource, refreshSource },
      },
    });
  });

  it('saves provider credentials without reading them back and opens browser login', async () => {
    const user = userEvent.setup();
    render(<ContentSourcesSettingsPanel />);

    const secret = await screen.findByLabelText('知乎 Access Secret');
    await user.type(secret, 'zhihu-secret');
    await user.click(screen.getByRole('button', { name: 'Save 知乎 credential' }));

    await waitFor(() => expect(setCredential).toHaveBeenCalledWith(expect.objectContaining({
      payload: { sourceId: 'zhihu', credential: 'zhihu-secret' },
    })));
    expect(secret).toHaveValue('');
    expect(screen.queryByDisplayValue('zhihu-secret')).not.toBeInTheDocument();
    expect(screen.getByText('Configured', { selector: '[data-source-id="zhihu"] *' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Log in again 小红书' }));
    expect(connectSource).toHaveBeenCalledWith(expect.objectContaining({
      payload: { sourceId: 'xiaohongshu' },
    }));

    await user.click(screen.getByRole('button', { name: 'Check again' }));
    expect(refreshSource).toHaveBeenCalledWith(expect.objectContaining({
      payload: { sourceId: 'bilibili' },
    }));
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
