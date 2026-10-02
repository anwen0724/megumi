/* Verifies admission and cancellation through the shared runtime with real persistence. */
// @vitest-environment node
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, it, onTestFinished, vi } from 'vitest';
import { createRuntimeFixture } from './runtime-fixture';

it('bounds shutdown while image input is still being read and prevents a late run', async () => {
  const reading = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const fixture = await createRuntimeFixture({ beforeImageRead: async () => { reading.resolve(); await release.promise; } });
  const submission = fixture.runtime.submitInput({
    requestId: 'pending-image', workspaceId: fixture.workspaceId, sessionId: fixture.sessionId,
    text: 'Describe image', modelSelection: { providerId: fixture.model.provider, modelId: fixture.model.id },
    attachments: [{ type: 'image', draftAttachmentId: 'image', source: { type: 'local_file', path: path.join(fixture.root, 'missing.png') } }],
  });
  onTestFinished(async () => { release.resolve(); await submission; await fixture.cleanup(); });
  await reading.promise;
  expect(await fixture.runtime.stop({ timeoutMs: 0 })).toMatchObject({ status: 'timed_out' });
  release.resolve();
  expect(await submission).toMatchObject({ status: 'rejected', error: { code: 'RUNTIME_STOPPED' } });
  expect(await fixture.runtime.stop({ timeoutMs: 1000 })).toEqual({ status: 'stopped' });
  expect(fixture.runtime.getSessionRun(fixture.sessionId)).toBeUndefined();
});

it('ends a recommendation run after accepting its draft without another model request or publication', async () => {
  const fixture = await createRuntimeFixture();
  onTestFinished(() => fixture.cleanup());
  const now = new Date().toISOString();
  fixture.recommendationAttempts.start({
    requestId: 'recommendation', executionId: 'recommendation-run', localDate: now.slice(0, 10), snapshotAt: now,
    actualTarget: 1, workingSetCount: 1, exclusions: [], interestRevisions: [], preferenceRevisions: [],
    interests: [], preferences: [], history: [], repository: fixture.repository, now: () => now,
    rankedCandidates: [{ rank: 1, relevanceRank: 0, interestMatches: [], sourceName: 'Source', candidate: {
      id: 'candidate', contentIdentity: 'candidate', sourceId: 'source', canonicalUrl: 'https://example.test/item',
      contentType: 'article', title: 'Candidate', contentSummary: 'A relevant article', contentTruncated: false,
      status: 'available', createdAt: now, expiresAt: '2099-01-01T00:00:00.000Z',
    } }],
  });
  let requests = 0;
  const snapshot = fixture.recommendationAttempts.getSnapshot('recommendation-run');
  if (!snapshot) throw new Error('Expected a recommendation snapshot.');
  Object.assign(snapshot.rankedCandidates[0].candidate, { id: 'modified-by-reader' });
  expect(fixture.recommendationAttempts.getSnapshot('recommendation-run')?.rankedCandidates[0].candidate.id).toBe('candidate');
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    requests++;
    const delta = requests === 1
      ? { role: 'assistant', tool_calls: [{ index: 0, id: 'draft', type: 'function', function: {
          name: 'submit_recommendations', arguments: JSON.stringify({ items: [{ candidateId: 'candidate', recommendationReason: 'Relevant.' }] }),
        } }] }
      : { role: 'assistant', content: 'Done.' };
    return new Response('data: ' + JSON.stringify({ id: 'response', object: 'chat.completion.chunk', created: 1,
      model: fixture.model.id, choices: [{ index: 0, delta, finish_reason: requests === 1 ? 'tool_calls' : 'stop' }],
    }) + '\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
  });
  onTestFinished(() => fetch.mockRestore());
  const result = await fixture.runtime.startRun({ kind: 'recommendation', runId: 'recommendation-run',
    requestId: 'recommendation', localDate: now.slice(0, 10) });
  if (result.status === 'rejected') throw new Error(result.error.message);
  expect(await result.run.completion).toMatchObject({ status: 'completed' });
  expect(requests).toBe(1);
  expect(fixture.repository.getCollection(now.slice(0, 10), true)).toBeUndefined();
  expect(await fixture.runtime.startRun({ kind: 'recommendation', runId: 'recommendation-run',
    requestId: 'another-request', localDate: now.slice(0, 10) })).toMatchObject({
    status: 'rejected', error: { code: 'RUN_CONFLICT' },
  });
});

