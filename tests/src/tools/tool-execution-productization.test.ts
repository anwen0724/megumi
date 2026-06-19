import { describe, expect, it } from 'vitest';
import { evaluatePermissionPolicy } from '../../../src/permission';
import { createBuiltInToolRegistry, createInMemoryToolExecutionRepository, createToolExecutionService } from '../../../src/tools';
import {
  createInMemoryWorkspaceRepository,
  createWorkspace,
  createWorkspaceManager,
  type WorkspaceFileHost,
  type WorkspacePath,
} from '../../../src/workspace';

function memoryHost(files: Record<string, string>): WorkspaceFileHost {
  return {
    async readTextFile(path) { return files[String(path)] ?? ''; },
    async writeTextFile(path, content) { files[String(path)] = content; },
    async deleteFile(path) { delete files[String(path)]; },
    async fileExists(path) { return Object.prototype.hasOwnProperty.call(files, String(path)); },
    async listDirectory() { return Object.keys(files).map((file) => ({ name: file, path: file as WorkspacePath, kind: 'file' as const })); },
  };
}

describe('ToolExecutionService productization', () => {
  it('persists execution, audit, and workspace change facts for mutation tools', async () => {
    const files = { 'src/a.ts': 'before' };
    const workspaceRepository = createInMemoryWorkspaceRepository();
    const workspace = createWorkspace({ id: 'workspace-local', projectRoot: 'C:/repo', createdAt: '2026-06-20T00:00:00.000Z', updatedAt: '2026-06-20T00:00:00.000Z' });
    const workspaceManager = createWorkspaceManager({
      workspace,
      fileHost: memoryHost(files),
      repository: workspaceRepository,
      now: () => '2026-06-20T00:00:00.000Z',
      createId: (prefix, value) => `${prefix}-${value}`,
    });
    const executionRepository = createInMemoryToolExecutionRepository();
    const service = createToolExecutionService({
      registry: createBuiltInToolRegistry(),
      workspace: workspaceManager,
      executionRepository,
      now: () => '2026-06-20T00:00:00.000Z',
      createId: (prefix, value) => `${prefix}-${value}`,
    });
    const decision = evaluatePermissionPolicy({
      decisionId: 'decision-1',
      mode: 'accept_edits',
      operation: 'write',
      actionName: 'write_file',
      target: 'src/a.ts',
      createdAt: '2026-06-20T00:00:00.000Z',
    });

    const result = await service.execute(
      { id: 'tool-call-1', name: 'write_file', input: { path: 'src/a.ts', content: 'after' } },
      {
        permissionDecision: decision,
        runId: 'run-1',
        sessionId: 'session-1',
        workspaceId: 'workspace-local',
        turnIndex: 0,
      },
    );

    expect(result.status).toBe('success');
    await expect(executionRepository.listExecutions({ runId: 'run-1' })).resolves.toEqual([
      expect.objectContaining({
        toolCallId: 'tool-call-1',
        status: 'succeeded',
        workspaceChangeSetId: expect.any(String),
      }),
    ]);
    await expect(workspaceRepository.listChangeSets({ runId: 'run-1' })).resolves.toEqual([
      expect.objectContaining({
        toolCallId: 'tool-call-1',
        changes: [expect.objectContaining({ path: 'src/a.ts', operation: 'write' })],
      }),
    ]);
    await expect(executionRepository.listAuditRecords({ toolCallId: 'tool-call-1' })).resolves.toHaveLength(1);
  });
});
