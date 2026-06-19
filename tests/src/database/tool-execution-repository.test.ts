// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  openSqliteDatabase,
  runDatabaseMigrations,
  SqliteToolExecutionRepository,
} from '../../../src/database';

describe('SqliteToolExecutionRepository', () => {
  it('persists tool executions and audit records by run and tool call', async () => {
    const database = openSqliteDatabase(':memory:');
    runDatabaseMigrations(database, { now: () => '2026-06-20T00:00:00.000Z' });
    const repository = new SqliteToolExecutionRepository(database);

    await repository.createExecution({
      id: 'tool-execution-1',
      toolCallId: 'tool-call-1',
      toolName: 'write_file',
      status: 'running',
      runId: 'run-1',
      sessionId: 'session-1',
      workspaceId: 'workspace-local',
      turnIndex: 0,
      startedAt: '2026-06-20T00:00:00.000Z',
    });
    await repository.updateExecution({
      id: 'tool-execution-1',
      toolCallId: 'tool-call-1',
      toolName: 'write_file',
      status: 'succeeded',
      runId: 'run-1',
      sessionId: 'session-1',
      workspaceId: 'workspace-local',
      turnIndex: 0,
      startedAt: '2026-06-20T00:00:00.000Z',
      endedAt: '2026-06-20T00:00:01.000Z',
      workspaceChangeSetId: 'workspace-change-set-1',
    });
    await repository.saveAuditRecord({
      id: 'tool-audit-1',
      toolCallId: 'tool-call-1',
      toolName: 'write_file',
      status: 'success',
      createdAt: '2026-06-20T00:00:01.000Z',
    });

    await expect(repository.listExecutions({ runId: 'run-1' })).resolves.toEqual([
      expect.objectContaining({
        id: 'tool-execution-1',
        toolCallId: 'tool-call-1',
        toolName: 'write_file',
        status: 'succeeded',
        workspaceChangeSetId: 'workspace-change-set-1',
      }),
    ]);
    await expect(repository.getExecution('tool-execution-1')).resolves.toEqual(expect.objectContaining({
      id: 'tool-execution-1',
      runId: 'run-1',
      sessionId: 'session-1',
    }));
    await expect(repository.listAuditRecords({ toolCallId: 'tool-call-1' })).resolves.toHaveLength(1);
    database.close();
  });
});
