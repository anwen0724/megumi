/* Verifies the shared Composition starts a real Product flow without Electron. */
// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { createDatabase } from '@megumi/database';
import { DiscoveryHomeUiResultSchema } from '@megumi/product-host/host';
import { createInterestRepository } from '../../../packages/agent/discovery/src/persistence/interest-repository';
import { composeTestApplication, type TestApplication } from './compose-test-application';

let application: TestApplication | undefined;
afterEach(async () => { await application?.cleanup(); application = undefined; });

describe('composeApplication', () => {
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
        const home = DiscoveryHomeUiResultSchema.parse(await application.runtime.host.discovery.getHome({ mode, limit: 60 }));
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
