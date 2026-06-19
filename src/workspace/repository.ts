// Defines workspace persistence ports for future database adapters without letting persistence own workspace rules.
import type {
  Workspace,
  WorkspaceChangedFile,
  WorkspaceChangeSet,
  WorkspaceCheckpoint,
  WorkspaceRestoreRequest,
  WorkspaceRestoreResult,
} from './types';

export interface WorkspaceRepository {
  saveWorkspace(workspace: Workspace): Promise<void>;
  getWorkspace(id: string): Promise<Workspace | undefined>;
  saveChangeSet(changeSet: WorkspaceChangeSet): Promise<void>;
  getChangeSet(id: string): Promise<WorkspaceChangeSet | undefined>;
  listChangeSets(input: { workspaceId?: string; runId?: string; sessionId?: string }): Promise<WorkspaceChangeSet[]>;
  saveChangedFile(changedFile: WorkspaceChangedFile): Promise<void>;
  listChangedFiles(changeSetId: string): Promise<WorkspaceChangedFile[]>;
  saveCheckpoint(checkpoint: WorkspaceCheckpoint): Promise<void>;
  getCheckpoint(id: string): Promise<WorkspaceCheckpoint | undefined>;
  saveRestoreRequest(request: WorkspaceRestoreRequest): Promise<void>;
  getRestoreRequest(id: string): Promise<WorkspaceRestoreRequest | undefined>;
  saveRestoreResult(result: WorkspaceRestoreResult): Promise<void>;
  getRestoreResult(id: string): Promise<WorkspaceRestoreResult | undefined>;
  updateChangedFileRestoreState(input: { changedFileId: string; restoreState: WorkspaceChangedFile['restoreState'] }): Promise<void>;
  listRestoreResults(input: { changeSetId?: string; workspaceId?: string }): Promise<WorkspaceRestoreResult[]>;
}

export function createInMemoryWorkspaceRepository(): WorkspaceRepository {
  const workspaces = new Map<string, Workspace>();
  const changeSets = new Map<string, WorkspaceChangeSet>();
  const changedFiles = new Map<string, WorkspaceChangedFile[]>();
  const checkpoints = new Map<string, WorkspaceCheckpoint>();
  const restoreRequests = new Map<string, WorkspaceRestoreRequest>();
  const restoreResults = new Map<string, WorkspaceRestoreResult>();

  const hydrateChangeSet = (changeSet: WorkspaceChangeSet): WorkspaceChangeSet => ({
    ...changeSet,
    changes: [...(changedFiles.get(String(changeSet.id)) ?? changeSet.changes)],
  });

  return {
    async saveWorkspace(workspace) {
      workspaces.set(String(workspace.id), workspace);
    },
    async getWorkspace(id) {
      return workspaces.get(id);
    },
    async saveChangeSet(changeSet) {
      changeSets.set(String(changeSet.id), { ...changeSet, changes: [...changeSet.changes] });
      if (changeSet.changes.length > 0) {
        changedFiles.set(String(changeSet.id), [...changeSet.changes]);
      }
    },
    async getChangeSet(id) {
      const changeSet = changeSets.get(id);
      return changeSet ? hydrateChangeSet(changeSet) : undefined;
    },
    async listChangeSets(input) {
      return [...changeSets.values()]
        .filter((changeSet) =>
          (input.workspaceId === undefined || String(changeSet.workspaceId) === input.workspaceId)
          && (input.runId === undefined || changeSet.runId === input.runId)
          && (input.sessionId === undefined || changeSet.sessionId === input.sessionId),
        )
        .map(hydrateChangeSet);
    },
    async saveChangedFile(changedFile) {
      const key = String(changedFile.changeSetId);
      changedFiles.set(key, [...(changedFiles.get(key) ?? []), changedFile]);
    },
    async listChangedFiles(changeSetId) {
      return [...(changedFiles.get(changeSetId) ?? [])];
    },
    async saveCheckpoint(checkpoint) {
      checkpoints.set(String(checkpoint.id), checkpoint);
    },
    async getCheckpoint(id) {
      return checkpoints.get(id);
    },
    async saveRestoreRequest(request) {
      restoreRequests.set(String(request.id), request);
    },
    async getRestoreRequest(id) {
      return restoreRequests.get(id);
    },
    async saveRestoreResult(result) {
      restoreResults.set(String(result.id), result);
    },
    async getRestoreResult(id) {
      return restoreResults.get(id);
    },
    async updateChangedFileRestoreState(input) {
      for (const [changeSetId, files] of changedFiles.entries()) {
        changedFiles.set(changeSetId, files.map((file) =>
          String(file.id) === input.changedFileId ? { ...file, restoreState: input.restoreState } : file,
        ));
      }
      for (const [changeSetId, changeSet] of changeSets.entries()) {
        changeSets.set(changeSetId, {
          ...changeSet,
          changes: changeSet.changes.map((file) =>
            String(file.id) === input.changedFileId ? { ...file, restoreState: input.restoreState } : file,
          ),
        });
      }
    },
    async listRestoreResults(input) {
      return [...restoreResults.values()].filter((result) => {
        const request = restoreRequests.get(String(result.requestId));
        return (input.workspaceId === undefined || String(result.workspaceId) === input.workspaceId)
          && (input.changeSetId === undefined || String(request?.changeSetId) === input.changeSetId);
      });
    },
  };
}
