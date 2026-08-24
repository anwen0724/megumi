/* Verifies loopback pairing, authentication, claiming, and credential persistence. */
// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { createBrowserSourceLoopbackServer } from '../../../../../apps/desktop/src/main/adapters/browser-source/browser-source-loopback-server';

describe('BrowserSourceLoopbackServer', () => {
  const servers: Array<{ stop(): Promise<void> }> = [];
  afterEach(async () => { await Promise.all(servers.splice(0).map((server) => server.stop())); });

  it('uses a single five-minute pairing code and persists only the token hash', async () => {
    let persisted: { port: number; tokenHash?: string } | undefined;
    let now = Date.parse('2026-08-24T00:00:00.000Z');
    const server = createBrowserSourceLoopbackServer({
      store: { read: () => persisted, write: (value) => { persisted = value; } },
      now: () => now,
      createSecret: sequenceSecrets(),
    });
    servers.push(server);
    const started = await server.start();
    expect(started.status).toBe('listening');
    const pairing = server.beginPairing();
    const response = await fetch(`http://127.0.0.1:${started.port}/pair`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: pairing.code }),
    });
    const body = await response.json() as { token: string };
    expect(response.status).toBe(200);
    expect(body.token).toBeTruthy();
    expect(persisted?.tokenHash).toMatch(/^[a-f\d]{64}$/u);
    expect(persisted?.tokenHash).not.toBe(body.token);
    expect((await fetch(`http://127.0.0.1:${started.port}/pair`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: pairing.code }),
    })).status).toBe(401);

    const another = server.beginPairing();
    now += 5 * 60_000 + 1;
    expect((await fetch(`http://127.0.0.1:${started.port}/pair`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: another.code }),
    })).status).toBe(401);
  });

  it('requires the device token for heartbeat and task transport', async () => {
    const server = createBrowserSourceLoopbackServer({
      store: memoryStore(), createSecret: sequenceSecrets(),
    });
    servers.push(server);
    const started = await server.start();
    const pairing = server.beginPairing();
    const paired = await fetch(`http://127.0.0.1:${started.port}/pair`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: pairing.code }),
    });
    const { token } = await paired.json() as { token: string };
    expect((await fetch(`http://127.0.0.1:${started.port}/heartbeat`, { method: 'POST' })).status).toBe(401);
    expect((await fetch(`http://127.0.0.1:${started.port}/heartbeat`, {
      method: 'POST', headers: { authorization: `Bearer ${token}` },
    })).status).toBe(204);
    expect(server.getConnection().state).toBe('ready');
  });
});

function memoryStore() {
  let value: { port: number; tokenHash?: string } | undefined;
  return { read: () => value, write: (next: typeof value) => { value = next; } };
}

function sequenceSecrets(): () => string {
  let next = 0;
  return () => `secret-${++next}`;
}
