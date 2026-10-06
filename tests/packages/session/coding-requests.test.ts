/* Verifies Coding admission and cancellation with real history, input processing and Agent execution. */
// @vitest-environment node
import { expect, it } from 'vitest';
import { readFile, stat } from 'node:fs/promises';
import { createProvider, fauxAssistantMessage, fauxToolCall, type ProviderStreams } from '@megumi/ai';
import { AssistantMessageEventStream } from '@megumi/ai/utils/event-stream';
import { createSandbox, createWebFetch } from '@megumi/agent';
import { createCoding } from '@megumi/application/coding/submit-message';
import { createInputProcessor } from '@megumi/application/coding/input/parse-message';
import type { InputSourceAccess } from '@megumi/application/coding/input/read-attachments';
import { createSessionBranchDrafts } from '@megumi/application/coding/sessions/session-branches';
import { createSessionAttachmentReader } from '@megumi/application/coding/sessions/session-attachments';
import { createWorkspaceChanges } from '@megumi/application/workspace/workspace-changes';
import { createWorkspaceStore } from '@megumi/application/workspace/workspace-store';
import { createEventBus } from '@megumi/application/coding/events/event-bus';
import { fixture, deferred } from '../agent/agent-fixture';
import { createSessionFixture } from './session-test-fixture';

async function codingFixture(sourceAccess?: InputSourceAccess, finalization?: { started: ReturnType<typeof deferred>; release: ReturnType<typeof deferred> }, beforeAttachmentWrite?: () => Promise<void>) {
  const session = await createSessionFixture({ beforeAttachmentWrite });
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
    async finalize(run) {
      if (finalization) { finalization.started.resolve(); await finalization.release.promise; }
      changes.finalizeChangeSet({ workspace_id: run.workspaceId, session_id: run.sessionId,
      execution_id: run.runId, finalized_at: new Date().toISOString() }); },
  });
  return { ...session, coding, provider, ai, config, changes, events };
}

it('does not announce thinking for a reply containing only text', async () => {
  const app = await codingFixture();
  try {
    const started = await app.coding.submitInput({
      workspaceId: app.workspaceId, sessionId: app.sessionId, text: 'Hello',
    });
    if (started.status !== 'started') throw new Error('Coding request was not started.');
    expect(await started.run.completion).toMatchObject({ status: 'completed' });
    const events = app.events.read({ sessionId: app.sessionId }).events;
    expect(events.some(event => event.type === 'message.update')).toBe(true);
    expect(events.filter(event => event.type === 'message.thinking.update')).toEqual([]);
  } finally { await app.coding.shutdown(); app.cleanup(); }
});

it('requests the existing high thinking level when the selected model supports reasoning', async () => {
  const app = await codingFixture();
  app.config.model.reasoning = true;
  let requestedReasoning: string | undefined;
  app.provider.setResponses([(_context, options) => {
    requestedReasoning = options?.reasoning;
    return fauxAssistantMessage([
      { type: 'thinking', thinking: 'Checking the request.' },
      { type: 'text', text: 'Done.' },
    ]);
  }]);
  try {
    const started = await app.coding.submitInput({
      workspaceId: app.workspaceId, sessionId: app.sessionId, text: 'Investigate',
    });
    if (started.status !== 'started') throw new Error('Coding request was not started.');
    expect(await started.run.completion).toMatchObject({ status: 'completed' });
    expect(requestedReasoning).toBe('high');
    expect(app.events.read({ sessionId: app.sessionId }).events).toContainEqual(expect.objectContaining({
      type: 'message.thinking.update', payload: expect.objectContaining({ thinking: 'Checking the request.' }),
    }));
    const history = app.history.getCommittedRunMessages({ sessionId: app.sessionId, executionId: started.run.runId });
    if (history.status !== 'ok') throw new Error(history.failure.message);
    expect(history.messages.at(-1)?.message.content).toContainEqual({ type: 'thinking', thinking: 'Checking the request.' });
  } finally { await app.coding.shutdown(); app.cleanup(); }
});

