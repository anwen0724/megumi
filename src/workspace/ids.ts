// Defines workspace-owned branded identifiers for project roots, changes, checkpoints, and restore facts.
import { createId, type EntityId } from '../shared';

export type WorkspaceId = EntityId<'WorkspaceId'>;
export type WorkspaceChangeSetId = EntityId<'WorkspaceChangeSetId'>;
export type WorkspaceChangedFileId = EntityId<'WorkspaceChangedFileId'>;
export type WorkspaceCheckpointId = EntityId<'WorkspaceCheckpointId'>;
export type WorkspaceRestoreRequestId = EntityId<'WorkspaceRestoreRequestId'>;
export type WorkspaceRestoreResultId = EntityId<'WorkspaceRestoreResultId'>;
export type WorkspaceRestoreFileResultId = EntityId<'WorkspaceRestoreFileResultId'>;

export function createWorkspaceId(value: string): WorkspaceId {
  return createId<'WorkspaceId'>('workspace', value);
}

export function createWorkspaceChangeSetId(value: string): WorkspaceChangeSetId {
  return createId<'WorkspaceChangeSetId'>('workspace-change-set', value);
}

export function createWorkspaceChangedFileId(value: string): WorkspaceChangedFileId {
  return createId<'WorkspaceChangedFileId'>('workspace-changed-file', value);
}

export function createWorkspaceCheckpointId(value: string): WorkspaceCheckpointId {
  return createId<'WorkspaceCheckpointId'>('workspace-checkpoint', value);
}

export function createWorkspaceRestoreRequestId(value: string): WorkspaceRestoreRequestId {
  return createId<'WorkspaceRestoreRequestId'>('workspace-restore-request', value);
}

export function createWorkspaceRestoreResultId(value: string): WorkspaceRestoreResultId {
  return createId<'WorkspaceRestoreResultId'>('workspace-restore-result', value);
}

export function createWorkspaceRestoreFileResultId(value: string): WorkspaceRestoreFileResultId {
  return createId<'WorkspaceRestoreFileResultId'>('workspace-restore-file-result', value);
}
