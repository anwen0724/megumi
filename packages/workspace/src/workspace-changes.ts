/*
 * Records structured file effects reported by Tool execution without inferring
 * behavior from Tool names or re-running filesystem observations.
 */
import { randomUUID } from 'node:crypto';
import type { WorkspaceStore } from './workspace-store';

export type WorkspaceChangeSetStatus = 'open' | 'finalized';
export type WorkspaceEffectCoverage = 'complete' | 'unknown';
export type WorkspaceChangeKind = 'created' | 'modified' | 'deleted';
export type WorkspaceEffectType = 'created' | 'modified' | 'copied' | 'moved' | 'deleted';

export interface WorkspaceChangeSet {
  change_set_id: string;
  workspace_id: string;
  session_id: string;
  run_id: string;
  status: WorkspaceChangeSetStatus;
  effect_coverage: WorkspaceEffectCoverage;
  changed_file_count: number;
  created_at: string;
  finalized_at?: string;
}

export interface WorkspaceChangedFile {
  changed_file_id: string;
  change_set_id: string;
  workspace_path: string;
  change_kind: WorkspaceChangeKind;
  effect_type: WorkspaceEffectType;
  source_workspace_path?: string;
  destination_workspace_path?: string;
  path_type: 'file' | 'directory';
  recoverable?: boolean;
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

interface WorkspaceToolEffectPath {
  readonly location: 'workspace' | 'external';
  readonly path: string;
}

type WorkspaceToolEffect =
  | { readonly type: 'created'; readonly path: WorkspaceToolEffectPath; readonly pathType: 'file' | 'directory' }
  | { readonly type: 'modified'; readonly path: WorkspaceToolEffectPath; readonly pathType: 'file' }
  | { readonly type: 'copied'; readonly source: WorkspaceToolEffectPath; readonly destination: WorkspaceToolEffectPath; readonly pathType: 'file' | 'directory' }
  | { readonly type: 'moved'; readonly source: WorkspaceToolEffectPath; readonly destination: WorkspaceToolEffectPath; readonly pathType: 'file' | 'directory' }
  | { readonly type: 'deleted'; readonly path: WorkspaceToolEffectPath; readonly pathType: 'file' | 'directory'; readonly recoverable: true };

export interface WorkspaceToolEffectReport {
  readonly coverage: WorkspaceEffectCoverage;
  readonly effects: readonly WorkspaceToolEffect[];
  readonly itemFailures: readonly { readonly path: string; readonly code: string; readonly message: string }[];
  readonly reason?: string;
}

export interface TrackWorkspaceToolExecutionRequest<T extends { readonly effectReport?: WorkspaceToolEffectReport }> {
  scope?: WorkspaceChangeExecutionScope;
  execute: () => Promise<T>;
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
  trackToolExecution<T extends { readonly effectReport?: WorkspaceToolEffectReport }>(request: TrackWorkspaceToolExecutionRequest<T>): Promise<T>;
  finalizeChangeSet(request: FinalizeWorkspaceChangeSetRequest): FinalizeWorkspaceChangeSetResult;
  getChangeSummary(request: GetWorkspaceChangeSummaryRequest): GetWorkspaceChangeSummaryResult;
  listChangedFiles(request: ListWorkspaceChangedFilesRequest): ListWorkspaceChangedFilesResult;
  listChangeSummaries(request: ListWorkspaceChangeSummariesRequest): ListWorkspaceChangeSummariesResult;
}

export type WorkspaceChangeDiagnosticReason = 'store_failed';
export interface WorkspaceChangeDiagnostic {
  phase: 'project_change';
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
  ids?: { change_set_id?: () => string; changed_file_id?: () => string };
  now?: () => string;
  on_diagnostic?: (diagnostic: WorkspaceChangeDiagnostic) => void | Promise<void>;
}

export function createWorkspaceChanges(options: CreateWorkspaceChangesRequest): WorkspaceChanges {
  const now = options.now ?? (() => new Date().toISOString());
  const changeSetId = options.ids?.change_set_id ?? (() => `workspace-change-set:${randomUUID()}`);
  const changedFileId = options.ids?.changed_file_id ?? (() => `workspace-changed-file:${randomUUID()}`);

  const reportFailure = async (scope: WorkspaceChangeExecutionScope, workspacePath?: string) => {
    try {
      await options.on_diagnostic?.({
        phase: 'project_change',
        reason: 'store_failed',
        workspace_id: scope.workspace_id,
        session_id: scope.session_id,
        run_id: scope.run_id,
        ...(workspacePath ? { workspace_path: workspacePath } : {}),
      });
    } catch {
      // Diagnostics cannot rewrite an already completed Tool outcome.
    }
  };

  return {
    async trackToolExecution(request) {
      const result = await request.execute();
      if (!request.scope || !result.effectReport) return result;
      const scope = request.scope;
      const effectReport = result.effectReport;
      const hasWorkspaceEffect = effectReport.effects.some(effectAffectsWorkspace);
      if (!hasWorkspaceEffect && effectReport.coverage === 'complete') return result;

      try {
        const changeSet = getOrCreateOpenChangeSet({
          store: options.store,
          now,
          changeSetId,
          scope,
          coverage: effectReport.coverage,
        });
        if (!changeSet) return result;
        for (const effect of effectReport.effects) {
          const file = changedFileFromEffect({
            effect,
            changeSetId: changeSet.change_set_id,
            changedFileId: changedFileId(),
            createdAt: now(),
          });
          if (file) options.store.upsertChangedFile(file);
        }
      } catch {
        await reportFailure(scope, effectReport.effects.map(effectWorkspacePath).find(Boolean));
      }
      return result;
    },

    finalizeChangeSet(request) {
      const open = options.store.findOpenChangeSet(request);
      if (open) {
        const finalized = options.store.finalizeChangeSet({ change_set_id: open.change_set_id, finalized_at: request.finalized_at });
        return finalized ? { status: 'finalized', change_set: finalized } : { status: 'not_found' };
      }
      const finalized = options.store.listChangeSetsByRunId(request.run_id)
        .find((changeSet) => changeSet.workspace_id === request.workspace_id
          && changeSet.session_id === request.session_id
          && changeSet.status === 'finalized');
      return finalized ? { status: 'finalized', change_set: finalized } : { status: 'not_found' };
    },

    getChangeSummary(request) {
      const summary = options.store.getChangeSummary(request.change_set_id);
      return summary ? { status: 'found', summary } : { status: 'not_found', change_set_id: request.change_set_id };
    },

    listChangedFiles(request) {
      return { files: request.by === 'change_set'
        ? options.store.listChangedFilesByChangeSetId(request.change_set_id)
        : options.store.listChangedFilesByRunId(request.run_id) };
    },

    listChangeSummaries(request) {
      return { summaries: options.store.listChangeSetsByRunId(request.run_id)
        .map((changeSet) => options.store.getChangeSummary(changeSet.change_set_id))
        .filter((summary): summary is WorkspaceChangeSummary => Boolean(summary)) };
    },
  };
}

function changedFileFromEffect(input: {
  effect: WorkspaceToolEffect;
  changeSetId: string;
  changedFileId: string;
  createdAt: string;
}): WorkspaceChangedFile | undefined {
  const effect = input.effect;
  const projection = workspaceProjection(effect);
  if (!projection) return undefined;
  return {
    changed_file_id: input.changedFileId,
    change_set_id: input.changeSetId,
    workspace_path: projection.path,
    change_kind: projection.changeKind,
    effect_type: effect.type,
    ...(projection.source ? { source_workspace_path: projection.source } : {}),
    ...(projection.destination ? { destination_workspace_path: projection.destination } : {}),
    path_type: effect.pathType,
    ...('recoverable' in effect ? { recoverable: effect.recoverable } : {}),
    created_at: input.createdAt,
  };
}

function effectAffectsWorkspace(effect: WorkspaceToolEffect): boolean {
  return Boolean(workspaceProjection(effect));
}

function effectWorkspacePath(effect: WorkspaceToolEffect): string | undefined {
  return workspaceProjection(effect)?.path;
}

function workspaceProjection(effect: WorkspaceToolEffect): {
  readonly path: string;
  readonly changeKind: WorkspaceChangeKind;
  readonly source?: string;
  readonly destination?: string;
} | undefined {
  if (effect.type === 'copied') {
    if (effect.destination.location !== 'workspace') return undefined;
    return {
      path: effect.destination.path,
      changeKind: 'created',
      ...(effect.source.location === 'workspace' ? { source: effect.source.path } : {}),
      destination: effect.destination.path,
    };
  }
  if (effect.type === 'moved') {
    if (effect.destination.location === 'workspace') {
      return {
        path: effect.destination.path,
        changeKind: 'modified',
        ...(effect.source.location === 'workspace' ? { source: effect.source.path } : {}),
        destination: effect.destination.path,
      };
    }
    return effect.source.location === 'workspace'
      ? { path: effect.source.path, changeKind: 'deleted', source: effect.source.path }
      : undefined;
  }
  if (effect.path.location !== 'workspace') return undefined;
  return {
    path: effect.path.path,
    changeKind: effect.type === 'created'
      ? 'created'
      : effect.type === 'deleted'
        ? 'deleted'
        : 'modified',
  };
}
export function resolveChangeKind(input: {
  before: { exists: false } | { exists: true; size_bytes: number; modified_at_ms: number; content_hash: string };
  after: { exists: false } | { exists: true; size_bytes: number; modified_at_ms: number; content_hash: string };
}): WorkspaceChangeKind | undefined {
  if (!input.before.exists && input.after.exists) return 'created';
  if (input.before.exists && !input.after.exists) return 'deleted';
  if (!input.before.exists || !input.after.exists) return undefined;
  return input.before.size_bytes !== input.after.size_bytes || input.before.content_hash !== input.after.content_hash
    ? 'modified'
    : undefined;
}

function getOrCreateOpenChangeSet(input: {
  store: CreateWorkspaceChangesRequest['store'];
  now: () => string;
  changeSetId: () => string;
  scope: WorkspaceChangeExecutionScope;
  coverage: WorkspaceEffectCoverage;
}): WorkspaceChangeSet | undefined {
  const open = input.store.findOpenChangeSet(input.scope);
  if (open) {
    if (open.effect_coverage === 'complete' && input.coverage === 'unknown') {
      return input.store.insertChangeSet({ ...open, effect_coverage: 'unknown' });
    }
    return open;
  }
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
    effect_coverage: input.coverage,
    changed_file_count: 0,
    created_at: input.now(),
  });
}