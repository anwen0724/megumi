/* Verifies the shared Composition starts a real Product flow without Electron. */
// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { createDatabase } from '@megumi/application/storage/index';
import { DiscoveryHomeUiResultSchema } from '@megumi/application/contracts';
import { createInterestRepository } from '@megumi/application/discovery/interests/interest-repository';
import { createRecommendationRepository } from '@megumi/application/discovery/recommendations/recommendation-repository';
import { composeTestApplication, type TestApplication } from './compose-test-application';

let application: TestApplication | undefined;
afterEach(async () => { await application?.cleanup(); application = undefined; });

describe('createApplication', () => {
  it('opens separate discussions for a published recommendation and rejects invalid associations without creating chats', async () => {
    application = composeTestApplication();
    const database = createDatabase({ filename: path.join(application.home, 'sqlite', 'megumi.sqlite') });
    let recommendationId: string;
    try {
      database.prepare({ sql: `INSERT INTO discovery_candidates
        (id, content_identity, source_id, canonical_url, content_type, title, content_summary, content_truncated, status, created_at, expires_at)
        VALUES ('discussion-candidate', 'discussion-identity', 'open_web', 'https://example.test/article', 'article', 'Agent runtime', 'An article', 0, 'available', '2026-01-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z')` }).run();
      const repository = createRecommendationRepository({ database });
      const published = repository.publish({ localDate: '2026-01-01', snapshotAt: '2026-01-01T00:00:00.000Z', publishedAt: '2026-01-01T00:00:00.000Z',
        items: [{ candidateId: 'discussion-candidate', sourceName: 'Web', recommendationReason: 'Relevant.',
          selectionBasis: { primaryInterestId: 'interest', matchedInterestIds: ['interest'], interestRevisions: [], preferenceRevisions: [] } }],
      });
      if (published.status !== 'published') throw new Error('Expected the fixture recommendation to publish.');
      recommendationId = published.collection.items[0].id;
    } finally { database.close(); }
    const opened = await application.runtime.workspace.useExistingProject();
    if (opened.status !== 'opened' || !opened.project) throw new Error('Expected an open workspace.');
    const request = { projectId: opened.project.projectId, recommendationId, text: 'Discuss this article',
      modelSelection: { provider_id: 'test', model_id: 'model' }, permissionMode: 'full_access' as const };
    const first = await application.runtime.session.sendUserInput(request);
    const second = await application.runtime.session.sendUserInput(request);
    if (first.payload.type !== 'agent_run' || second.payload.type !== 'agent_run') throw new Error('Expected both discussions to start.');
    expect(first.payload.session.id).not.toBe(second.payload.session.id);
    expect(JSON.stringify(first.payload.userMessage)).toContain(recommendationId);
    expect(JSON.stringify(second.payload.userMessage)).toContain(recommendationId);
    const before = await application.runtime.session.listSessions();
    expect(await application.runtime.session.sendUserInput({ ...request, recommendationId: 'missing' })).toMatchObject({ payload: { type: 'error' } });
    expect(await application.runtime.session.sendUserInput({ ...request, sessionId: first.payload.session.id })).toMatchObject({ payload: { type: 'error' } });
    expect(await application.runtime.session.listSessions()).toEqual(before);
  });
  it('returns the Discovery home with persisted active and paused Interests without leaking entity fields', async () => {
    application = composeTestApplication();
    // Seed the real Repository without triggering background supply or model execution.
    const database = createDatabase({ filename: path.join(application.home, 'sqlite', 'megumi.sqlite') });
    try {
      const repository = createInterestRepository(database);
      const createdAt = '2026-01-01T00:00:00.000Z';
      const updatedAt = '2026-01-01T00:01:00.000Z';
      for (const id of ['active', 'paused', 'deleted']) {
        repository.applyInterestChange({
          action: 'create', interestId: `interest:${id}`, description: `Topic ${id}`, now: createdAt,
        });
      }
      repository.applyInterestChange({ action: 'pause', interestId: 'interest:paused', now: updatedAt });
      repository.applyInterestChange({ action: 'delete', interestId: 'interest:deleted', now: updatedAt });

      for (const mode of ['timeline', 'favorites', 'watch_later'] as const) {
        const home = DiscoveryHomeUiResultSchema.parse(await application.runtime.discovery.getHome({ mode, limit: 60 }));
        expect(home.interests).toEqual([
          { interestId: 'interest:active', description: 'Topic active', status: 'active', createdFrom: 'manual',
            userManagedAt: createdAt, createdAt, updatedAt: createdAt },
          { interestId: 'interest:paused', description: 'Topic paused', status: 'paused', createdFrom: 'manual',
            userManagedAt: updatedAt, createdAt, updatedAt },
        ]);
      }
      const persisted = repository.findInterestById('interest:paused');
      expect(persisted).toMatchObject({ revision: expect.any(Number), pausedAt: updatedAt });
      expect(application.contexts).toHaveLength(0);
    } finally {
      database.close();
    }
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
