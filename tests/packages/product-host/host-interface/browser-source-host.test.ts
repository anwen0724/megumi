/* Verifies the thin Browser Source Host mapping and strict renderer views. */
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { BrowserSourceConnectionViewSchema, BrowserSourcePairingViewSchema } from '@megumi/product-host/host';
import { createBrowserSourceOperations } from '../../../../packages/agent/product-host/src/operations/browser-source-operations';

describe('Browser Source Host', () => {
  it('rejects unknown connection and pairing fields', () => {
    expect(BrowserSourceConnectionViewSchema.safeParse({ state: 'ready', port: 1234, token: 'secret' }).success).toBe(false);
    expect(BrowserSourcePairingViewSchema.safeParse({
      code: '123456', port: 1234, expiresAt: '2026-08-24T00:05:00.000Z', token: 'secret',
    }).success).toBe(false);
  });

  it('only delegates to the injected Host adapter', async () => {
    const adapter = {
      getConnection: vi.fn(() => ({ state: 'extension_offline' as const, port: 1234 })),
      beginPairing: vi.fn(() => ({ code: '123456', port: 1234, expiresAt: '2026-08-24T00:05:00.000Z' })),
      revokeConnection: vi.fn(() => ({ state: 'extension_offline' as const, port: 1234 })),
    };
    const host = createBrowserSourceOperations(adapter);
    await expect(host.getConnection()).resolves.toMatchObject({ state: 'extension_offline' });
    await expect(host.beginPairing()).resolves.toMatchObject({ code: '123456' });
    await expect(host.revokeConnection()).resolves.toMatchObject({ state: 'extension_offline' });
  });
});
