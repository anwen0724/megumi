/*
 * Tracks successful managed file mutations as fingerprint-derived Workspace facts.
 */
import { randomUUID } from 'node:crypto';
import type { WorkspacePathPolicy } from './workspace-path-policy';
import type { WorkspaceStore } from './workspace-store';

export type WorkspaceChangeSetStatus = 'open' | 'finalized';
export type WorkspaceChangeKind = 'created' | 'modified' | 'deleted';
export interface WorkspaceChangeSet {
  change_set_id: string;
  workspace_id: string;
  session_id: string;
  run_id: string;
  status: WorkspaceChangeSetStatus;
  changed_file_count: number;
  created_at: string;
  finalized_at?: string;
}
export interface WorkspaceChangedFile {
  changed_file_id: string;
  change_set_id: string;
  workspace_path: string;
  change_kind: WorkspaceChangeKind;
  created_at: string;
}
export interface WorkspaceChangeSummary {
  change_set: WorkspaceChangeSet;
  files: WorkspaceChangedFile[];
}
export interface WorkspaceChangeExecutionScope {
  workspace_id: string;
  session_id: string;
  run_id: string;
  step_id?: string;
  tool_call_id?: string;
  tool_execution_id?: string;
}
export interface WorkspaceToolExecution {
  tool_name: string;
  input: unknown;
  workspace_root: string;
}
export interface TrackWorkspaceToolExecutionRequest<T> {
  scope?: WorkspaceChangeExecutionScope;
  tool_execution: WorkspaceToolExecution;
  execute: () => Promise<T>;
  is_successful_outcome: (result: T) => boolean;
}
export interface FinalizeWorkspaceChangeSetRequest {
  workspace_id: string;
  session_id: string;
  run_id: string;
  step_id?: string;
  finalized_at: string;
}
export type FinalizeWorkspaceChangeSetResult =
  | { status: 'finalized'; change_set: WorkspaceChangeSet }
  | { status: 'not_found' };
export interface GetWorkspaceChangeSummaryRequest { change_set_id: string }
export type GetWorkspaceChangeSummaryResult =
  | { status: 'found'; summary: WorkspaceChangeSummary }
  | { status: 'not_found'; change_set_id: string };
export type ListWorkspaceChangedFilesRequest =
  | { by: 'change_set'; change_set_id: string }
  | { by: 'run'; run_id: string };
export interface ListWorkspaceChangedFilesResult { files: WorkspaceChangedFile[] }
export interface ListWorkspaceChangeSummariesRequest { by: 'run'; run_id: string }
export interface ListWorkspaceChangeSummariesResult { summaries: WorkspaceChangeSummary[] }

export interface WorkspaceChanges {
  trackToolExecution<T>(request: TrackWorkspaceToolExecutionRequest<T>): Promise<T>;
  finalizeChangeSet(request: FinalizeWorkspaceChangeSetRequest): FinalizeWorkspaceChangeSetResult;
  getChangeSummary(request: GetWorkspaceChangeSummaryRequest): GetWorkspaceChangeSummaryResult;
  listChangedFiles(request: ListWorkspaceChangedFilesRequest): ListWorkspaceChangedFilesResult;
  listChangeSummaries(request: ListWorkspaceChangeSummariesRequest): ListWorkspaceChangeSummariesResult;
}

export type WorkspaceFileFingerprint =
  | { exists: false }
  | {
      exists: true;
      size_bytes: number;
      modified_at_ms: number;
      content_hash: string;
    };

export interface WorkspaceChangeFileSystem {
  realpath(path: string): Promise<string>;
  fingerprint(path: string): Promise<WorkspaceFileFingerprint>;
}

export type WorkspaceChangeDiagnosticPhase =
  | 'resolve_before'
  | 'fingerprint_before'
  | 'outcome_predicate'
  | 'resolve_after'
  | 'fingerprint_after'
  | 'project_change';
export type WorkspaceChangeDiagnosticReason =
  | 'canonical_path_failed'
  | 'fingerprint_failed'
  | 'outcome_predicate_failed'
  | 'store_failed';
export interface WorkspaceChangeDiagnostic {
  phase: WorkspaceChangeDiagnosticPhase;
  reason: WorkspaceChangeDiagnosticReason;
  workspace_id: string;
  session_id: string;
  run_id: string;
  workspace_path?: string;
}

