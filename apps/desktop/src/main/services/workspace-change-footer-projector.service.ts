import type {
  WorkspaceChangedFile,
  WorkspaceChangeFooterFact,
  WorkspaceChangeSet,
  WorkspaceChangeSummary,
} from '@megumi/shared/workspace-change-contracts';

export interface WorkspaceChangeFooterProjectorWorkspaceChangePort {
  listChangeSetsByRun(runId: string): WorkspaceChangeSet[];
  getChangeSummary(changeSetId: string): WorkspaceChangeSummary | undefined;
  listChangedFilesByChangeSet(changeSetId: string): WorkspaceChangedFile[];
}

export interface WorkspaceChangeFooterProjectorService {
  projectRunFooter(runId: string): WorkspaceChangeFooterFact | undefined;
}

export interface CreateWorkspaceChangeFooterProjectorServiceOptions {
  workspaceChanges: WorkspaceChangeFooterProjectorWorkspaceChangePort;
}

export function createWorkspaceChangeFooterProjectorService(
  options: CreateWorkspaceChangeFooterProjectorServiceOptions,
): WorkspaceChangeFooterProjectorService {
  return {
    projectRunFooter(runId) {
      const changeSets = options.workspaceChanges
        .listChangeSetsByRun(runId)
        .filter((changeSet) => changeSet.status === 'finalized' && changeSet.changedFileCount > 0)
        .map((changeSet) => {
          const summary = options.workspaceChanges.getChangeSummary(changeSet.changeSetId);
          if (!summary || summary.changedFileCount <= 0) {
            return undefined;
          }

          const files = options.workspaceChanges
            .listChangedFilesByChangeSet(changeSet.changeSetId)
            .map((file) => ({
              changedFileId: file.changedFileId,
              projectPath: file.projectPath,
              changeKind: file.changeKind,
              restoreState: file.restoreState,
            }));

          if (files.length === 0) {
            return undefined;
          }

          return {
            changeSetId: summary.changeSetId,
            changedFileCount: files.length,
            restorableCount: summary.restorableCount,
            restoredCount: summary.restoredCount,
            conflictCount: summary.conflictCount,
            failedCount: summary.failedCount,
            hasRestorableChanges: summary.hasRestorableChanges,
            files,
            sessionId: summary.sessionId,
            runId: summary.runId,
            updatedAt: summary.updatedAt,
          };
        })
        .filter((changeSet): changeSet is NonNullable<typeof changeSet> => Boolean(changeSet));

      if (changeSets.length === 0) {
        return undefined;
      }

      return {
        runId,
        sessionId: changeSets[0].sessionId,
        updatedAt: latestUpdatedAt(changeSets.map((changeSet) => changeSet.updatedAt)),
        changeSets: changeSets.map(({ sessionId: _sessionId, runId: _runId, updatedAt: _updatedAt, ...changeSet }) => changeSet),
      };
    },
  };
}

function latestUpdatedAt(values: string[]): string {
  return values.reduce((latest, value) => value > latest ? value : latest, values[0] ?? new Date(0).toISOString());
}

export function isWorkspaceChangeFooterProjectorPort(
  value: unknown,
): value is WorkspaceChangeFooterProjectorWorkspaceChangePort {
  return typeof value === 'object'
    && value !== null
    && 'listChangeSetsByRun' in value
    && 'getChangeSummary' in value
    && 'listChangedFilesByChangeSet' in value;
}
