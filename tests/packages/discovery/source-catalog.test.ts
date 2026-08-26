/* Verifies that Megumi defines one six-source discovery catalog. */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createDiscoverySourceRegistry, type EmbeddedBrowser } from '@megumi/discovery';

describe('production Discovery source catalog', () => {
  it('always exposes one fixed six-source catalog while Host capabilities remain injectable', () => {
    const registry = createDiscoverySourceRegistry({ embeddedBrowser: unavailableBrowser });
    expect(registry.listDescriptors().map((source) => source.id)).toEqual([
      'bilibili', 'open_web', 'xiaohongshu', 'douyin', 'zhihu', 'twitter',
    ]);
    expect(registry.get('open_web')?.getAvailability()).toMatchObject({ state: 'ready', provider: 'Bing' });
  });
});

const unavailableBrowser: EmbeddedBrowser = {
  openLogin: async () => undefined,
  snapshot: async () => ({ status: 'failed', failure: { code: 'network_error', message: 'Unavailable.' } }),
  shutdown: async () => undefined,
};
