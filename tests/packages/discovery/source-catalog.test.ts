/* Verifies that Megumi defines one six-source discovery catalog. */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createDiscoverySourceRegistry, type BrowserSourceTaskGateway } from '@megumi/discovery';

describe('production Discovery source catalog', () => {
  it('always exposes one fixed six-source catalog while Host capabilities remain injectable', () => {
    const registry = createDiscoverySourceRegistry({ browserGateway: unavailableGateway });
    expect(registry.listDescriptors().map((source) => source.id)).toEqual([
      'bilibili', 'open_web', 'xiaohongshu', 'douyin', 'zhihu', 'twitter',
    ]);
  });
});

const unavailableGateway: BrowserSourceTaskGateway = {
  getConnectionState: () => ({ state: 'not_configured' }),
  execute: async () => ({ status: 'failed', failure: { code: 'extension_offline', message: 'Unavailable.' } }),
};
