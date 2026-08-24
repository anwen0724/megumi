// @vitest-environment node
/*
 * Guards the Electron Main build contract for the browser-source transport.
 * ws must load from packaged node_modules so its optional native accelerators
 * remain optional instead of becoming Vite-generated runtime throw stubs.
 */
import { describe, expect, it } from 'vitest';

describe('Browser source Main build', () => {
  it('keeps ws external to the Electron Main bundle', async () => {
    const mainConfig = await import('../../../../../../vite.main.config');
    const external = mainConfig.default.build?.rollupOptions?.external;

    expect(external).toContain('ws');
  });
});
