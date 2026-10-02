/* Verifies that Discovery owns source-aware configuration while Settings only persists it. */
// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSettings } from '@megumi/application/settings/settings-store';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createDiscovery,
  createDiscoveryConfiguration,
  createSourceRegistry,
  type DiscoverySource,
} from '@megumi/application/discovery/index';

function source(
  id: string,
  access: 'public_http' | 'configured_provider' | 'browser_session',
  state: 'ready' | 'unknown' | 'not_configured' = 'ready',
): DiscoverySource {
  return {
    descriptor: { id, name: id, access, supportedModes: ['relevance'], supportsRead: false },
    getAvailability: () => ({ state }),
    async search() {
      return { status: 'success', items: [] };
    },
  };
}

describe('Discovery configuration', () => {
  it('projects registered source facts and persists only validated configuration', async () => {
    const settings = fileSettings({ candidateSupplyConfirmed: true });
    const configuration = createDiscoveryConfiguration({
      sourceRegistry: createSourceRegistry([
        source('bilibili', 'public_http'),
        source('open_web', 'configured_provider'),
        source('xiaohongshu', 'browser_session', 'not_configured'),
      ]),
      settings,
    });

    expect(await configuration.get()).toEqual({
      recommendationCandidateCheckIntervalSeconds: 60,
      conversationRecognitionEnabled: false,
      recommendationGenerationTime: '08:00',
      recommendationTargetCount: 20,
      recommendationWorkingSetCount: 80,
      candidatePoolMinimumCount: 100,
      candidatePoolMaximumCount: 200,
      candidateValidityDays: 30,
      candidateContentExcerptMaxCharacters: 8_000,
      candidateSupplyCheckIntervalMinutes: 360,
      sources: [
        expect.objectContaining({ sourceId: 'bilibili', enabled: true, connectionState: 'ready' }),
        expect.objectContaining({ sourceId: 'open_web', enabled: true, connectionState: 'ready' }),
        expect.objectContaining({
          sourceId: 'xiaohongshu',
          enabled: false,
          connectionState: 'not_configured',
        }),
      ],
    });

    await configuration.update({ enabledSources: ['xiaohongshu', 'open_web', 'future_source'] });
    await configuration.update({ recommendationCandidateCheckIntervalSeconds: 90 });
    const saved = settings.readSettings();
    expect(saved).toMatchObject({
      status: 'ok',
      settings: {
        config: {
          discovery: {
            candidateSupplyConfirmed: true,
            enabledSources: ['xiaohongshu', 'open_web', 'future_source'],
          },
        },
      },
    });
    await configuration.update({ enabledSources: [] });
    expect((await configuration.get()).sources.every((item) => !item.enabled)).toBe(true);
    expect((await configuration.get()).recommendationCandidateCheckIntervalSeconds).toBe(90);
  });

  it('opens login only through a browser-session source and returns its refreshed public state', async () => {
    let connected = false;
    const connect = vi.fn(async () => {
      connected = true;
    });
    const browserSource: DiscoverySource = {
      descriptor: {
        id: 'xiaohongshu',
        name: '小红书',
        access: 'browser_session',
        supportedModes: ['relevance'],
        supportsRead: true,
      },
      getAvailability: () => ({ state: connected ? 'unknown' : 'login_required' }),
      connect,
      async search() {
        return { status: 'success', items: [] };
      },
    };
    const configuration = createDiscoveryConfiguration({
      sourceRegistry: createSourceRegistry([source('bilibili', 'public_http'), browserSource]),
      settings: fileSettings({ enabledSources: ['xiaohongshu'] }),
    });

    await expect(configuration.connectSource({ sourceId: 'xiaohongshu' })).resolves.toMatchObject({
      sourceId: 'xiaohongshu',
      access: 'browser_session',
      connectionState: 'unknown',
    });
    expect(connect).toHaveBeenCalledOnce();
    await expect(configuration.connectSource({ sourceId: 'bilibili' })).rejects.toThrow(/login/i);
  });

  it('checks only enabled sources during background startup while manual refresh checks all sources', async () => {
    const enabledCheck = vi.fn(async () => ({ state: 'ready' as const }));
    const disabledCheck = vi.fn(async () => ({ state: 'ready' as const }));
    const sourceRegistry = createSourceRegistry([
      { ...source('enabled', 'public_http'), checkAvailability: enabledCheck },
      { ...source('disabled', 'browser_session'), checkAvailability: disabledCheck },
    ]);
    const discovery = createDiscovery({
      configuration: {
        sourceRegistry,
        settings: fileSettings({ enabledSources: ['enabled'] }),
      },
    });

    await discovery.startBackground();
    expect(enabledCheck).toHaveBeenCalledOnce();
    expect(disabledCheck).not.toHaveBeenCalled();

    await discovery.refreshDiscoverySources();
    expect(enabledCheck).toHaveBeenCalledTimes(2);
    expect(disabledCheck).toHaveBeenCalledOnce();
  });

  it.each([
    { recommendationGenerationTime: '8:00' },
    { recommendationTargetCount: 0 },
    { recommendationCandidateCheckIntervalSeconds: 0 },
    { recommendationTargetCount: 101 },
    { recommendationTargetCount: 81, recommendationWorkingSetCount: 80 },
  ])('rejects invalid updates without writing: %j', async (patch) => {
    const settings = fileSettings();
    const configuration = createDiscoveryConfiguration({
      sourceRegistry: createSourceRegistry([source('open_web', 'configured_provider')]),
      settings,
    });
    await expect(configuration.update(patch)).rejects.toThrow();
    expect(settings.readSettings()).toMatchObject({
      status: 'ok',
      settings: { config: { discovery: { recommendationTargetCount: 20 } } },
    });
  });
});

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    fs.rmSync(directory, { recursive: true, force: true });
});
function fileSettings(discovery = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'discovery-config-'));
  directories.push(root);
  const globalSettingsPath = path.join(root, 'settings.json');
  fs.writeFileSync(globalSettingsPath, JSON.stringify({ discovery }));
  return createSettings({
    globalSettingsPath,
    credentialsPath: path.join(root, 'credentials.json'),
  });
}
