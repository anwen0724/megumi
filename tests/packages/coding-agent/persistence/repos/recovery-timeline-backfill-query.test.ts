// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createDatabase, migrateDatabase } from '@megumi/coding-agent/persistence';
import { ProjectRepository, SessionRunRepository, RecoveryRepository, TimelineMessageRepository } from '@megumi/coding-agent/persistence';

function setup() {
  const db = createDatabase(':memory:');
  migrateDatabase(db);
  const project = new ProjectRepository(db).upsertFromRepoPath({ repoPath: '/repo', now: '2026-06-24T00:00:00.000Z' });
  const sessionRepo = new SessionRunRepository(db);
  sessionRepo.saveSession({
    sessionId: 'session-1', title: 'S', workspaceId: project.projectId, workspacePath: '/repo',
    status: 'active', createdAt: '2026-06-24T00:00:00.000Z', updatedAt: '2026-06-24T00:00:00.000Z',
  });
  return { db, project, sessionRepo, recovery: new RecoveryRepository(db), timeline: new TimelineMessageRepository(db) };
}

function saveRun(sessionRepo: SessionRunRepository, runId: string, status: string, createdAt = '2026-06-24T00:00:00.000Z', triggerMessageId?: string) {
  sessionRepo.saveRun({
    runId, sessionId: 'session-1', mode: 'default', goal: 'g',
    status: status as never, createdAt, startedAt: createdAt,
    ...(triggerMessageId ? { triggerMessageId } : {}),
    ...(status === 'failed' || status === 'cancelled' ? { completedAt: '2026-06-24T00:00:01.000Z' } : {}),
  });
}

function saveUserMessage(sessionRepo: SessionRunRepository, runId: string, messageId: string, content: string) {
  sessionRepo.saveMessage({
    messageId, sessionId: 'session-1', runId, role: 'user', content,
    status: 'completed', createdAt: '2026-06-24T00:00:00.000Z', completedAt: '2026-06-24T00:00:00.000Z',
  });
}

describe('listRunsNeedingTimelineBackfill', () => {
  it('returns failed and cancelled runs with no timeline commit', () => {
    const { sessionRepo, recovery, project } = setup();
    saveRun(sessionRepo, 'run-failed', 'failed');
    saveRun(sessionRepo, 'run-cancelled', 'cancelled');

    const result = recovery.listRunsNeedingTimelineBackfill();
    expect(result.map((r) => r.runId).sort()).toEqual(['run-cancelled', 'run-failed']);
    const failed = result.find((r) => r.runId === 'run-failed');
    expect(failed?.projectId).toBe(project.projectId);
    expect(failed?.reason).toBe('failed');
    expect(result.find((r) => r.runId === 'run-cancelled')?.reason).toBe('cancelled');
  });

  it('includes the triggering user message content for the prompt above the failure', () => {
    const { sessionRepo, recovery } = setup();
    saveUserMessage(sessionRepo, 'run-with-prompt', 'message-user-1', '我爱你');
    saveRun(sessionRepo, 'run-with-prompt', 'failed', '2026-06-24T00:00:00.000Z', 'message-user-1');

    const result = recovery.listRunsNeedingTimelineBackfill();
    const run = result.find((r) => r.runId === 'run-with-prompt');
    expect(run?.triggerMessageId).toBe('message-user-1');
    expect(run?.triggerMessageContent).toBe('我爱你');
  });

  it('leaves trigger message fields null when the run has no trigger message', () => {
    const { sessionRepo, recovery } = setup();
    saveRun(sessionRepo, 'run-no-trigger', 'failed');
    const run = recovery.listRunsNeedingTimelineBackfill().find((r) => r.runId === 'run-no-trigger');
    expect(run?.triggerMessageId).toBeNull();
    expect(run?.triggerMessageContent).toBeNull();
  });

  it('excludes runs that already have a committed timeline', () => {
    const { sessionRepo, recovery, timeline, project } = setup();
    saveRun(sessionRepo, 'run-committed', 'failed');
    timeline.commitRunTimeline({
      projectId: project.projectId, sessionId: 'session-1', runId: 'run-committed',
      committedAt: '2026-06-24T00:00:01.000Z', messages: [],
    });

    expect(recovery.listRunsNeedingTimelineBackfill().map((r) => r.runId)).toEqual([]);
  });

  it('excludes in-progress runs that were never interrupted', () => {
    const { sessionRepo, recovery } = setup();
    saveRun(sessionRepo, 'run-running', 'running');
    expect(recovery.listRunsNeedingTimelineBackfill().map((r) => r.runId)).toEqual([]);
  });

  it('includes a running run once it is marked interrupted', () => {
    const { sessionRepo, recovery } = setup();
    saveRun(sessionRepo, 'run-running', 'running');
    recovery.markInterruptedRuns({
      markedAt: '2026-06-25T00:00:00.000Z', reason: 'app_restarted',
      createMarkerId: (runId) => `interrupted:${runId}`,
    });
    const result = recovery.listRunsNeedingTimelineBackfill();
    expect(result.map((r) => r.runId)).toEqual(['run-running']);
    expect(result[0]?.reason).toBe('interrupted');
  });

  it('excludes completed runs', () => {
    const { sessionRepo, recovery } = setup();
    saveRun(sessionRepo, 'run-done', 'completed');
    expect(recovery.listRunsNeedingTimelineBackfill().map((r) => r.runId)).toEqual([]);
  });
});
