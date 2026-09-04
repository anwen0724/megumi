/* Protects idempotent startup and disposal on a real composed Application. */
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createApplicationRuntime } from '../../../packages/agent/composition/src/application-runtime';
import { composeTestApplication } from './compose-test-application';

describe('Application lifecycle', () => {
  it('does not start business after disposal while settings validation is pending', async () => {
    const application = composeTestApplication();
    const loaded = await application.runtime.host.settings.get();
    let release: (() => void) | undefined;
    vi.spyOn(application.runtime.host.settings, 'get').mockImplementation(() => new Promise((resolve) => {
      release = () => resolve(loaded);
    }));
    const start = vi.fn(async () => undefined);
    const runtime = createApplicationRuntime({
      host: application.runtime.host, logger: application.runtime.logger, start,
      subscribeRuntimeEvents: application.runtime.subscribeRuntimeEvents,
      subscribeSpeechOutputEvents: application.runtime.subscribeSpeechOutputEvents,
      dispose: async () => undefined,
    });
    try {
      const pending = runtime.start();
      await runtime.dispose();
      release?.();
      await expect(pending).rejects.toThrow('disposal');
      expect(start).not.toHaveBeenCalled();
    } finally { await application.cleanup(); }
  });
  it('blocks background startup on invalid settings while retaining the settings host', async () => {
    const application = composeTestApplication();
    const start = vi.fn(async () => undefined);
    vi.spyOn(application.runtime.host.settings, 'get').mockResolvedValue({ status: 'failed', failure: {
      code: 'config_invalid', message: 'Settings could not be resolved.',
    } });
    const runtime = createApplicationRuntime({
      host: application.runtime.host, logger: application.runtime.logger, start,
      subscribeRuntimeEvents: application.runtime.subscribeRuntimeEvents,
      subscribeSpeechOutputEvents: application.runtime.subscribeSpeechOutputEvents,
      dispose: async () => undefined,
    });
    try {
      await expect(runtime.start()).rejects.toThrow('Settings');
      expect(start).not.toHaveBeenCalled();
      expect((await runtime.host.settings.get()).status).toBe('failed');
    } finally { await application.cleanup(); }
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

  it('uses the first background trigger mode for the complete runtime lifetime', async () => {
    const application = composeTestApplication();
    const start = vi.fn(async () => undefined);
    const runtime = createApplicationRuntime({
      host: application.runtime.host,
      logger: application.runtime.logger,
      start,
      subscribeRuntimeEvents: application.runtime.subscribeRuntimeEvents,
      subscribeSpeechOutputEvents: application.runtime.subscribeSpeechOutputEvents,
      dispose: async () => undefined,
    });

    const first = runtime.start({ backgroundTriggers: 'manual' });
    expect(runtime.start({ backgroundTriggers: 'automatic' })).toBe(first);
    await first;

    expect(start).toHaveBeenCalledOnce();
    expect(start).toHaveBeenCalledWith({ backgroundTriggers: 'manual' });
    await application.cleanup();
  });
});
