/* Verifies that Discovery Agent alone defines the five built-in sources. */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createDiscoverySourceRegistry, type BrowserSourceTaskGateway } from '@megumi/discovery-agent';

describe('production Discovery source catalog', () => {
  it('always exposes one fixed five-source catalog while Host capabilities remain injectable', () => {
    const registry = createDiscoverySourceRegistry({ browserGateway: unavailableGateway });
    expect(registry.listDescriptors().map((source) => source.id)).toEqual([
      'bilibili', 'open_web', 'xiaohongshu', 'douyin', 'zhihu',
    ]);
  });
});

const unavailableGateway: BrowserSourceTaskGateway = {
  getConnectionState: () => ({ state: 'not_configured' }),
  execute: async () => ({ status: 'failed', failure: { code: 'extension_offline', message: 'Unavailable.' } }),
};