it('keeps an admitting session occupied and waits for its cancelled run to finish storing attachments', async () => {
  const writing = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const fixture = await createRuntimeFixture({ beforeAttachmentWrite: async () => { writing.resolve(); await release.promise; } });
  const request = {
    kind: 'conversation' as const, requestId: 'first', workspaceId: fixture.workspaceId, sessionId: fixture.sessionId,
    permissionMode: 'ask' as const,
    input: {
      displayContent: [{ type: 'text' as const, text: 'Describe this image' }],
      modelContent: [{ type: 'text' as const, text: 'Describe this image' }],
      attachments: [{ type: 'image' as const, name: 'image.png', mediaType: 'image/png' as const,
        byteLength: 8, bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]) }],
    },
  };
  const admission = fixture.runtime.startRun(request);
  onTestFinished(async () => { release.resolve(); await admission; await fixture.cleanup(); });
  await writing.promise;
  expect(await fixture.runtime.submitInput({ workspaceId: fixture.workspaceId, sessionId: fixture.sessionId,
    text: '/compact', modelSelection: { providerId: fixture.model.provider, modelId: fixture.model.id } })).toMatchObject({
    status: 'rejected', error: { code: 'RUN_CONFLICT' },
  });
  expect(await fixture.runtime.startRun({ ...request, requestId: 'second' })).toMatchObject({
    status: 'rejected', error: { code: 'RUN_CONFLICT' },
  });
  const pending = fixture.runtime.getSessionRun(fixture.sessionId);
  expect(pending).toBeDefined();
  const stopped = await fixture.runtime.stop({ timeoutMs: 0 });
  expect(stopped).toMatchObject({ status: 'timed_out', runs: [{ runId: pending?.runId }] });
  release.resolve();
  const accepted = await admission;
  expect(accepted.status).toBe('started');
  if (accepted.status !== 'started') throw new Error('Expected the reserved run to finish admission.');
  expect(await accepted.run.completion).toEqual({ status: 'cancelled' });
  expect(fixture.runtime.getRun(accepted.run.runId)?.status).toBe('cancelled');
  expect(fixture.runtime.getSessionRun(fixture.sessionId)).toBeUndefined();
});

it('completes a tool run only after the reply and workspace changes are committed', async () => {
  const fixture = await createRuntimeFixture();
  onTestFinished(() => fixture.cleanup());
  let requests = 0;
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    requests++;
    const choice = requests === 1
      ? { index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'write-note', type: 'function', function: {
          name: 'write_file', arguments: JSON.stringify({ path: 'note.txt', content: 'A saved note.' }),
        } }] }, finish_reason: 'tool_calls' }
      : { index: 0, delta: { role: 'assistant', content: 'Saved the note.' }, finish_reason: 'stop' };
    return new Response('data: ' + JSON.stringify({
      id: 'response-' + requests, object: 'chat.completion.chunk', created: 1, model: fixture.model.id, choices: [choice],
    }) + '\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
  });
  onTestFinished(() => fetch.mockRestore());
  const result = await fixture.runtime.submitInput({
    requestId: 'write-note-request', workspaceId: fixture.workspaceId, sessionId: fixture.sessionId,
    text: 'Write a note', modelSelection: { providerId: fixture.model.provider, modelId: fixture.model.id }, permissionMode: 'full_access',
  });
  expect(result.status).toBe('started');
  if (result.status !== 'started') throw new Error('Expected a run handle.');
  expect(await result.run.completion).toMatchObject({ status: 'completed', assistantMessageId: expect.any(String) });
  expect(await readFile(path.join(fixture.workspaceRoot, 'note.txt'), 'utf8')).toBe('A saved note.');
  const changes = fixture.workspaceChanges.listChangeSummaries({ by: 'run', execution_id: result.run.runId });
  expect(changes.summaries).toMatchObject([{ change_set: { status: 'finalized', changed_file_count: 1 } }]);
  expect(fixture.runtime.getRun(result.run.runId)?.status).toBe('completed');
});

it('initializes a session from the default model and keeps it when the default changes', async () => {
  const fixture = await createRuntimeFixture();
  onTestFinished(() => fixture.cleanup());
  const requested: string[] = [];
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    requested.push(body.model);
    return new Response('data: ' + JSON.stringify({ id: 'response', object: 'chat.completion.chunk', created: 1,
      model: body.model, choices: [{ index: 0, delta: { role: 'assistant', content: 'Done.' }, finish_reason: 'stop' }],
    }) + '\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
  });
  onTestFinished(() => fetch.mockRestore());
  const first = await fixture.runtime.submitInput({ workspaceId: fixture.workspaceId, sessionId: fixture.sessionId, text: 'First' });
  if (first.status !== 'started') throw new Error('Expected first run');
  await first.run.completion;
  const config = JSON.parse(await readFile(fixture.globalSettingsPath, 'utf8'));
  config.models.defaultModel.modelId = 'other';
  config.models.customModels[fixture.model.provider].other = { contextWindowTokens: 16000, maxOutputTokens: 512 };
  await writeFile(fixture.globalSettingsPath, JSON.stringify(config));
  const second = await fixture.runtime.submitInput({ workspaceId: fixture.workspaceId, sessionId: fixture.sessionId, text: 'Second' });
  if (second.status !== 'started') throw new Error('Expected second run');
  await second.run.completion;
  const direct = await fixture.runtime.startRun({
    kind: 'conversation', requestId: 'prepared-input', workspaceId: fixture.workspaceId,
    sessionId: fixture.sessionId, permissionMode: 'ask',
    input: { displayContent: [{ type: 'text', text: 'Third' }], modelContent: [{ type: 'text', text: 'Third' }], attachments: [] },
  });
  if (direct.status === 'rejected') throw new Error(direct.error.message);
  await direct.run.completion;
  expect(requested).toEqual([fixture.model.id, fixture.model.id, fixture.model.id]);
  expect(fixture.catalog.getSession({ session_id: fixture.sessionId })).toMatchObject({ session: { model_selection: { providerId: fixture.model.provider, modelId: fixture.model.id } } });
});
