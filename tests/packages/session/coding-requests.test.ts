/* Verifies Coding admission and cancellation with real history, input processing and Agent execution. */
// @vitest-environment node
import { expect, it } from 'vitest';
import { readFile, stat } from 'node:fs/promises';
import { fauxAssistantMessage } from '@megumi/ai';
import { createSandbox, createWebFetch } from '@megumi/agent';
import { createCoding } from '@megumi/application/coding/submit-message';
import { createInputProcessor } from '@megumi/application/coding/input/parse-message';
import type { InputSourceAccess } from '@megumi/application/coding/input/read-attachments';
import { createSessionBranchDrafts } from '@megumi/application/coding/sessions/session-branches';
import { createSessionAttachmentReader } from '@megumi/application/coding/sessions/session-attachments';
import { createWorkspaceChanges } from '@megumi/application/workspace/workspace-changes';
import { createWorkspaceStore } from '@megumi/application/workspace/workspace-store';
import { createEventBus } from '@megumi/agent-runtime/events';
import { fixture, deferred } from '../agent/agent-fixture';
import { createSessionFixture } from './session-test-fixture';

async function codingFixture(sourceAccess?: InputSourceAccess) {
  const session = await createSessionFixture();
  const { ai, agent, provider, config } = fixture();
  const events = createEventBus();
  const changes = createWorkspaceChanges({ store: createWorkspaceStore({ database: session.database }) });
  const coding = createCoding({
    ai, agent, sessions: session.catalog, history: session.history,
    branches: createSessionBranchDrafts({ store: session.store, events }),
    input: createInputProcessor({ sourceAccess: sourceAccess ?? {
      async readImage(source) {
        if (source.type !== 'local_file') throw new Error('Host image unavailable.');
        return readFile(source.path);
      },
      async resolveDocument(source) { return { path: source.referenceId, sizeBytes: (await stat(source.referenceId)).size }; },
    } }),
    preparation: { workspaces: session.workspaceCatalog, workspaceChanges: changes,
      sandbox: createSandbox(), policy: config.policy, operatingSystem: 'Windows', webFetch: createWebFetch() },
    context: { attachments: createSessionAttachmentReader({ store: session.store, contentStore: session.contentStore }),
      megumiHomePath: session.root, instructionDocuments: [] },
    events, terminalRetentionMs: 300_000,
    async resolveModel() { return { status: 'ok', model: config.model, compactionThresholdRatio: 0.8 }; },
    async finalize(run) { changes.finalizeChangeSet({ workspace_id: run.workspaceId, session_id: run.sessionId,
      execution_id: run.runId, finalized_at: new Date().toISOString() }); },
  });
  return { ...session, coding, provider };
}

it('keeps a failed reply in committed history so reopening the session preserves the failure', async () => {
  const app = await codingFixture();
  try {
    app.provider.setResponses([fauxAssistantMessage('', { stopReason: 'error', errorMessage: 'Invalid API key' })]);
    const started = await app.coding.submitInput({ workspaceId: app.workspaceId, sessionId: app.sessionId, text: 'Hello' });
    if (started.status !== 'started') throw new Error('Coding request was not started.');
    expect(await started.run.completion).toMatchObject({ status: 'failed', error: { code: 'MODEL_CALL_FAILED' } });
    const committed = app.history.getCommittedRunMessages({ sessionId: app.sessionId, executionId: started.run.runId });
    if (committed.status !== 'ok') throw new Error(committed.failure.message);
    expect(committed.messages.map(item => item.message.message_kind)).toEqual(['user_message', 'assistant_reply']);
    expect(committed.messages[1].message).toMatchObject({ status: 'failed', reason_code: 'model_call_failed', content: [] });
  } finally { await app.coding.shutdown(); app.cleanup(); }
});

it('joins repeated submissions to one run and one committed user message', async () => {
  const app = await codingFixture();
  const gate = deferred();
  try {
    app.provider.setResponses([async () => { await gate.promise; return fauxAssistantMessage('Done.'); }]);
    const request = { requestId: 'request:duplicate', workspaceId: app.workspaceId, sessionId: app.sessionId, text: 'Do it' };
    const [first, second] = await Promise.all([app.coding.submitInput(request), app.coding.submitInput(request)]);
    expect(first.status).toBe('started');
    if (first.status !== 'started' || second.status !== 'started') throw new Error('Coding request was not started.');
    expect(second.run.runId).toBe(first.run.runId);
    gate.resolve();
    expect(await first.run.completion).toMatchObject({ status: 'completed' });
    const history = app.history.listMessages({ session_id: app.sessionId });
    if (history.status !== 'ok') throw new Error(history.failure.message);
    expect(history.messages.filter(item => item.message.message_kind === 'user_message')).toHaveLength(1);
  } finally { gate.resolve(); await app.coding.shutdown(); app.cleanup(); }
});

it('cancels attachment preparation by request identity and releases the session without creating a run', async () => {
  const reading = deferred();
  const app = await codingFixture({
    readImage(_source, options) {
      reading.resolve();
      return new Promise((_resolve, reject) => options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true }));
    },
    async resolveDocument() { throw new Error('No document in this request.'); },
  });
  try {
    const pending = app.coding.submitInput({ requestId: 'request:image', workspaceId: app.workspaceId, sessionId: app.sessionId,
      text: 'Read this image', attachments: [{ draftAttachmentId: 'image:1', type: 'image', source: { type: 'local_file', path: 'image.png' } }] });
    await reading.promise;
    expect(app.coding.getSessionRun(app.sessionId)).toBeUndefined();
    expect(app.coding.cancelInput('request:image')).toBe(true);
    expect(await pending).toMatchObject({ status: 'rejected', error: { code: 'INPUT_CANCELLED' } });
    expect(app.history.listMessages({ session_id: app.sessionId })).toMatchObject({ status: 'ok', messages: [] });
    const next = await app.coding.submitInput({ workspaceId: app.workspaceId, sessionId: app.sessionId, text: 'Continue without the image' });
    expect(next.status).toBe('started');
    if (next.status === 'started') await next.run.completion;
  } finally { await app.coding.shutdown(); app.cleanup(); }
});
