// Provides workspace file access and managed mutation while recording changes through workspace-owned facts.
import type {
  Workspace,
  WorkspaceChangedFile,
  WorkspaceChangeSet,
  WorkspaceChangeSummary,
  WorkspaceCheckpoint,
  WorkspaceDirectoryEntry,
  WorkspaceEditInput,
  WorkspaceFileHost,
  WorkspaceFileMetadata,
  WorkspaceFileSnapshot,
  WorkspacePath,
  WorkspaceRestoreFileResult,
  WorkspaceRestoreRequest,
  WorkspaceRestoreResult,
  WorkspaceRootAuthorization,
  WorkspaceWriteInput,
} from './types';
import { normalizeWorkspacePath } from './types';
import type { WorkspaceRepository } from './repository';

export interface WorkspaceManagerOptions {
  workspace: Workspace;
  fileHost: WorkspaceFileHost;
  now: () => string;
  createId: (prefix: string, value: string) => string;
  rootAuthorization?: WorkspaceRootAuthorization;
  repository?: WorkspaceRepository;
  sessionId?: string;
  runId?: string;
  toolCallId?: string;
  toolExecutionId?: string;
}

export interface WorkspaceManager {
  readonly workspace: Workspace;
  readFile(path: string): Promise<string>;
  listDirectory(path: string): Promise<WorkspaceDirectoryEntry[]>;
  statFile(path: string): Promise<WorkspaceFileMetadata>;
  glob(pattern: string): Promise<WorkspacePath[]>;
  searchText(input: { pattern: string; query: string }): Promise<Array<{ path: WorkspacePath; line: number; text: string }>>;
  beginChangeSet(input: { sessionId?: string; runId?: string; toolCallId?: string; toolExecutionId?: string }): WorkspaceChangeSet;
  writeFile(input: WorkspaceWriteInput): Promise<WorkspaceChangedFile>;
  editFile(input: WorkspaceEditInput): Promise<WorkspaceChangedFile>;
  deleteFile(path: string): Promise<WorkspaceChangedFile>;
  createCheckpoint(input: { label: string; paths: string[] }): Promise<WorkspaceCheckpoint>;
  invalidateCheckpoint(checkpoint: WorkspaceCheckpoint, reason: string): WorkspaceCheckpoint;
  discardCheckpoint(checkpoint: WorkspaceCheckpoint, reason: string): WorkspaceCheckpoint;
  createRestoreRequest(input: { checkpoint: WorkspaceCheckpoint; requestedBy: 'user' | 'system' }): WorkspaceRestoreRequest;
  restoreCheckpoint(checkpoint: WorkspaceCheckpoint, options?: { request?: WorkspaceRestoreRequest }): Promise<WorkspaceRestoreResult>;
  createRestoreRequestForChangeSet(input: { changeSet: WorkspaceChangeSet; requestedBy: 'user' | 'system' }): WorkspaceRestoreRequest;
  restoreChangeSet(changeSet: WorkspaceChangeSet, options?: { request?: WorkspaceRestoreRequest }): Promise<WorkspaceRestoreResult>;
  finalizeActiveChangeSet(): Promise<WorkspaceChangeSet>;
  getWorkspaceChangeSummary(): WorkspaceChangeSummary;
  getActiveChangeSet(): WorkspaceChangeSet;
}

