// Defines read access to persisted workspace change records for product services.
import type {
  WorkspaceChangedFile,
  WorkspaceChangeSet,
  WorkspaceChangeSummary,
} from '@megumi/shared/workspace';

export interface WorkspaceChangeReadPort {
  listChangedFilesByRun(runId: string): WorkspaceChangedFile[];
  listChangeSetsByRun?(runId: string): WorkspaceChangeSet[];
  getChangeSummary?(changeSetId: string): WorkspaceChangeSummary | undefined;
  listChangedFilesByChangeSet?(changeSetId: string): WorkspaceChangedFile[];
}
