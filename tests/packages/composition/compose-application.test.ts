/* Verifies the shared Composition starts a real Product flow without Electron. */
// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { composeTestApplication, type TestApplication } from './compose-test-application';

let application: TestApplication | undefined;
afterEach(async () => { await application?.cleanup(); application = undefined; });

describe('composeApplication', () => {
  it('exposes Product Host and commits a scripted Conversation reply', async () => {
    application = composeTestApplication(['A committed reply.']);
    await application.runtime.start();
    const opened = await application.runtime.host.workspace.useExistingProject();
    expect(opened.status).toBe('opened');
    if (opened.status !== 'opened' || !opened.project) return;
    const submitted = await application.runtime.host.session.sendUserInput({
      projectId: opened.project.projectId,
      text: 'Hello',
      modelSelection: { provider_id: 'test', model_id: 'model' },
      permissionMode: 'full_access',
    });
    expect(submitted.payload.type).toBe('agent_run');
    if (submitted.payload.type !== 'agent_run') return;
    await vi.waitFor(async () => {
      const result = await application?.runtime.host.session.readCommittedRun({
        sessionId: submitted.payload.session.id,
        executionId: submitted.payload.run.executionId,
      });
      expect(result.status).toBe('ok');
      if (result.status !== 'ok') return;
      expect(result.messages.some((entry) => (
        entry.type === 'message' && entry.message.kind === 'assistantReply'
      ))).toBe(true);
    });
    expect(application.contexts.length).toBeGreaterThanOrEqual(1);
  });
});