export function createWorkspaceManager(options: WorkspaceManagerOptions): WorkspaceManager {
  let activeChangeSet: WorkspaceChangeSet = createOpenChangeSet({
    workspace: options.workspace,
    now: options.now,
    createId: options.createId,
    sessionId: options.sessionId,
    runId: options.runId,
    toolCallId: options.toolCallId,
    toolExecutionId: options.toolExecutionId,
  });

  const assertAuthorized = (): void => {
    if (options.rootAuthorization && !options.rootAuthorization.authorized) {
      throw new Error('Workspace root is not authorized.');
    }
  };

  const createRestoreRequest = (input: { checkpoint: WorkspaceCheckpoint; requestedBy: WorkspaceRestoreRequest['requestedBy'] }): WorkspaceRestoreRequest => ({
    id: options.createId('workspace-restore-request', `${String(options.workspace.id)}-0`),
    workspaceId: options.workspace.id,
    checkpointId: input.checkpoint.id,
    changeSetId: input.checkpoint.changeSetId,
    requestedBy: input.requestedBy,
    status: 'pending',
    createdAt: options.now(),
  });

  const createCheckpointForChangeSet = (changeSet: WorkspaceChangeSet): WorkspaceCheckpoint => {
    const timestamp = options.now();
    return {
      id: options.createId('workspace-checkpoint', String(changeSet.id)),
      workspaceId: changeSet.workspaceId,
      ...(changeSet.runId ? { runId: changeSet.runId } : {}),
      changeSetId: changeSet.id,
      label: `Before ${changeSet.toolCallId ?? 'workspace change set'}`,
      status: 'created',
      snapshots: changeSet.changes.map((change) => change.before),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  };

  const capture = async (path: WorkspacePath): Promise<WorkspaceFileSnapshot> => {
    const capturedAt = options.now();
    if (!(await options.fileHost.fileExists(path))) {
      return { path, exists: false, capturedAt };
    }
    const content = await options.fileHost.readTextFile(path);
    return {
      path,
      exists: true,
      content,
      hash: hashContent(content),
      size: content.length,
      capturedAt,
    };
  };

  const recordChange = (change: Omit<WorkspaceChangedFile, 'id' | 'changeSetId' | 'restoreState'>): WorkspaceChangedFile => {
    const recorded: WorkspaceChangedFile = {
      id: options.createId('workspace-changed-file', `${String(options.workspace.id)}-${activeChangeSet.changes.length}`),
      changeSetId: activeChangeSet.id,
      restoreState: 'not_restored',
      ...change,
    };
    activeChangeSet.changes.push(recorded);
    activeChangeSet.updatedAt = recorded.createdAt;
    return recorded;
  };

  return {
    workspace: options.workspace,

    async readFile(path) {
      assertAuthorized();
      return options.fileHost.readTextFile(normalizeWorkspacePath(path));
    },

    async listDirectory(path) {
      assertAuthorized();
      return options.fileHost.listDirectory(normalizeWorkspacePath(path));
    },

    async statFile(path) {
      assertAuthorized();
      const normalized = normalizeWorkspacePath(path);
      if (options.fileHost.statFile) {
        return options.fileHost.statFile(normalized);
      }
      const exists = await options.fileHost.fileExists(normalized);
      if (!exists) {
        return { path: normalized, exists: false };
      }
      const content = await options.fileHost.readTextFile(normalized);
      return { path: normalized, exists: true, hash: hashContent(content), size: content.length };
    },

    async glob(pattern) {
      assertAuthorized();
      if (!options.fileHost.glob) {
        return [];
      }
      return options.fileHost.glob(normalizeWorkspacePath(pattern));
    },

    async searchText(input) {
      assertAuthorized();
      if (!options.fileHost.searchText) {
        return [];
      }
      return options.fileHost.searchText({ pattern: normalizeWorkspacePath(input.pattern), query: input.query });
    },

    beginChangeSet(input) {
      activeChangeSet = createOpenChangeSet({
        workspace: options.workspace,
        now: options.now,
        createId: options.createId,
        sessionId: input.sessionId,
        runId: input.runId,
        toolCallId: input.toolCallId,
        toolExecutionId: input.toolExecutionId,
      });
      return cloneChangeSet(activeChangeSet);
    },

    async writeFile(input) {
      assertAuthorized();
      const path = normalizeWorkspacePath(input.path);
      const before = await capture(path);
      await options.fileHost.writeTextFile(path, input.content);
      const after = await capture(path);
      return recordChange({ path, operation: 'write', before, after, createdAt: options.now() });
    },

    async editFile(input) {
      assertAuthorized();
      const path = normalizeWorkspacePath(input.path);
      const before = await capture(path);
      if (!before.exists || before.content === undefined) {
        throw new Error(`Cannot edit missing file: ${path}`);
      }
      if (!before.content.includes(input.oldText)) {
        throw new Error(`Edit target text was not found in ${path}.`);
      }
      const nextContent = before.content.replace(input.oldText, input.newText);
      await options.fileHost.writeTextFile(path, nextContent);
      const after = await capture(path);
      return recordChange({ path, operation: 'edit', before, after, createdAt: options.now() });
    },

    async deleteFile(pathInput) {
      assertAuthorized();
      const path = normalizeWorkspacePath(pathInput);
      const before = await capture(path);
      await options.fileHost.deleteFile(path);
      const after = await capture(path);
      return recordChange({ path, operation: 'delete', before, after, createdAt: options.now() });
    },

    async createCheckpoint(input) {
      assertAuthorized();
      const timestamp = options.now();
      return {
        id: options.createId('workspace-checkpoint', `${String(options.workspace.id)}-${activeChangeSet.changes.length}`),
        workspaceId: options.workspace.id,
        changeSetId: activeChangeSet.id,
        label: input.label,
        status: 'created',
        snapshots: await Promise.all(input.paths.map((path) => capture(normalizeWorkspacePath(path)))),
        createdAt: timestamp,
        updatedAt: timestamp,
      };
    },

    invalidateCheckpoint(checkpoint, reason) {
      return { ...checkpoint, status: 'invalidated', updatedAt: options.now(), metadata: { ...(checkpoint.metadata ?? {}), reason } };
    },

    discardCheckpoint(checkpoint, reason) {
      return { ...checkpoint, status: 'discarded', updatedAt: options.now(), metadata: { ...(checkpoint.metadata ?? {}), reason } };
    },

    createRestoreRequest(input) {
      return createRestoreRequest(input);
    },

    async restoreCheckpoint(checkpoint, restoreOptions = {}) {
      assertAuthorized();
      if (checkpoint.status !== 'created') {
        throw new Error('Checkpoint cannot be restored.');
      }
      const request = restoreOptions.request ?? createRestoreRequest({ checkpoint, requestedBy: 'system' });
      const resultId = options.createId('workspace-restore-result', `${String(options.workspace.id)}-0`);
      const fileResults: WorkspaceRestoreFileResult[] = [];

      for (const [index, snapshot] of checkpoint.snapshots.entries()) {
        const before = await capture(snapshot.path);
        const latestChange = [...activeChangeSet.changes].reverse().find((change) => change.path === snapshot.path);
        if (latestChange?.after.exists && before.exists && latestChange.after.content !== before.content) {
          for (const change of activeChangeSet.changes) {
            if (change.path === snapshot.path) {
              change.restoreState = 'conflicted';
            }
          }
          fileResults.push({
            id: options.createId('workspace-restore-file-result', `${String(options.workspace.id)}-0-${index}`),
            restoreResultId: resultId,
            path: snapshot.path,
            status: 'conflict',
            conflictReason: 'file_changed_since_checkpoint',
            beforeRestore: before,
            afterRestore: before,
          });
          continue;
        }

        if (snapshot.exists) {
          await options.fileHost.writeTextFile(snapshot.path, snapshot.content ?? '');
        } else {
          await options.fileHost.deleteFile(snapshot.path);
        }

        const after = await capture(snapshot.path);
        const restoreChange = recordChange({ path: snapshot.path, operation: 'restore', before, after, createdAt: options.now() });
        for (const change of activeChangeSet.changes) {
          if (change.id !== restoreChange.id && change.path === snapshot.path) {
            change.restoreState = 'restored';
          }
        }
        fileResults.push({
          id: options.createId('workspace-restore-file-result', `${String(options.workspace.id)}-0-${index}`),
          restoreResultId: resultId,
          path: snapshot.path,
          status: snapshot.exists ? 'restored' : 'removed',
          beforeRestore: before,
          afterRestore: after,
        });
      }

      const failedCount = fileResults.filter((result) => result.status === 'conflict' || result.status === 'failed').length;
      return {
        id: resultId,
        requestId: request.id,
        checkpointId: checkpoint.id,
        workspaceId: checkpoint.workspaceId,
        status: failedCount > 0 ? 'conflicted' : 'completed',
        restoredCount: fileResults.length - failedCount,
        failedCount,
        fileResults,
        restoredFiles: checkpoint.snapshots,
        createdAt: request.createdAt,
        completedAt: options.now(),
      };
    },

    createRestoreRequestForChangeSet(input) {
      const checkpoint = createCheckpointForChangeSet(input.changeSet);
      const request = createRestoreRequest({ checkpoint, requestedBy: input.requestedBy });
      void options.repository?.saveCheckpoint(checkpoint);
      void options.repository?.saveRestoreRequest(request);
      return request;
    },

    async restoreChangeSet(changeSet, restoreOptions = {}) {
      assertAuthorized();
      const checkpoint = createCheckpointForChangeSet(changeSet);
      const request = restoreOptions.request ?? createRestoreRequest({ checkpoint, requestedBy: 'system' });
      await options.repository?.saveCheckpoint(checkpoint);
      await options.repository?.saveRestoreRequest(request);
      const resultId = options.createId('workspace-restore-result', String(changeSet.id));
      const fileResults: WorkspaceRestoreFileResult[] = [];

      for (const [index, change] of changeSet.changes.entries()) {
        const beforeRestore = await capture(change.path);
        const changedSinceMutation = change.after.exists
          && beforeRestore.exists
          && change.after.content !== beforeRestore.content;

        if (changedSinceMutation) {
          change.restoreState = 'conflicted';
          await options.repository?.updateChangedFileRestoreState({
            changedFileId: String(change.id),
            restoreState: 'conflicted',
          });
          fileResults.push({
            id: options.createId('workspace-restore-file-result', `${String(changeSet.id)}-${index}`),
            restoreResultId: resultId,
            path: change.path,
            status: 'conflict',
            conflictReason: 'file_changed_since_change_set',
            beforeRestore,
            afterRestore: beforeRestore,
          });
          continue;
        }

        if (change.before.exists) {
          await options.fileHost.writeTextFile(change.path, change.before.content ?? '');
        } else {
          await options.fileHost.deleteFile(change.path);
        }
        const afterRestore = await capture(change.path);
        change.restoreState = 'restored';
        await options.repository?.updateChangedFileRestoreState({
          changedFileId: String(change.id),
          restoreState: 'restored',
        });
        fileResults.push({
          id: options.createId('workspace-restore-file-result', `${String(changeSet.id)}-${index}`),
          restoreResultId: resultId,
          path: change.path,
          status: change.before.exists ? 'restored' : 'removed',
          beforeRestore,
          afterRestore,
        });
      }

      const failedCount = fileResults.filter((result) => result.status === 'conflict' || result.status === 'failed').length;
      const result: WorkspaceRestoreResult = {
        id: resultId,
        requestId: request.id,
        checkpointId: checkpoint.id,
        workspaceId: changeSet.workspaceId,
        status: failedCount > 0 ? 'conflicted' : 'completed',
        restoredCount: fileResults.length - failedCount,
        failedCount,
        fileResults,
        restoredFiles: changeSet.changes.map((change) => change.before),
        createdAt: request.createdAt,
        completedAt: options.now(),
      };
      await options.repository?.saveRestoreResult(result);
      return result;
    },

    async finalizeActiveChangeSet() {
      activeChangeSet.status = 'finalized';
      activeChangeSet.finalizedAt = options.now();
      activeChangeSet.updatedAt = activeChangeSet.finalizedAt;
      const finalized = cloneChangeSet(activeChangeSet);
      await options.repository?.saveChangeSet(finalized);
      return finalized;
    },

    getWorkspaceChangeSummary() {
      return {
        workspaceId: activeChangeSet.workspaceId,
        ...(activeChangeSet.sessionId ? { sessionId: activeChangeSet.sessionId } : {}),
        changeSetId: activeChangeSet.id,
        changedFileCount: activeChangeSet.changes.length,
        operations: [...new Set(activeChangeSet.changes.map((change) => change.operation))],
        paths: activeChangeSet.changes.map((change) => change.path),
      };
    },

    getActiveChangeSet() {
      return cloneChangeSet(activeChangeSet);
    },
  };
}

function createOpenChangeSet(input: {
  workspace: Workspace;
  now: () => string;
  createId: (prefix: string, value: string) => string;
  sessionId?: string;
  runId?: string;
  toolCallId?: string;
  toolExecutionId?: string;
}): WorkspaceChangeSet {
  const seed = [
    String(input.workspace.id),
    input.runId,
    input.toolCallId,
    input.toolExecutionId,
    input.now(),
  ].filter(Boolean).join('-');
  return {
    id: input.createId('workspace-change-set', seed),
    workspaceId: input.workspace.id,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.runId ? { runId: input.runId } : {}),
    ...(input.toolCallId ? { toolCallId: input.toolCallId } : {}),
    ...(input.toolExecutionId ? { toolExecutionId: input.toolExecutionId } : {}),
    status: 'open',
    changes: [],
    createdAt: input.now(),
    updatedAt: input.now(),
  };
}

function hashContent(content: string): string {
  let hash = 0;
  for (let index = 0; index < content.length; index += 1) {
    hash = (hash * 31 + content.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16);
}

function cloneChangeSet(changeSet: WorkspaceChangeSet): WorkspaceChangeSet {
  return {
    ...changeSet,
    changes: changeSet.changes.map((change) => ({ ...change })),
  };
}
