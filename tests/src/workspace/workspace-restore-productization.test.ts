import { describe, expect, it } from 'vitest';
import {
  createInMemoryWorkspaceRepository,
  createWorkspace,
  createWorkspaceManager,
  createWorkspaceRootAuthorization,
  type WorkspaceFileHost,
  type WorkspacePath,
} from '../../../src/workspace';

function createMemoryHost(files: Record<string, string>): WorkspaceFileHost {
  return {
    async readTextFile(path) {
      const value = files[String(path)];
      if (value === undefined) throw new Error(`Missing file: ${path}`);
      return value;
    },
    async writeTextFile(path, content) {
      files[String(path)] = content;
    },
    async deleteFile(path) {
      delete files[String(path)];
    },
    async fileExists(path) {
      return Object.prototype.hasOwnProperty.call(files, String(path));
    },
    async listDirectory() {
      return Object.keys(files).map((file) => ({ name: file, path: file as WorkspacePath, kind: 'file' as const }));
    },
  };
}

describe('workspace productized change tracking and restore', () => {
  it('records a scoped change set and restores it through workspace owner rules', async () => {
    const repository = createInMemoryWorkspaceRepository();
    const workspace = createWorkspace({
      id: 'workspace-local',
      projectRoot: 'C:/repo',
      name: 'repo',
      createdAt: '2026-06-20T00:00:00.000Z',
      updatedAt: '2026-06-20T00:00:00.000Z',
    });
    const files = { 'src/a.ts': 'before' };
    const manager = createWorkspaceManager({
      workspace,
      fileHost: createMemoryHost(files),
      now: () => '2026-06-20T00:00:00.000Z',
      createId: (prefix, value) => `${prefix}-${value}`,
      rootAuthorization: createWorkspaceRootAuthorization({
        workspace,
        allowedRoots: ['C:/repo'],
        currentWorkingDirectory: 'C:/repo',
        createdAt: '2026-06-20T00:00:00.000Z',
      }),
      repository,
    });

    manager.beginChangeSet({
      sessionId: 'session-1',
      runId: 'run-1',
      toolCallId: 'tool-call-1',
      toolExecutionId: 'tool-execution-1',
    });
    await manager.writeFile({ path: 'src/a.ts', content: 'after' });
    const finalized = await manager.finalizeActiveChangeSet();

    expect(finalized).toMatchObject({
      runId: 'run-1',
      toolCallId: 'tool-call-1',
      toolExecutionId: 'tool-execution-1',
      status: 'finalized',
      changes: [expect.objectContaining({ path: 'src/a.ts', operation: 'write' })],
    });
    await expect(repository.getChangeSet(String(finalized.id))).resolves.toEqual(expect.objectContaining({
      id: finalized.id,
      changes: [expect.objectContaining({ path: 'src/a.ts', restoreState: 'not_restored' })],
    }));

    const request = manager.createRestoreRequestForChangeSet({ changeSet: finalized, requestedBy: 'user' });
    const result = await manager.restoreChangeSet(finalized, { request });

    expect(result.status).toBe('completed');
    expect(files['src/a.ts']).toBe('before');
    await expect(repository.getRestoreResult(String(result.id))).resolves.toEqual(expect.objectContaining({ status: 'completed' }));
    await expect(repository.getChangeSet(String(finalized.id))).resolves.toEqual(expect.objectContaining({
      changes: [expect.objectContaining({ restoreState: 'restored' })],
    }));
  });
});
