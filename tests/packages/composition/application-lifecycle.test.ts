/* Protects idempotent startup and disposal on a real composed Application. */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
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
});
