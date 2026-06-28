// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createDatabase, migrateDatabase } from '@megumi/coding-agent/persistence';
import {
  ProjectRepository,
  RecoveryRepository,
  RunRecordRepository,
  SessionMessageRepository,
  SessionRecordRepository,
  TimelineMessageRepository,
} from '@megumi/coding-agent/persistence';
import type { Run } from '@megumi/shared/session';

interface SessionRunSeedRepositories {
  messageRepository: SessionMessageRepository;
  runRepository: RunRecordRepository;
}

function setup() {
  const db = createDatabase(':memory:');
  migrateDatabase(db);
  const project = new ProjectRepository(db).upsertFromRepoPath({ repoPath: '/repo', now: '2026-06-24T00:00:00.000Z' });
  const sessionRepository = new SessionRecordRepository(db);
  const messageRepository = new SessionMessageRepository(db);
  const runRepository = new RunRecordRepository(db);
  sessionRepository.saveSession({
    sessionId: 'session-1', title: 'S', workspaceId: project.projectId, workspacePath: '/repo',
    status: 'active', createdAt: '2026-06-24T00:00:00.000Z', updatedAt: '2026-06-24T00:00:00.000Z',
  });
  return {
    db,
    project,
    seedRepositories: { messageRepository, runRepository },
    recovery: new RecoveryRepository(db),
    timeline: new TimelineMessageRepository(db),
  };
}

function saveRun(seedRepositories: SessionRunSeedRepositories, runId: string, status: Run['status'], createdAt = '2026-06-24T00:00:00.000Z', triggerMessageId?: string) {
  seedRepositories.runRepository.saveRun({
    runId, sessionId: 'session-1', mode: 'default', goal: 'g',
    status, createdAt, startedAt: createdAt,
    ...(triggerMessageId ? { triggerMessageId } : {}),
    ...(status === 'failed' || status === 'cancelled' ? { completedAt: '2026-06-24T00:00:01.000Z' } : {}),
  });
}

function saveUserMessage(seedRepositories: SessionRunSeedRepositories, runId: string, messageId: string, content: string) {
  seedRepositories.messageRepository.saveMessage({
    messageId, sessionId: 'session-1', runId, role: 'user', content,
    status: 'completed', createdAt: '2026-06-24T00:00:00.000Z', completedAt: '2026-06-24T00:00:00.000Z',
  });
}

describe('listRunsNeedingTimelineBackfill', () => {
  it('returns failed and cancelled runs with no timeline commit', () => {
    const { seedRepositories, recovery, project } = setup();
    saveRun(seedRepositories, 'run-failed', 'failed');
    saveRun(seedRepositories, 'run-cancelled', 'cancelled');

    const result = recovery.listRunsNeedingTimelineBackfill();
    expect(result.map((r) => r.runId).sort()).toEqual(['run-cancelled', 'run-failed']);
    const failed = result.find((r) => r.runId === 'run-failed');
    expect(failed?.projectId).toBe(project.projectId);
    expect(failed?.reason).toBe('failed');
    expect(result.find((r) => r.runId === 'run-cancelled')?.reason).toBe('cancelled');
  });

  it('includes the triggering user message content for the prompt above the failure', () => {
    const { seedRepositories, recovery } = setup();
    saveUserMessage(seedRepositories, 'run-with-prompt', 'message-user-1', '我爱你');
    saveRun(seedRepositories, 'run-with-prompt', 'failed', '2026-06-24T00:00:00.000Z', 'message-user-1');

    const result = recovery.listRunsNeedingTimelineBackfill();
    const run = result.find((r) => r.runId === 'run-with-prompt');
    expect(run?.triggerMessageId).toBe('message-user-1');
    expect(run?.triggerMessageContent).toBe('我爱你');
  });

  it('leaves trigger message fields null when the run has no trigger message', () => {
    const { seedRepositories, recovery } = setup();
    saveRun(seedRepositories, 'run-no-trigger', 'failed');
    const run = recovery.listRunsNeedingTimelineBackfill().find((r) => r.runId === 'run-no-trigger');
    expect(run?.triggerMessageId).toBeNull();
    expect(run?.triggerMessageContent).toBeNull();
  });

  it('excludes runs that already have a committed timeline', () => {
    const { seedRepositories, recovery, timeline, project } = setup();
    saveRun(seedRepositories, 'run-committed', 'failed');
    timeline.commitRunTimeline({
      projectId: project.projectId, sessionId: 'session-1', runId: 'run-committed',
      committedAt: '2026-06-24T00:00:01.000Z', messages: [],
    });

    expect(recovery.listRunsNeedingTimelineBackfill().map((r) => r.runId)).toEqual([]);
  });

  it('excludes in-progress runs that were never interrupted', () => {
    const { seedRepositories, recovery } = setup();
    saveRun(seedRepositories, 'run-running', 'running');
    expect(recovery.listRunsNeedingTimelineBackfill().map((r) => r.runId)).toEqual([]);
  });

  it('includes a running run once it is marked interrupted', () => {
    const { seedRepositories, recovery } = setup();
    saveRun(seedRepositories, 'run-running', 'running');
    recovery.markInterruptedRuns({
      markedAt: '2026-06-25T00:00:00.000Z', reason: 'app_restarted',
      createMarkerId: (runId) => `interrupted:${runId}`,
    });
    const result = recovery.listRunsNeedingTimelineBackfill();
    expect(result.map((r) => r.runId)).toEqual(['run-running']);
    expect(result[0]?.reason).toBe('interrupted');
  });

  it('excludes completed runs', () => {
    const { seedRepositories, recovery } = setup();
    saveRun(seedRepositories, 'run-done', 'completed');
    expect(recovery.listRunsNeedingTimelineBackfill().map((r) => r.runId)).toEqual([]);
  });
});
