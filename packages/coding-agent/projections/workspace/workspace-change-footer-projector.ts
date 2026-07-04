/*
 * UI-safe Workspace change footer projection. It consumes Workspace change
 * facts and exposes file paths/kinds only, without restore or snapshot fields.
 */
import type {
  WorkspaceChangeSummary,
  WorkspaceChangeService,
} from '../../workspace';

export type WorkspaceChangeFooterFile = {
  changedFileId: string;
  workspacePath: string;
  changeKind: string;
};

export type WorkspaceChangeFooterChangeSet = {
  changeSetId: string;
  changedFileCount: number;
  files: WorkspaceChangeFooterFile[];
};

export type WorkspaceChangeFooterFact = {
  runId: string;
  sessionId: string;
  updatedAt: string;
  changeSets: WorkspaceChangeFooterChangeSet[];
};

export interface WorkspaceChangeFooterProjectorWorkspaceChangePort {
  listChangeSummaries: Pick<WorkspaceChangeService, 'listChangeSummaries'>['listChangeSummaries'];
}

export interface WorkspaceChangeFooterProjectorService {
  projectRunFooter(run_id: string): WorkspaceChangeFooterFact | undefined;
}

export interface CreateWorkspaceChangeFooterProjectorServiceOptions {
  workspaceChanges: WorkspaceChangeFooterProjectorWorkspaceChangePort;
}

export function createWorkspaceChangeFooterProjectorService(
  options: CreateWorkspaceChangeFooterProjectorServiceOptions,
): WorkspaceChangeFooterProjectorService {
  return {
    projectRunFooter(run_id) {
      const changeSets = options.workspaceChanges
        .listChangeSummaries({ by: 'run', run_id }).summaries
        .filter((summary) => summary.change_set.status === 'finalized' && summary.change_set.changed_file_count > 0)
        .map(projectChangeSet)
        .filter((changeSet): changeSet is ProjectedChangeSet => Boolean(changeSet));

      if (changeSets.length === 0) {
        return undefined;
      }

      return {
        runId: run_id,
        sessionId: changeSets[0].sessionId,
        updatedAt: latestUpdatedAt(changeSets.map((changeSet) => changeSet.updatedAt)),
        changeSets: changeSets.map(({ sessionId: _sessionId, updatedAt: _updatedAt, ...changeSet }) => changeSet),
      };
    },
  };
}

export function isWorkspaceChangeFooterProjectorPort(
  value: unknown,
): value is WorkspaceChangeFooterProjectorWorkspaceChangePort {
  return typeof value === 'object'
    && value !== null
    && 'listChangeSummaries' in value;
}

type ProjectedChangeSet = WorkspaceChangeFooterChangeSet & {
  sessionId: string;
  updatedAt: string;
};

function projectChangeSet(summary: WorkspaceChangeSummary): ProjectedChangeSet | undefined {
  if (!summary || summary.files.length === 0) {
    return undefined;
  }

  return {
    changeSetId: summary.change_set.change_set_id,
    changedFileCount: summary.files.length,
    files: summary.files.map((file) => ({
      changedFileId: file.changed_file_id,
      workspacePath: file.workspace_path,
      changeKind: file.change_kind,
    })),
    sessionId: summary.change_set.session_id,
    updatedAt: summary.change_set.finalized_at ?? summary.change_set.created_at,
  };
}

function latestUpdatedAt(values: string[]): string {
  return values.reduce((latest, value) => value > latest ? value : latest, values[0] ?? new Date(0).toISOString());
}
