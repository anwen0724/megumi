// @vitest-environment node
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { migrateDatabase } from '@megumi/db/schema/migrations';
import { ToolRepository } from '@megumi/db/repos/tool.repo';
import { ToolRegistrySnapshotService } from '@megumi/desktop/main/services/tool/tool-registry-snapshot.service';

let db: Database.Database | null = null;

function createHarness() {
  db = new Database(':memory:');
  migrateDatabase(db);
  seedLifecycle(db);
  const repository = new ToolRepository(db);
  return {
    repository,
    service: new ToolRegistrySnapshotService(repository),
  };
}

afterEach(() => {
  db?.close();
  db = null;
});

describe('ToolRegistrySnapshotService', () => {
  it('seeds sources, creates a run snapshot, and persists model-visible built-ins', () => {
    const { repository, service } = createHarness();

    const result = service.createRunSnapshot(createInput());

    expect(result.diagnostics.createdSourceIds).toEqual(['built_in', 'external_test']);
    expect(repository.getToolSource('built_in')?.enabled).toBe(true);
    expect(repository.getToolSource('external_test')?.enabled).toBe(false);
    expect(repository.getToolRegistrySnapshotByRun('run-1')).toEqual(result.snapshot);
    expect(result.modelVisibleToolDefinitions.map((definition) => definition.name)).toEqual([
      'read_file',
      'list_directory',
      'glob',
      'search_text',
      'edit_file',
      'write_file',
      'run_command',
    ]);
    expect(result.modelVisibleToolDefinitions.map((definition) => definition.name)).not.toContain('demo_echo');
  });

  it('source changes only affect new run snapshots', () => {
    const { repository, service } = createHarness();

    const runA = service.createRunSnapshot(createInput({ runId: 'run-1' }));
    const externalTest = repository.getToolSource('external_test');
    if (!externalTest) {
      throw new Error('Expected external_test source.');
    }
    repository.saveToolSource({
      ...externalTest,
      enabled: true,
      updatedAt: '2026-06-14T00:00:01.000Z',
    });
    const runAAfterSourceChange = service.createRunSnapshot(createInput({ runId: 'run-1' }));
    seedRun(db!, 'run-2');
    const runB = service.createRunSnapshot(createInput({ runId: 'run-2' }));

    expect(runAAfterSourceChange.snapshot).toEqual(runA.snapshot);
    expect(runAAfterSourceChange.modelVisibleToolDefinitions.map((definition) => definition.name)).not.toContain('demo_echo');
    expect(runB.modelVisibleToolDefinitions.map((definition) => definition.name)).toContain('demo_echo');
  });

  it('records model unsupported diagnostics and persists hidden entries', () => {
    const { repository, service } = createHarness();

    const result = service.createRunSnapshot(createInput({
      providerCapabilitySummary: { supportsToolCall: false },
    }));

    expect(result.modelVisibleToolDefinitions).toEqual([]);
    expect(repository.getToolRegistrySnapshotByRun('run-1')?.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          disabledReason: 'model_tools_unsupported',
          exposedToModel: false,
        }),
      ]),
    );
    expect(result.diagnostics.modelSupportsToolCall).toBe(false);
  });
});

function createInput(overrides: Partial<Parameters<ToolRegistrySnapshotService['createRunSnapshot']>[0]> = {}) {
  return {
    runId: 'run-1',
    projectId: 'project-1',
    permissionMode: 'default' as const,
    modelId: 'gpt-5',
    createdAt: '2026-06-14T00:00:00.000Z',
    providerCapabilitySummary: { supportsToolCall: true },
    ...overrides,
  };
}

function seedLifecycle(database: Database.Database): void {
  database.prepare(`
    INSERT INTO projects (project_id, name, repo_path, repo_path_key, status, created_at, last_opened_at)
    VALUES ('project-1', 'Project 1', 'C:\\workspace\\project-1', 'c:\\workspace\\project-1', 'active', '2026-05-16T00:00:00.000Z', '2026-05-16T00:00:00.000Z')
  `).run();
  database.prepare(`
    INSERT INTO sessions (session_id, title, status, created_at, updated_at)
    VALUES ('session-1', 'Tool session', 'active', '2026-05-16T00:00:00.000Z', '2026-05-16T00:00:00.000Z')
  `).run();
  seedRun(database, 'run-1');
}

function seedRun(database: Database.Database, runId: string): void {
  database.prepare(`
    INSERT INTO runs (run_id, session_id, permission_mode, goal, status, created_at)
    VALUES (?, 'session-1', 'default', 'Use tool', 'running', '2026-05-20T00:00:00.000Z')
  `).run(runId);
}
