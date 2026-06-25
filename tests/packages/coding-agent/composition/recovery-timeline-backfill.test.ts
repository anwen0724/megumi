// @vitest-environment node
// Proves the product backfills a visible timeline history message for terminal runs
// (failed / cancelled / interrupted) that never committed timeline — so any UI shell
// renders them inline instead of showing an anchorless recovery action. Runs entirely
// without desktop, against a real SQLite file, exercising recovery startup backfill.
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { composeCodingAgentRuntime } from '@megumi/coding-agent/composition';
import {
  createDatabase,
  migrateDatabase,
  ProjectRepository,
  SessionRunRepository,
} from '@megumi/coding-agent/persistence';
import {
  mergeRawAppSettings,
  resolveAppSettings,
  type AppSettingsRaw,
} from '@megumi/shared/settings';
import type { CodingAgentProductRuntime } from '@megumi/coding-agent/product-runtime';

function appSettingsProvider() {
  let rawSettings: AppSettingsRaw = {};
  return {
    getResolvedSettings: () => resolveAppSettings(rawSettings),
    updateSettings(patch: AppSettingsRaw) {
      rawSettings = mergeRawAppSettings(rawSettings, patch);
      return resolveAppSettings(rawSettings);
    },
  };
}

// Seed an orphan terminal run (no timeline_messages) directly into the SQLite file,
// closing the connection before the runtime opens it.
function seedOrphanRun(home: string, runId: string, status: 'failed' | 'cancelled', errorJson?: string) {
  const db = createDatabase(path.join(home, 'megumi.sqlite3'));
  try {
    migrateDatabase(db);
    const project = new ProjectRepository(db).upsertFromRepoPath({ repoPath: home, now: '2026-06-24T00:00:00.000Z' });
    const sessionRepo = new SessionRunRepository(db);
    const session = sessionRepo.saveSession({
      sessionId: `session-${runId}`, title: 'Old session', workspaceId: project.projectId, workspacePath: home,
      status: 'active', createdAt: '2026-06-23T00:00:00.000Z', updatedAt: '2026-06-23T00:00:00.000Z',
    });
    const triggerMessageId = `message-user-${runId}`;
    sessionRepo.saveMessage({
      messageId: triggerMessageId, sessionId: String(session.sessionId), runId, role: 'user',
      content: '我爱你', status: 'completed',
      createdAt: '2026-06-23T00:57:50.000Z', completedAt: '2026-06-23T00:57:50.000Z',
    });
    sessionRepo.saveRun({
      runId, sessionId: String(session.sessionId), mode: 'default', goal: 'do a thing',
      triggerMessageId,
      status, createdAt: '2026-06-23T00:57:50.000Z', startedAt: '2026-06-23T00:57:50.000Z',
      completedAt: '2026-06-23T00:57:51.000Z',
      ...(errorJson ? { error: JSON.parse(errorJson) } : {}),
    });
    return { projectId: project.projectId, sessionId: String(session.sessionId) };
  } finally {
    db.close();
  }
}

function composeRuntime(home: string): CodingAgentProductRuntime {
  return composeCodingAgentRuntime({
    homePaths: { homePath: home, sqlitePath: home, settingsPath: path.join(home, 'settings.json') },
    runtimeLogger: { warn: () => undefined },
    modelStepProviderService: {
      streamModelStep: async function* () {},
      completeModelStep: async () => ({ ok: true, text: '' }),
      cancelModelStep: () => false,
    } as never,
    appSettingsProvider: appSettingsProvider(),
    memorySettingsProvider: { isMemoryEnabled: () => false },
    permissionSettingsProvider: { loadForProject: async () => ({ allow: [], ask: [], deny: [] }) },
  });
}

describe('recovery startup backfills timeline for orphan terminal runs', () => {
  let home: string | undefined;
  let runtime: CodingAgentProductRuntime | undefined;

  afterEach(async () => {
    runtime?.dispose();
    runtime = undefined;
    if (home) {
      await rm(home, { recursive: true, force: true });
      home = undefined;
    }
  });

  it('commits a failure timeline message for an orphan failed run, idempotently', async () => {
    home = await mkdtemp(path.join(os.tmpdir(), 'megumi-backfill-'));
    const errorJson = JSON.stringify({ code: 'runtime_unknown', message: 'partId too big', severity: 'error', retryable: false, source: 'core' });
    const { projectId, sessionId } = seedOrphanRun(home, 'run-failed-1', 'failed', errorJson);

    // First compose triggers recovery startup backfill.
    runtime = composeRuntime(home);
    const after = runtime.sessionRunService.listTimelineMessagesBySession({ projectId, sessionId });
    // Backfill mirrors a normal turn: the triggering user prompt, then the failure.
    expect(after.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    const userMessage = after.messages[0];
    expect(userMessage.role === 'user' && userMessage.blocks.some(
      (b) => b.kind === 'user_text' && b.text === '我爱你',
    )).toBe(true);
    runtime.dispose();

    // Second compose must NOT duplicate (idempotent via timeline_run_commits row).
    runtime = composeRuntime(home);
    const again = runtime.sessionRunService.listTimelineMessagesBySession({ projectId, sessionId });
    expect(again.messages.length).toBe(2);
  }, 30000);

  it('commits a cancellation timeline message for an orphan cancelled run', async () => {
    home = await mkdtemp(path.join(os.tmpdir(), 'megumi-backfill-cancel-'));
    const { projectId, sessionId } = seedOrphanRun(home, 'run-cancelled-1', 'cancelled');

    runtime = composeRuntime(home);
    const after = runtime.sessionRunService.listTimelineMessagesBySession({ projectId, sessionId });
    expect(after.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
  }, 30000);
});
