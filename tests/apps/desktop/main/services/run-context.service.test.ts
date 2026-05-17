// @vitest-environment node
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { migrateDatabase } from '@megumi/db/schema/migrations';
import { SessionRunRepository } from '@megumi/db/repos/session-run.repo';
import { RunContextRepository } from '@megumi/db/repos/run-context.repo';
import { RunContextService } from '@megumi/desktop/main/services/run-context.service';

let db: Database.Database | null = null;

function createService(rootPath: string) {
  db = new Database(':memory:');
  migrateDatabase(db);
  const lifecycle = new SessionRunRepository(db);
  const context = new RunContextRepository(db);
  lifecycle.saveSession({
    sessionId: 'session-1',
    title: 'Context',
    workspaceId: 'workspace-1',
    workspacePath: rootPath,
    status: 'active',
    createdAt: '2026-05-15T00:00:00.000Z',
    updatedAt: '2026-05-15T00:00:00.000Z',
  });
  lifecycle.saveRun({
    runId: 'run-1',
    sessionId: 'session-1',
    mode: 'chat',
    goal: 'Read context',
    status: 'running',
    createdAt: '2026-05-15T00:00:01.000Z',
  });

  return new RunContextService({
    contextRepository: context,
    clock: { now: () => '2026-05-15T00:00:02.000Z' },
  });
}

afterEach(() => {
  db?.close();
  db = null;
});

describe('RunContextService', () => {
  it('creates baseline context with safe workspace boundary', () => {
    const service = createService('C:/all/work/study/megumi');

    const context = service.createBaselineContext({
      runId: 'run-1',
      goal: 'Read context',
      workspaceId: 'workspace-1',
      workspacePath: 'C:/all/work/study/megumi',
      modelCapabilitySummary: {
        providerId: 'deepseek',
        modelId: 'deepseek-chat',
        modelContextWindow: 64000,
        reservedOutputTokens: 4096,
        availableInputTokens: 59904,
      },
    });

    expect(context.workspaceBoundary).toMatchObject({
      workspaceId: 'workspace-1',
      rootPath: 'C:/all/work/study/megumi',
      outsideWorkspacePolicy: 'deny',
    });
    expect(JSON.stringify(context)).not.toContain('sk-test');
  });

  it('lists ordinary workspace file sources without returning raw file content', () => {
    const root = join(tmpdir(), `megumi-context-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'README.md'), '# Megumi\n');
    writeFileSync(join(root, '.env'), 'API_KEY=sk-test-1234567890abcdef\n');
    const service = createService(root);
    service.createBaselineContext({
      runId: 'run-1',
      goal: 'Read context',
      workspaceId: 'workspace-1',
      workspacePath: root,
      modelCapabilitySummary: {
        providerId: 'deepseek',
        modelId: 'deepseek-chat',
        modelContextWindow: 64000,
        reservedOutputTokens: 4096,
        availableInputTokens: 59904,
      },
    });

    const sources = service.listWorkspaceSources({
      runId: 'run-1',
      workspaceId: 'workspace-1',
      workspacePath: root,
    });

    expect(sources.map((source) => source.relativePath)).toContain('README.md');
    expect(sources.find((source) => source.relativePath === '.env')?.redactionState).toBe('blocked');
    expect(JSON.stringify(sources)).not.toContain('sk-test-1234567890abcdef');
  });
});