export interface CreateWorkspaceChangesRequest {
  store: Pick<
    WorkspaceStore,
    | 'insertChangeSet'
    | 'findOpenChangeSet'
    | 'listChangeSetsByRunId'
    | 'finalizeChangeSet'
    | 'upsertChangedFile'
    | 'listChangedFilesByChangeSetId'
    | 'listChangedFilesByRunId'
    | 'getChangeSummary'
  >;
  path_policy: WorkspacePathPolicy;
  file_system: WorkspaceChangeFileSystem;
  ids?: {
    change_set_id?: () => string;
    changed_file_id?: () => string;
  };
  now?: () => string;
  platform?: NodeJS.Platform;
  on_diagnostic?: (diagnostic: WorkspaceChangeDiagnostic) => void | Promise<void>;
}

export function createWorkspaceChanges(options: CreateWorkspaceChangesRequest): WorkspaceChanges {
  const now = options.now ?? (() => new Date().toISOString());
  const changeSetId = options.ids?.change_set_id ?? (() => `workspace-change-set:${randomUUID()}`);
  const changedFileId = options.ids?.changed_file_id ?? (() => `workspace-changed-file:${randomUUID()}`);

  const report = async (
    phase: WorkspaceChangeDiagnosticPhase,
    reason: WorkspaceChangeDiagnosticReason,
    scope: WorkspaceChangeExecutionScope,
    workspacePath?: string,
  ) => {
    try {
      await options.on_diagnostic?.({
        phase,
        reason,
        workspace_id: scope.workspace_id,
        session_id: scope.session_id,
        run_id: scope.run_id,
        ...(workspacePath ? { workspace_path: workspacePath } : {}),
      });
    } catch {
      // Diagnostics are observational and cannot rewrite Tool outcomes.
    }
  };

  return {
    async trackToolExecution(request) {
      if (!request.scope) return request.execute();
      const scope = request.scope;
      const mutation = getManagedWorkspaceMutation(request.tool_execution);
      if (mutation.status === 'unmanaged') return request.execute();

      let beforePath;
      try {
        beforePath = await options.path_policy.resolveCanonicalPath({
          workspace_root: request.tool_execution.workspace_root,
          target_path: mutation.workspace_path_input,
          file_system: options.file_system,
          ...(options.platform ? { platform: options.platform } : {}),
        });
      } catch {
        await report('resolve_before', 'canonical_path_failed', scope);
        return request.execute();
      }
      if (beforePath.status !== 'resolved' || beforePath.protected || beforePath.sensitive) {
        return request.execute();
      }

      let before: WorkspaceFileFingerprint;
      try {
        before = await options.file_system.fingerprint(beforePath.absolute_path);
      } catch {
        await report('fingerprint_before', 'fingerprint_failed', scope, beforePath.workspace_path);
        return request.execute();
      }

      const result = await request.execute();
      let successful: boolean;
      try {
        successful = request.is_successful_outcome(result);
      } catch {
        await report('outcome_predicate', 'outcome_predicate_failed', scope, beforePath.workspace_path);
        return result;
      }
      if (!successful) return result;

      let afterPath;
      try {
        afterPath = await options.path_policy.resolveCanonicalPath({
          workspace_root: request.tool_execution.workspace_root,
          target_path: mutation.workspace_path_input,
          file_system: options.file_system,
          ...(options.platform ? { platform: options.platform } : {}),
        });
      } catch {
        await report('resolve_after', 'canonical_path_failed', scope, beforePath.workspace_path);
        return result;
      }
      if (afterPath.status !== 'resolved'
        || afterPath.protected
        || afterPath.sensitive
        || afterPath.workspace_path !== beforePath.workspace_path) {
        return result;
      }

      let after: WorkspaceFileFingerprint;
      try {
        after = await options.file_system.fingerprint(afterPath.absolute_path);
      } catch {
        await report('fingerprint_after', 'fingerprint_failed', scope, afterPath.workspace_path);
        return result;
      }
      const changeKind = resolveChangeKind({ before, after });
      if (!changeKind) return result;

      try {
        const changeSet = getOrCreateOpenChangeSet({
          store: options.store,
          now,
          changeSetId,
          scope,
        });
        if (!changeSet) return result;
        options.store.upsertChangedFile({
          changed_file_id: changedFileId(),
          change_set_id: changeSet.change_set_id,
          workspace_path: afterPath.workspace_path,
          change_kind: changeKind,
          created_at: now(),
        });
      } catch {
        await report('project_change', 'store_failed', scope, beforePath.workspace_path);
      }
      return result;
    },

    finalizeChangeSet(request) {
      const open = options.store.findOpenChangeSet(request);
      if (open) {
        const finalized = options.store.finalizeChangeSet({
          change_set_id: open.change_set_id,
          finalized_at: request.finalized_at,
        });
        return finalized
          ? { status: 'finalized', change_set: finalized }
          : { status: 'not_found' };
      }
      const finalized = options.store.listChangeSetsByRunId(request.run_id)
        .find((changeSet) => changeSet.workspace_id === request.workspace_id
          && changeSet.session_id === request.session_id
          && changeSet.status === 'finalized');
      return finalized
        ? { status: 'finalized', change_set: finalized }
        : { status: 'not_found' };
    },

    getChangeSummary(request) {
      const summary = options.store.getChangeSummary(request.change_set_id);
      return summary
        ? { status: 'found', summary }
        : { status: 'not_found', change_set_id: request.change_set_id };
    },

    listChangedFiles(request) {
      return {
        files: request.by === 'change_set'
          ? options.store.listChangedFilesByChangeSetId(request.change_set_id)
          : options.store.listChangedFilesByRunId(request.run_id),
      };
    },

    listChangeSummaries(request) {
      return {
        summaries: options.store.listChangeSetsByRunId(request.run_id)
          .map((changeSet) => options.store.getChangeSummary(changeSet.change_set_id))
          .filter((summary): summary is WorkspaceChangeSummary => Boolean(summary)),
      };
    },
  };
}

