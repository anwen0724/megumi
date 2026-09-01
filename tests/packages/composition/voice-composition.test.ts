/* Verifies a Host-neutral Application exposes honest unavailable Voice state. */
// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { composeTestApplication, type TestApplication } from './compose-test-application';

let application: TestApplication | undefined;
afterEach(async () => { await application?.cleanup(); application = undefined; });

describe('Voice composition', () => {
  it('does not fabricate speech capability when no Host Adapter is injected', async () => {
    application = composeTestApplication();
    expect(await application.runtime.host.voice.getSnapshot()).toEqual({ status: 'idle' });
    expect(await application.runtime.host.voice.getModelStatus()).toMatchObject({ status: 'not_prepared' });
  });
});
