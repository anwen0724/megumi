// @vitest-environment node
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { applyCodingAgentDatabaseMigrations } from '@megumi/coding-agent/persistence/schema/migrate';
import { ToolCallRepository } from '@megumi/coding-agent/persistence/repos/tool-call.repo';
import { AgentLoopRepository } from '@megumi/coding-agent/persistence/repos/agent-loop.repo';
import { ToolRegistrySnapshotService } from '@megumi/coding-agent/tools/tool-registry-snapshot';

let db: Database.Database | null = null;

function createHarness() {
  db = new Database(':memory:');
  applyCodingAgentDatabaseMigrations(db);
  seedLifecycle(db);
  const repository = new ToolCallRepository(db);
  const agentLoopRepository = new AgentLoopRepository(db);
  return {
    repository,
    service: new ToolRegistrySnapshotService({
      getToolSource: (sourceId) => repository.getToolSource(sourceId),
      listToolSources: () => repository.listToolSources(),
      seedDefaultToolSources: (createdAt) => repository.seedDefaultToolSources(createdAt),
      saveToolRegistrySnapshot: (snapshot) => agentLoopRepository.saveToolRegistrySnapshot(snapshot),
      getToolRegistrySnapshotByRun: (runId) => repository.getToolRegistrySnapshotByRun(runId),
    }),
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
  database.exec(`
    INSERT INTO workspaces (
      workspace_id, name, root_path, root_path_key, status, created_at, updated_at, last_opened_at, metadata_json
    ) VALUES (
      'project-1', 'Project 1', 'C:\\workspace\\project-1', 'c:\\workspace\\project-1',
      'available', '2026-05-16T00:00:00.000Z', '2026-05-16T00:00:00.000Z',
      '2026-05-16T00:00:00.000Z', NULL
    );

    INSERT INTO sessions (
      session_id, workspace_id, title, status, active_entry_id,
      created_at, updated_at, archived_at, metadata_json
    ) VALUES (
      'session-1', 'project-1', 'Tool session', 'active', NULL,
      '2026-05-16T00:00:00.000Z', '2026-05-16T00:00:00.000Z', NULL, NULL
    );
  `);
  seedRun(database, 'run-1');
}

function seedRun(database: Database.Database, runId: string): void {
  database.prepare(`
    INSERT INTO agent_loop_runs (
      run_id, workspace_id, session_id, run_kind, user_message_id, assistant_message_id,
      base_run_id, base_message_id, base_entry_id, attempt_number, status, permission_mode,
      permission_snapshot_json, memory_recall_trace_id, started_at, completed_at, cancelled_at,
      error_json, created_at, metadata_json
    ) VALUES (
      ?, 'project-1', 'session-1', 'normal', NULL, NULL,
      NULL, NULL, NULL, 1, 'running', 'default',
      NULL, NULL, '2026-05-20T00:00:00.000Z', NULL, NULL,
      NULL, '2026-05-20T00:00:00.000Z', '{"goal":"Use tool"}'
    )
  `).run(runId);
}
