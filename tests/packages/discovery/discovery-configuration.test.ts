/* Verifies that Discovery owns source-aware configuration while Settings only persists it. */
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  createDiscoveryConfiguration,
  createSourceRegistry,
  type DiscoverySource,
} from '@megumi/discovery';

function source(
  id: string,
  access: 'public_http' | 'configured_provider' | 'browser_session',
  state: 'ready' | 'unknown' | 'not_configured' = 'ready',
): DiscoverySource {
  return {
    descriptor: { id, name: id, access, supportedModes: ['relevance'], supportsRead: false },
    getAvailability: () => ({ state }),
    async search() { return { status: 'success', items: [] }; },
  };
}

describe('Discovery configuration', () => {
  it('projects registered source facts and persists only validated configuration', async () => {
    let settings = {
      conversationRecognitionEnabled: false,
      dailyGenerationTime: '08:00',
      dailyTargetCount: 20,
      enabledSources: ['bilibili', 'open_web'],
    };
    const write = vi.fn(async (next: typeof settings) => { settings = next; });
    const configuration = createDiscoveryConfiguration({
      sourceRegistry: createSourceRegistry([
        source('bilibili', 'public_http'),
        source('open_web', 'configured_provider'),
        source('xiaohongshu', 'browser_session', 'not_configured'),
      ]),
      settings: { read: () => settings, write },
    });

    expect(await configuration.get()).toEqual({
      conversationRecognitionEnabled: false,
      dailyGenerationTime: '08:00',
      dailyTargetCount: 20,
      sources: [
        expect.objectContaining({ sourceId: 'bilibili', enabled: true, connectionState: 'ready' }),
        expect.objectContaining({ sourceId: 'open_web', enabled: true, connectionState: 'ready' }),
        expect.objectContaining({ sourceId: 'xiaohongshu', enabled: false, connectionState: 'not_configured' }),
      ],
    });

    await configuration.update({ enabledSources: [' xiaohongshu ', 'open_web', 'xiaohongshu'] });
    expect(write).toHaveBeenCalledWith({
      ...settings,
      enabledSources: ['xiaohongshu', 'open_web'],
    });
  });

  it.each([
    { enabledSources: [] },
    { enabledSources: ['missing'] },
    { dailyGenerationTime: '8:00' },
    { dailyTargetCount: 0 },
    { dailyTargetCount: 101 },
  ])('rejects invalid updates without writing: %j', async (patch) => {
    const write = vi.fn();
    const configuration = createDiscoveryConfiguration({
      sourceRegistry: createSourceRegistry([source('open_web', 'configured_provider')]),
      settings: {
        read: () => ({
          conversationRecognitionEnabled: false,
          dailyGenerationTime: '08:00',
          dailyTargetCount: 20,
          enabledSources: ['open_web'],
        }),
        write,
      },
    });
    await expect(configuration.update(patch)).rejects.toThrow();
    expect(write).not.toHaveBeenCalled();
  });
});
