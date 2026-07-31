/*
 * UI-safe Workspace change footer projection. It consumes Workspace change
 * facts and exposes file paths/kinds only, without restore or snapshot fields.
 */
import { z } from 'zod';
import type {
  WorkspaceChangeSummary,
  WorkspaceChanges,
} from '@megumi/workspace';

export type WorkspaceChangeFooterFile = {
  changedFileId: string;
  workspacePath?: string;
  projectPath?: string;
  changeKind: string;
  restoreState?: string;
};

export type WorkspaceChangeFooterChangeSet = {
  changeSetId: string;
  changedFileCount: number;
  files: WorkspaceChangeFooterFile[];
  restorableCount?: number;
  restoredCount?: number;
  conflictCount?: number;
  failedCount?: number;
  hasRestorableChanges?: boolean;
};

export type WorkspaceChangeFooterFact = {
  runId: string;
  sessionId: string;
  updatedAt: string;
  changeSets: WorkspaceChangeFooterChangeSet[];
};

export const WorkspaceChangeFooterFactSchema = z.object({
  runId: z.string().min(1),
  sessionId: z.string().min(1),
  updatedAt: z.string().min(1),
  changeSets: z.array(z.object({
    changeSetId: z.string().min(1),
    changedFileCount: z.number().int().nonnegative(),
    files: z.array(z.object({
      changedFileId: z.string().min(1),
      workspacePath: z.string().min(1).optional(),
      projectPath: z.string().min(1).optional(),
      changeKind: z.string().min(1),
      restoreState: z.string().optional(),
    }).passthrough()),
    restorableCount: z.number().int().nonnegative().optional(),
    restoredCount: z.number().int().nonnegative().optional(),
    conflictCount: z.number().int().nonnegative().optional(),
    failedCount: z.number().int().nonnegative().optional(),
    hasRestorableChanges: z.boolean().optional(),
  }).passthrough()),
}).strict() satisfies z.ZodType<WorkspaceChangeFooterFact>;

export interface WorkspaceChangeFooterSource {
  listChangeSummaries: Pick<WorkspaceChanges, 'listChangeSummaries'>['listChangeSummaries'];
}

export interface WorkspaceChangeFooterProjector {
  project(request: ProjectWorkspaceChangeFooterRequest): WorkspaceChangeFooterFact | undefined;
}

export interface ProjectWorkspaceChangeFooterRequest {
  readonly runId: string;
}

export interface CreateWorkspaceChangeFooterProjectorOptions {
  workspaceChanges: WorkspaceChangeFooterSource;
}

export function createWorkspaceChangeFooterProjector(
  options: CreateWorkspaceChangeFooterProjectorOptions,
): WorkspaceChangeFooterProjector {
  return {
    project(request) {
      let changeSets: ProjectedChangeSet[];
      try {
        changeSets = options.workspaceChanges
          .listChangeSummaries({ by: 'run', run_id: request.runId }).summaries
          .filter((summary) => summary.change_set.changed_file_count > 0)
          .map(projectChangeSet)
          .filter((changeSet): changeSet is ProjectedChangeSet => Boolean(changeSet));
      } catch {
        // Footer projection is an optional read model and cannot fail its caller.
        return undefined;
      }

      if (changeSets.length === 0) {
        return undefined;
      }

      return {
        runId: request.runId,
        sessionId: changeSets[0].sessionId,
        updatedAt: latestUpdatedAt(changeSets.map((changeSet) => changeSet.updatedAt)),
        changeSets: changeSets.map(({ sessionId: _sessionId, updatedAt: _updatedAt, ...changeSet }) => changeSet),
      };
    },
  };
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
