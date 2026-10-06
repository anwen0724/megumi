/* Protects idempotent startup and disposal on a real composed Application. */
// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { composeTestApplication } from './compose-test-application';

describe('Application lifecycle', () => {
  it('stops business work while keeping database and Trace queries open for final capture', async () => {
    const application = composeTestApplication();
    try {
      await application.runtime.start({ backgroundTriggers: 'manual' });
      const first = application.runtime.stop();
      expect(application.runtime.stop()).toBe(first);
      await first;
      expect(await application.runtime.discovery.listInterests()).toEqual({ interests: [] });
      expect((await application.runtime.observability.listTraces({ limit: 1 })).status).not.toBe(
        'failed',
      );
    } finally {
      await application.cleanup();
    }
  });
  it('does not start business after disposal', async () => {
    const application = composeTestApplication();
    try {
      await application.runtime.dispose();
      await expect(application.runtime.start()).rejects.toThrow('disposal');
    } finally {
      await application.cleanup();
    }
  });
  it('blocks background startup on invalid settings while retaining the settings host', async () => {
    const application = composeTestApplication();
    const settingsPath = path.join(application.home, 'settings.json');
    const validSettings = fs.readFileSync(settingsPath, 'utf8');
    fs.writeFileSync(settingsPath, '{ invalid');
    try {
      await expect(application.runtime.start()).rejects.toThrow();
      expect(application.runtime.settings.readSettings().status).toBe('rejected');
      fs.writeFileSync(settingsPath, validSettings);
      expect(await application.runtime.discovery.getConfiguration())
        .toMatchObject({ candidateSupplyConfirmed: false });
    } finally {
      await application.cleanup();
    }
  });
  it('starts and disposes exactly once', async () => {
    const application = composeTestApplication();
    const firstStart = application.runtime.start();
    expect(application.runtime.start()).toBe(firstStart);
    await firstStart;
    const firstDispose = application.runtime.dispose();
    expect(application.runtime.dispose()).toBe(firstDispose);
    await firstDispose;
    await application.cleanup();
  });
});