it('preserves the interrupted model reply in session history after cancellation', async () => {
  const app = await codingFixture();
  const calling = deferred();
  try {
    const stream: ProviderStreams['stream'] = (_model, _context, options) => {
      const events = new AssistantMessageEventStream();
      const message = fauxAssistantMessage('The first finding is', { stopReason: 'aborted' });
      events.push({ type: 'text_delta', contentIndex: 0, delta: 'The first finding is', partial: message });
      options?.signal?.addEventListener('abort', () => {
        events.push({ type: 'error', reason: 'aborted', error: message });
        events.end(message);
      }, { once: true });
      calling.resolve();
      return events;
    };
    app.ai.setProvider(createProvider({ id: app.config.model.provider, models: [app.config.model],
      auth: { apiKey: { name: 'Test', resolve: async () => ({ auth: {} }) } },
      api: { stream, streamSimple: stream } }));
    const started = await app.coding.submitInput({ requestId: 'partial-reply', workspaceId: app.workspaceId,
      sessionId: app.sessionId, text: 'Investigate' });
    if (started.status !== 'started') throw new Error('Coding request was not started.');
    await calling.promise;
    app.coding.cancelInput('partial-reply');
    expect(await started.run.completion).toMatchObject({ status: 'cancelled' });
    const history = app.history.getCommittedRunMessages({ sessionId: app.sessionId, executionId: started.run.runId });
    if (history.status !== 'ok') throw new Error(history.failure.message);
    expect(history.messages.at(-1)?.message).toMatchObject({ message_kind: 'assistant_reply', status: 'cancelled',
      content: [{ type: 'text', text: 'The first finding is' }] });
  } finally { await app.coding.shutdown(); app.cleanup(); }
});

it('keeps the product request active and cancellable until required finalization finishes', async () => {
  const finalization = { started: deferred(), release: deferred() };
  const app = await codingFixture(undefined, finalization);
  try {
    const started = await app.coding.submitInput({ requestId: 'finalizing', workspaceId: app.workspaceId,
      sessionId: app.sessionId, text: 'Hello' });
    if (started.status !== 'started') throw new Error('Coding request was not started.');
    await finalization.started.promise;
    expect(app.coding.getSessionRun(app.sessionId)).toMatchObject({ requestId: 'finalizing', status: 'running' });
    expect(app.coding.cancelInput('finalizing')).toBe(true);
    expect(app.coding.getRun(started.run.runId)).toMatchObject({ status: 'cancelling' });
    finalization.release.resolve();
    expect(await started.run.completion).toMatchObject({ status: 'cancelled' });
    expect(app.coding.getSessionRun(app.sessionId)).toBeUndefined();
  } finally { finalization.release.resolve(); await app.coding.shutdown(); app.cleanup(); }
});

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


it('keeps the session occupied until an admitted attachment write settles after cancellation', async () => {
  const writing = deferred();
  const release = deferred();
  const app = await codingFixture({
    async readImage() { return new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]); },
    async resolveDocument() { throw new Error('No document'); },
  }, undefined, async () => { writing.resolve(); await release.promise; });
  const pending = app.coding.submitInput({ requestId: 'writing', workspaceId: app.workspaceId, sessionId: app.sessionId,
    text: 'Describe image', attachments: [{ draftAttachmentId: 'image', type: 'image', source: { type: 'local_file', path: 'image.png' } }] });
  try {
    await writing.promise;
    app.coding.cancelInput('writing');
    expect(await app.coding.submitInput({ requestId: 'another', workspaceId: app.workspaceId, sessionId: app.sessionId, text: '/compact' }))
      .toMatchObject({ status: 'rejected', error: { code: 'RUN_CONFLICT' } });
    release.resolve();
    const started = await pending;
    if (started.status !== 'started') throw new Error('Expected the admitted input to finish saving');
    expect(await started.run.completion).toMatchObject({ status: 'cancelled' });
    expect(app.provider.state.callCount).toBe(0);
    expect(app.coding.getSessionRun(app.sessionId)).toBeUndefined();
  } finally { release.resolve(); await pending; await app.coding.shutdown(); app.cleanup(); }
});

it('finalizes real workspace changes before completing the product request', async () => {
  const app = await codingFixture();
  try {
    app.provider.setResponses([
      fauxAssistantMessage(fauxToolCall('write_file', { path: 'note.txt', content: 'Saved note' }), { stopReason: 'toolUse' }),
      fauxAssistantMessage('Saved.'),
    ]);
    const started = await app.coding.submitInput({ workspaceId: app.workspaceId, sessionId: app.sessionId, text: 'Write note.txt', permissionMode: 'full_access' });
    if (started.status !== 'started') throw new Error('Expected Coding run');
    expect(await started.run.completion).toMatchObject({ status: 'completed' });
    expect(app.changes.listChangeSummaries({ by: 'run', execution_id: started.run.runId }).summaries)
      .toMatchObject([{ change_set: { status: 'finalized', changed_file_count: 1 } }]);
    expect(await readFile(`${app.workspaceRoot}/note.txt`, 'utf8')).toBe('Saved note');
  } finally { await app.coding.shutdown(); app.cleanup(); }
});
