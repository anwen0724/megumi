/*
 * Public Workspace change service. It observes successful managed file
 * mutations and stores changed-file facts without snapshots, restore state, or
 * file content.
 */
import { randomUUID } from 'node:crypto';
import type {
  FinalizeWorkspaceChangeSetRequest,
  FinalizeWorkspaceChangeSetResult,
  GetWorkspaceChangeSummaryRequest,
  GetWorkspaceChangeSummaryResult,
  ListWorkspaceChangedFilesRequest,
  ListWorkspaceChangedFilesResult,
  TrackWorkspaceToolExecutionRequest,
  WorkspaceChangedFile,
  WorkspaceChangeSet,
  WorkspaceChangeService,
} from '../contracts/workspace-change-contracts';
import type { WorkspacePathPolicyService } from '../contracts/workspace-contracts';
import { getManagedWorkspaceMutation, resolveChangeKind } from '../core/workspace-change-tracking';
import type { WorkspaceChangeRepository } from '../repositories/workspace-change-repository';

type WorkspaceChangeFileSystemPort = {
  exists(path: string): Promise<boolean>;
};

export interface CreateWorkspaceChangeServiceOptions {
  repository: Pick<
    WorkspaceChangeRepository,
    | 'insertChangeSet'
    | 'findOpenChangeSet'
    | 'listChangeSetsByRunId'
    | 'finalizeChangeSet'
    | 'insertOrUpdateChangedFile'
    | 'listChangedFilesByChangeSetId'
    | 'listChangedFilesByRunId'
    | 'getChangeSummary'
  >;
  path_policy: WorkspacePathPolicyService;
  file_system: WorkspaceChangeFileSystemPort;
  ids?: {
    change_set_id?: () => string;
    changed_file_id?: () => string;
  };
  now?: () => string;
}

export function createWorkspaceChangeService(options: CreateWorkspaceChangeServiceOptions): WorkspaceChangeService {
  const now = options.now ?? (() => new Date().toISOString());
  const changeSetId = options.ids?.change_set_id ?? (() => `workspace-change-set:${randomUUID()}`);
  const changedFileId = options.ids?.changed_file_id ?? (() => `workspace-changed-file:${randomUUID()}`);

  return {
    async trackToolExecution<T>(request: TrackWorkspaceToolExecutionRequest<T>): Promise<T> {
      if (!request.scope) {
        return request.execute();
      }

      const mutation = getManagedWorkspaceMutation(request.tool_execution);
      if (mutation.status === 'unmanaged') {
        return request.execute();
      }

      const resolved = options.path_policy.assertOrdinaryPath({
        workspace_root: request.tool_execution.workspace_root,
        target_path: mutation.workspace_path_input,
      });
      if (resolved.status === 'rejected') {
        return request.execute();
      }

      const existedBefore = await options.file_system.exists(resolved.absolute_path);
      const result = await request.execute();
      const existsAfter = await options.file_system.exists(resolved.absolute_path);
      const changeKind = resolveChangeKind({
        mutation_kind: mutation.mutation_kind,
        existed_before: existedBefore,
        exists_after: existsAfter,
      });
      if (!changeKind) {
        return result;
      }

      const changeSet = getOrCreateOpenChangeSet({
        repository: options.repository,
        now,
        changeSetId,
        workspace_id: request.scope.workspace_id,
        session_id: request.scope.session_id,
        run_id: request.scope.run_id,
      });
      if (!changeSet) {
        return result;
      }

      options.repository.insertOrUpdateChangedFile({
        changed_file_id: changedFileId(),
        change_set_id: changeSet.change_set_id,
        workspace_path: resolved.workspace_path,
        change_kind: changeKind,
        created_at: now(),
      });
      return result;
    },

    finalizeChangeSet(request: FinalizeWorkspaceChangeSetRequest): FinalizeWorkspaceChangeSetResult {
      const open = options.repository.findOpenChangeSet({
        workspace_id: request.workspace_id,
        session_id: request.session_id,
        run_id: request.run_id,
      });
      if (!open) {
        return { status: 'not_found' };
      }

      const finalized = options.repository.finalizeChangeSet({
        change_set_id: open.change_set_id,
        finalized_at: request.finalized_at,
      });
      return finalized
        ? { status: 'finalized', change_set: finalized }
        : { status: 'not_found' };
    },

    getChangeSummary(request: GetWorkspaceChangeSummaryRequest): GetWorkspaceChangeSummaryResult {
      const summary = options.repository.getChangeSummary(request.change_set_id);
      return summary
        ? { status: 'found', summary }
        : { status: 'not_found', change_set_id: request.change_set_id };
    },

    listChangedFiles(request: ListWorkspaceChangedFilesRequest): ListWorkspaceChangedFilesResult {
      return {
        files: request.by === 'change_set'
          ? options.repository.listChangedFilesByChangeSetId(request.change_set_id)
          : options.repository.listChangedFilesByRunId(request.run_id),
      };
    },
  };
}

function getOrCreateOpenChangeSet(input: {
  repository: CreateWorkspaceChangeServiceOptions['repository'];
  now: () => string;
  changeSetId: () => string;
  workspace_id: string;
  session_id: string;
  run_id: string;
}): WorkspaceChangeSet | undefined {
  const open = input.repository.findOpenChangeSet({
    workspace_id: input.workspace_id,
    session_id: input.session_id,
    run_id: input.run_id,
  });
  if (open) {
    return open;
  }

  const finalized = input.repository.listChangeSetsByRunId(input.run_id)
    .some((change_set) => change_set.workspace_id === input.workspace_id
      && change_set.session_id === input.session_id
      && change_set.status === 'finalized');
  if (finalized) {
    return undefined;
  }

  return input.repository.insertChangeSet(createOpenChangeSet({
    change_set_id: input.changeSetId(),
    workspace_id: input.workspace_id,
    session_id: input.session_id,
    run_id: input.run_id,
    created_at: input.now(),
  }));
}

function createOpenChangeSet(input: {
  change_set_id: string;
  workspace_id: string;
  session_id: string;
  run_id: string;
  created_at: string;
}): WorkspaceChangeSet {
  return {
    change_set_id: input.change_set_id,
    workspace_id: input.workspace_id,
    session_id: input.session_id,
    run_id: input.run_id,
    status: 'open',
    changed_file_count: 0,
    created_at: input.created_at,
  };
}
