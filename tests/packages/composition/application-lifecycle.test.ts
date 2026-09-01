/* Protects idempotent startup and disposal on a real composed Application. */
// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createApplicationRuntime } from '../../../packages/agent/composition/src/application-runtime';
import { composeTestApplication } from './compose-test-application';

describe('Application lifecycle', () => {
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
