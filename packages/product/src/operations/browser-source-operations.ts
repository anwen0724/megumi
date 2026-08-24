/* Thinly maps Browser Source Host calls to the Desktop-owned connection adapter. */
import type { BrowserSourceConnectionAdapter, BrowserSourceHost } from '../host/browser-source-host';

export function createBrowserSourceOperations(adapter: BrowserSourceConnectionAdapter): BrowserSourceHost {
  return {
    getConnection: async () => adapter.getConnection(),
    beginPairing: async () => adapter.beginPairing(),
    revokeConnection: async () => adapter.revokeConnection(),
  };
}
