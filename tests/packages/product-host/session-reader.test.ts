// @vitest-environment node
/* The session API projects committed product facts without exposing model-only content. */
import { expect, it } from 'vitest';
import path from 'node:path';
import { composeTestApplication } from '../composition/compose-test-application';
import { createDatabase } from '@megumi/application/storage/index';
import { createSessionStore } from '@megumi/application/coding/sessions/session-storage';
import { createSessionHistory } from '@megumi/application/coding/sessions/session-history';

it('reads conversation and execution history without leaking model-only input', async () => {
  const app = composeTestApplication();
  try {
    const opened = await app.runtime.workspace.useExistingProject();
    if (opened.status !== 'opened' || !opened.project) throw new Error('Workspace unavailable');
    const created = await app.runtime.session.createSession({ projectId: opened.project.projectId });
    if (created.status !== 'created') throw new Error('Session unavailable');
    const sessionId = created.session.id;
    const database = createDatabase({ filename: path.join(app.home, 'sqlite/megumi.sqlite') });
    try {
      const history = createSessionHistory({ store: createSessionStore({ database }) });
      const saved = await history.saveUserMessage({ session_id: sessionId, execution_id: 'run', message_id: 'user',
        display_content: [{ type: 'text', text: 'Hello' }], model_content: [{ type: 'text', text: 'Private model guidance' }], created_at: new Date().toISOString() });
      if (saved.status !== 'saved') throw new Error(saved.failure.message);
    } finally { database.close(); }
    const session = await app.runtime.session.readSession({ sessionId });
    expect(session).toMatchObject({ status: 'ok', conversation: [{ type: 'message', message: { kind: 'user', displayContent: [{ text: 'Hello' }] } }] });
    expect(JSON.stringify(session)).not.toContain('Private model guidance');
    const run = await app.runtime.session.readCommittedRun({ sessionId, executionId: 'run' });
    expect(run).toMatchObject({ status: 'ok', messages: [{ type: 'message', message: { kind: 'user', displayContent: [{ text: 'Hello' }] } }] });
    expect(JSON.stringify(run)).not.toContain('Private model guidance');
  } finally { await app.cleanup(); }
});
