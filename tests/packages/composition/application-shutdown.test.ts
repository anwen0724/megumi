/* Ensures a shutdown timeout cannot close storage underneath an unfinished input operation. */
// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { composeTestApplication } from './compose-test-application';
import { deferred } from '../agent/agent-fixture';

it('keeps storage open after a timeout until input preparation has actually stopped', async () => {
  const entered = deferred();
  const release = deferred();
  const app = composeTestApplication([], { inputSourceAccess: {
    async readImage() { entered.resolve(); await release.promise; throw new Error('Image read stopped.'); },
    async resolveDocument() { throw new Error('No document was selected.'); },
  } });
  let submission: ReturnType<typeof app.runtime.session.sendUserInput> | undefined;
  try {
    const opened = await app.runtime.workspace.useExistingProject();
    if (opened.status !== 'opened' || !opened.project) throw new Error('Workspace unavailable.');
    submission = app.runtime.session.sendUserInput({ projectId: opened.project.projectId,
      text: 'Read the image.', modelSelection: { provider_id: 'test', model_id: 'model' },
      attachments: [{ draftAttachmentId: 'image:1', type: 'image', name: 'image.png',
        source: { type: 'host_file_reference', referenceId: 'image:1' } }],
    });
    await entered.promise;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const disposed = app.runtime.dispose();
    const rejected = expect(disposed).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(12_001);
    await rejected;
    await expect(app.runtime.session.listSessions()).resolves.toBeDefined();
    release.resolve();
    await submission;
    await app.runtime.dispose();
  } finally {
    vi.useRealTimers();
    release.resolve();
    await submission?.catch(() => undefined);
    await app.cleanup();
  }
});
