/* Verifies the shared Composition starts a real Product flow without Electron. */
// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import fs from 'fs-extra';
import { deferred } from '../agent/agent-fixture';
import { composeTestApplication, type TestApplication } from './compose-test-application';

let application: TestApplication | undefined;
afterEach(async () => { await application?.cleanup(); application = undefined; });

describe('createApplication', () => {
  it('lists saved Interests as id, text and enable state without leaking entity fields', async () => {
    application = composeTestApplication();
    const active = await application.runtime.discovery.changeInterest({
      action: 'create', description: 'Topic active',
    });
    if (active.status !== 'changed') throw new Error('Expected the active Interest to be saved.');
    const second = await application.runtime.discovery.changeInterest({
      action: 'create', description: 'Topic paused',
    });
    if (second.status !== 'changed') throw new Error('Expected the paused Interest to be saved.');
    const target = second.interests.find((interest) => interest.text === 'Topic paused');
    if (!target) throw new Error('Expected the created Interest in the returned snapshot.');
    expect(await application.runtime.discovery.changeInterest({
      action: 'pause', interestId: target.id,
    })).toMatchObject({ status: 'changed' });

    const interests = (await application.runtime.discovery.listInterests()).interests;
    expect(interests).toEqual([
      { id: expect.any(String), text: 'Topic active', enabled: true },
      { id: expect.any(String), text: 'Topic paused', enabled: false },
    ]);
    for (const interest of interests) {
      expect(Object.keys(interest).sort()).toEqual(['enabled', 'id', 'text']);
    }
    expect(application.contexts).toHaveLength(0);
  });

  it('exposes Product Host and commits a scripted Conversation reply', async () => {
    application = composeTestApplication(['A committed reply.']);
    await application.runtime.start();
    const opened = await application.runtime.workspace.useExistingProject();
    expect(opened.status).toBe('opened');
    if (opened.status !== 'opened' || !opened.project) return;
    const submitted = await application.runtime.session.sendUserInput({
      projectId: opened.project.projectId,
      text: 'Hello',
      modelSelection: { provider_id: 'test', model_id: 'model' },
      permissionMode: 'full_access',
    });
    expect(submitted.payload.type).toBe('agent_run');
    if (submitted.payload.type !== 'agent_run') return;
    await vi.waitFor(async () => {
      const result = await application?.runtime.session.readCommittedRun({
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


it('pins the session model when a later application default changes', async () => {
  application = composeTestApplication();
  const app = application;
  let ended = deferred();
  app.runtime.subscribeRuntimeEvents({ eventTypes: ['run.ended'] }, () => ended.resolve());
  const opened = await app.runtime.workspace.useExistingProject();
  if (opened.status !== 'opened' || !opened.project) throw new Error('Workspace unavailable');
  const first = await app.runtime.session.sendUserInput({ projectId: opened.project.projectId, text: 'First' });
  if (first.payload.type !== 'agent_run') throw new Error(JSON.stringify(first));
  await ended.promise;
  const settingsPath = path.join(app.home, 'settings.json');
  const settings = fs.readJsonSync(settingsPath);
  settings.general.lastSelectedModel = { providerId: 'test', modelId: 'other' };
  settings.providers.test.models.other = { contextWindowTokens: 64000, maxOutputTokens: 2048 };
  fs.writeJsonSync(settingsPath, settings);
  ended = deferred();
  const second = await app.runtime.session.sendUserInput({ projectId: opened.project.projectId, sessionId: first.payload.session.id, text: 'Second' });
  if (second.payload.type !== 'agent_run') throw new Error('Expected second run');
  await ended.promise;
  expect(second.payload.session.modelSelection).toEqual({ providerId: 'test', modelId: 'model' });
});
