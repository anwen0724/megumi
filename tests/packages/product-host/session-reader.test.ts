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


it.each([true, false])('projects only host-verified memory citations (valid: %s)', async valid => {
  const app = composeTestApplication();
  try {
    const opened = await app.runtime.workspace.useExistingProject();
    if (opened.status !== 'opened' || !opened.project) throw new Error('Workspace unavailable');
    const created = await app.runtime.session.createSession({ projectId: opened.project.projectId });
    if (created.status !== 'created') throw new Error('Session unavailable');
    const sessionId = created.session.id;
    const citation = { path: 'MEMORY.md', fileVersion: 'v1', startLine: 3, endLine: 5, sourceIds: ['source'], sourceVersions: ['sv1'] };
    const database = createDatabase({ filename: path.join(app.home, 'sqlite/megumi.sqlite') });
    try {
      const history = createSessionHistory({ store: createSessionStore({ database }) });
      await history.saveUserMessage({ session_id: sessionId, execution_id: 'run', message_id: 'question', display_content: [{ type: 'text', text: 'Question' }], model_content: [{ type: 'text', text: 'Question' }], created_at: new Date().toISOString() });
      const reply = history.saveAssistantReply({ session_id: sessionId, execution_id: 'run', message_id: 'reply', status: 'completed',
        content: [{ type: 'text', text: `Answer\n<memory_citations>${JSON.stringify([{ ...citation, fileVersion: valid ? 'v1' : 'forged' }])}</memory_citations>` }],
        memory_evidence: { executionId: 'run', controlRevision: 0, reads: [citation] }, completed_at: new Date().toISOString() });
      if (reply.status !== 'saved') throw new Error(reply.failure.message);
    } finally { database.close(); }
    const result = await app.runtime.session.readCommittedRun({ sessionId, executionId: 'run' });
    if (result.status !== 'ok') throw new Error('Reply unavailable');
    const message = result.messages.find(item => item.type === 'message' && item.message.kind === 'assistantReply');
    expect(message).toMatchObject({ message: { content: [{ type: 'text', text: 'Answer' }] } });
    expect(message && 'message' in message && message.message).toMatchObject({ memoryCitations: valid ? [citation] : [] });
  } finally { await app.cleanup(); }
});