export type ManagedWorkspaceMutation =
  | { status: 'managed'; workspace_path_input: string }
  | { status: 'unmanaged' };

export function getManagedWorkspaceMutation(toolExecution: WorkspaceToolExecution): ManagedWorkspaceMutation {
  if (toolExecution.tool_name !== 'write_file' && toolExecution.tool_name !== 'edit_file') {
    return { status: 'unmanaged' };
  }
  if (!toolExecution.input || typeof toolExecution.input !== 'object' || Array.isArray(toolExecution.input)) {
    return { status: 'unmanaged' };
  }
  const pathInput = (toolExecution.input as Record<string, unknown>).path;
  return typeof pathInput === 'string'
    ? { status: 'managed', workspace_path_input: pathInput }
    : { status: 'unmanaged' };
}

export function resolveChangeKind(input: {
  before: WorkspaceFileFingerprint;
  after: WorkspaceFileFingerprint;
}): WorkspaceChangeKind | undefined {
  if (!input.before.exists && input.after.exists) return 'created';
  if (input.before.exists && !input.after.exists) return 'deleted';
  if (!input.before.exists || !input.after.exists) return undefined;
  // mtime may change when a Tool rewrites identical bytes. The content hash is
  // the decisive no-op boundary; size and mtime remain useful fingerprint facts.
  return input.before.size_bytes !== input.after.size_bytes
    || input.before.content_hash !== input.after.content_hash
    ? 'modified'
    : undefined;
}

function getOrCreateOpenChangeSet(input: {
  store: CreateWorkspaceChangesRequest['store'];
  now: () => string;
  changeSetId: () => string;
  scope: WorkspaceChangeExecutionScope;
}): WorkspaceChangeSet | undefined {
  const open = input.store.findOpenChangeSet(input.scope);
  if (open) return open;
  const finalized = input.store.listChangeSetsByRunId(input.scope.run_id)
    .some((changeSet) => changeSet.workspace_id === input.scope.workspace_id
      && changeSet.session_id === input.scope.session_id
      && changeSet.status === 'finalized');
  if (finalized) return undefined;
  return input.store.insertChangeSet({
    change_set_id: input.changeSetId(),
    workspace_id: input.scope.workspace_id,
    session_id: input.scope.session_id,
    run_id: input.scope.run_id,
    status: 'open',
    changed_file_count: 0,
    created_at: input.now(),
  });
}
