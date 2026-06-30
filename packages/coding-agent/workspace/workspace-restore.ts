import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

import type { RuntimeError } from '@megumi/shared/runtime';
import type {
  WorkspaceChangedFile,
  WorkspaceChangeSet,
  WorkspaceChangeSummary,
  WorkspaceRestoreConflictReason,
  WorkspaceRestoreFileResult,
  WorkspaceRestoreRequest,
  WorkspaceRestoreResult,
  WorkspaceSnapshotContent,
} from '@megumi/shared/workspace';

import { assertOrdinaryProjectPath } from './path-policy';

export interface WorkspaceRestoreRepositoryPort {
  getWorkspaceChange(changeSetId: string): WorkspaceChangeSet | undefined;
  listChangedFilesByChangeSet(changeSetId: string): WorkspaceChangedFile[];
  getSnapshotContent(contentRefId: string): WorkspaceSnapshotContent | undefined;
  createRestoreOperation(request: WorkspaceRestoreRequest): WorkspaceRestoreRequest;
  updateRestoreOperation(input: {
    restoreRequestId: string;
    status: WorkspaceRestoreRequest['status'];
    completedAt?: string;
    metadata?: WorkspaceRestoreRequest['metadata'];
  }): WorkspaceRestoreRequest | undefined;
  completeRestoreOperation(result: WorkspaceRestoreResult): WorkspaceRestoreResult;
  recordRestoreFileResult(fileResult: WorkspaceRestoreFileResult): WorkspaceRestoreFileResult;
  updateChangedFileRestoreState(input: {
    changedFileId: string;
    restoreState: WorkspaceChangedFile['restoreState'];
    updatedAt: string;
    metadata?: WorkspaceChangedFile['metadata'];
  }): WorkspaceChangedFile | undefined;
  getChangeSummary(changeSetId: string): WorkspaceChangeSummary | undefined;
}

export interface WorkspaceRestoreFileSystem {
  pathExists(filePath: string): Promise<boolean>;
  stat(filePath: string): Promise<{ isFile(): boolean }>;
  readFile(filePath: string, encoding: 'utf8'): Promise<string>;
  writeFile(filePath: string, content: string, encoding: 'utf8'): Promise<void>;
  mkdir(filePath: string, options: { recursive: true }): Promise<void> | Promise<unknown>;
  remove(filePath: string): Promise<void>;
}

export interface WorkspaceRestoreServiceOptions {
  projectRoot: string;
  repository: WorkspaceRestoreRepositoryPort;
  fileSystem: WorkspaceRestoreFileSystem;
  clock?: { now(): string };
  ids?: Partial<{
    restoreRequestId(): string;
    restoreResultId(): string;
    restoreFileResultId(): string;
  }>;
}

export interface WorkspaceRestoreChangeSetInput {
  changeSetId: string;
  requestedBy: WorkspaceRestoreRequest['requestedBy'];
  metadata?: WorkspaceRestoreRequest['metadata'];
}

export interface WorkspaceRestoreChangeSetResult {
  request: WorkspaceRestoreRequest;
  result: WorkspaceRestoreResult;
  fileResults: WorkspaceRestoreFileResult[];
  summary?: WorkspaceChangeSummary;
}

interface RestoreFileOutcome {
  changedFile: WorkspaceChangedFile;
  status: WorkspaceRestoreFileResult['status'];
  conflictReason?: WorkspaceRestoreConflictReason;
  error?: RuntimeError;
  metadata?: WorkspaceRestoreFileResult['metadata'];
  restoreState?: WorkspaceChangedFile['restoreState'];
}

interface CurrentFileState {
  exists: boolean;
  isFile: boolean;
  content?: string;
  hash?: string;
}

type BeforeStateMatch = 'different' | 'matches' | 'snapshot_missing';

interface RestoreResultCounts {
  [key: string]: number;
  changedFileCount: number;
  restoredCount: number;
  conflictCount: number;
  failedCount: number;
  noopCount: number;
}

export class WorkspaceRestoreService {
  private readonly projectRoot: string;
  private readonly repository: WorkspaceRestoreRepositoryPort;
  private readonly fileSystem: WorkspaceRestoreFileSystem;
  private readonly clock: { now(): string };
  private readonly ids: {
    restoreRequestId(): string;
    restoreResultId(): string;
    restoreFileResultId(): string;
  };

  constructor(options: WorkspaceRestoreServiceOptions) {
    this.projectRoot = options.projectRoot;
    this.repository = options.repository;
    this.fileSystem = options.fileSystem;
    this.clock = options.clock ?? { now: () => new Date().toISOString() };
    this.ids = {
      restoreRequestId: options.ids?.restoreRequestId ?? (() => `workspace-restore-request:${randomUUID()}`),
      restoreResultId: options.ids?.restoreResultId ?? (() => `workspace-restore-result:${randomUUID()}`),
      restoreFileResultId: options.ids?.restoreFileResultId ?? (() => `workspace-restore-file-result:${randomUUID()}`),
    };
  }

  async restoreChangeSet(input: WorkspaceRestoreChangeSetInput): Promise<WorkspaceRestoreChangeSetResult> {
    const changeSet = this.repository.getWorkspaceChange(input.changeSetId);
    if (!changeSet) {
      throw new Error(`Workspace change set not found: ${input.changeSetId}`);
    }

    const requestedAt = this.clock.now();
    let request = this.repository.createRestoreOperation({
      restoreRequestId: this.ids.restoreRequestId(),
      changeSetId: changeSet.changeSetId,
      sessionId: changeSet.sessionId,
      runId: changeSet.runId,
      requestedBy: input.requestedBy,
      status: 'requested',
      requestedAt,
      metadata: input.metadata,
    });

    try {
      request = this.repository.updateRestoreOperation({
        restoreRequestId: request.restoreRequestId,
        status: 'running',
        metadata: request.metadata,
      }) ?? { ...request, status: 'running' };

      const restoreResultId = this.ids.restoreResultId();
      const changedFilesForChangeSet = this.repository.listChangedFilesByChangeSet(changeSet.changeSetId);
      const pathPrevalidationOutcomes = this.prevalidateChangedFilePaths(changedFilesForChangeSet);
      const outcomes = pathPrevalidationOutcomes
        ?? await this.restoreChangedFiles(changedFilesForChangeSet);

      const completedAt = this.clock.now();
      const resultStatus = aggregateRestoreStatus(outcomes);
      const result = this.repository.completeRestoreOperation({
        restoreResultId,
        restoreRequestId: request.restoreRequestId,
        changeSetId: changeSet.changeSetId,
        sessionId: changeSet.sessionId,
        runId: changeSet.runId,
        status: resultStatus,
        restoredAt: completedAt,
        ...resultError(resultStatus, outcomes),
        metadata: resultCounts(outcomes),
      });

      const fileResults = outcomes.map((outcome) => {
        const fileResult = this.repository.recordRestoreFileResult(createFileResult({
          outcome,
          restoreResultId: result.restoreResultId,
          restoreFileResultId: this.ids.restoreFileResultId(),
          restoredAt: completedAt,
        }));
        this.repository.updateChangedFileRestoreState({
          changedFileId: outcome.changedFile.changedFileId,
          restoreState: restoreStateForFileOutcome(outcome),
          updatedAt: completedAt,
          metadata: changedFileRestoreMetadata({
            outcome,
            restoreRequestId: request.restoreRequestId,
            restoreResultId: result.restoreResultId,
          }),
        });
        return fileResult;
      });

      request = this.repository.updateRestoreOperation({
        restoreRequestId: request.restoreRequestId,
        status: resultStatus === 'failed' ? 'failed' : 'completed',
        completedAt,
        metadata: request.metadata,
      }) ?? {
        ...request,
        status: resultStatus === 'failed' ? 'failed' : 'completed',
        completedAt,
      };

      return {
        request,
        result,
        fileResults,
        summary: this.repository.getChangeSummary(changeSet.changeSetId),
      };
    } catch (error) {
      this.markRequestFailedAfterException(request);
      throw error;
    }
  }

  private prevalidateChangedFilePaths(changedFiles: WorkspaceChangedFile[]): RestoreFileOutcome[] | undefined {
    const invalidChangedFileIds = new Set<string>();
    for (const changedFile of changedFiles) {
      try {
        assertOrdinaryProjectPath({ projectRoot: this.projectRoot }, changedFile.projectPath);
      } catch {
        invalidChangedFileIds.add(changedFile.changedFileId);
      }
    }

    if (invalidChangedFileIds.size === 0) {
      return undefined;
    }

    return orderChangedFilesForRestore(changedFiles)
      .map((changedFile) => conflict(changedFile, 'path_outside_project'));
  }

  private async restoreChangedFiles(changedFilesForChangeSet: WorkspaceChangedFile[]): Promise<RestoreFileOutcome[]> {
    const alreadyRestoredChainIds = await this.findAlreadyRestoredChainIds(changedFilesForChangeSet);
    const changedFiles = orderChangedFilesForRestore(changedFilesForChangeSet);
    const outcomes: RestoreFileOutcome[] = [];
    for (const changedFile of changedFiles) {
      const outcome = alreadyRestoredChainIds.has(changedFile.changedFileId)
        ? noop(changedFile, { alreadyRestored: true })
        : await this.restoreChangedFile(changedFile);
      outcomes.push(outcome);
    }
    return outcomes;
  }

  private async restoreChangedFile(changedFile: WorkspaceChangedFile): Promise<RestoreFileOutcome> {
    if (changedFile.restoreState === 'not_restorable') {
      return noop(changedFile, { notRestorable: true }, 'not_restorable');
    }

    if (changedFile.restoreState === 'restored') {
      return noop(changedFile, { alreadyRestored: true });
    }

    let absolutePath: string;
    try {
      absolutePath = assertOrdinaryProjectPath({ projectRoot: this.projectRoot }, changedFile.projectPath).absolutePath;
    } catch {
      return conflict(changedFile, 'path_outside_project');
    }

    try {
      if (changedFile.changeKind === 'modified') {
        return await this.restoreModifiedFile(changedFile, absolutePath);
      }
      if (changedFile.changeKind === 'created') {
        return await this.restoreCreatedFile(changedFile, absolutePath);
      }
      return await this.restoreDeletedFile(changedFile, absolutePath);
    } catch (error) {
      return failed(changedFile, createRestoreRuntimeError('filesystem_error', messageFromError(error)));
    }
  }

  private async restoreModifiedFile(
    changedFile: WorkspaceChangedFile,
    absolutePath: string,
  ): Promise<RestoreFileOutcome> {
    const current = await this.readCurrentFile(absolutePath);
    if (!current.exists) {
      return conflict(changedFile, 'current_file_missing');
    }
    if (!current.isFile) {
      return conflict(changedFile, 'unsupported_file');
    }
    const beforeStateMatch = this.currentMatchesBeforeState(changedFile, current);
    if (beforeStateMatch === 'matches') {
      return noop(changedFile, { alreadyRestored: true });
    }
    if (beforeStateMatch === 'snapshot_missing') {
      return conflict(changedFile, 'snapshot_missing');
    }
    if (current.hash !== changedFile.afterHash) {
      return conflict(changedFile, 'current_hash_mismatch');
    }

    const snapshot = this.requireBeforeSnapshot(changedFile);
    if (!snapshot) {
      return conflict(changedFile, 'snapshot_missing');
    }

    try {
      await this.fileSystem.mkdir(path.dirname(absolutePath), { recursive: true });
      await this.fileSystem.writeFile(absolutePath, snapshot.contentText, 'utf8');
      return restored(changedFile);
    } catch (error) {
      return failed(changedFile, createRestoreRuntimeError('filesystem_error', messageFromError(error)));
    }
  }

  private async restoreCreatedFile(
    changedFile: WorkspaceChangedFile,
    absolutePath: string,
  ): Promise<RestoreFileOutcome> {
    const current = await this.readCurrentFile(absolutePath);
    if (!current.exists) {
      return noop(changedFile, { alreadyAbsent: true });
    }
    if (!current.isFile) {
      return conflict(changedFile, 'unsupported_file');
    }
    if (current.hash !== changedFile.afterHash) {
      return conflict(changedFile, 'current_hash_mismatch');
    }

    try {
      await this.fileSystem.remove(absolutePath);
      return restored(changedFile);
    } catch (error) {
      return failed(changedFile, createRestoreRuntimeError('filesystem_error', messageFromError(error)));
    }
  }

  private async restoreDeletedFile(
    changedFile: WorkspaceChangedFile,
    absolutePath: string,
  ): Promise<RestoreFileOutcome> {
    const exists = await this.fileSystem.pathExists(absolutePath);
    if (exists) {
      return conflict(changedFile, 'current_file_exists');
    }

    const snapshot = this.requireBeforeSnapshot(changedFile);
    if (!snapshot) {
      return conflict(changedFile, 'snapshot_missing');
    }

    try {
      await this.fileSystem.mkdir(path.dirname(absolutePath), { recursive: true });
      await this.fileSystem.writeFile(absolutePath, snapshot.contentText, 'utf8');
      return restored(changedFile);
    } catch (error) {
      return failed(changedFile, createRestoreRuntimeError('filesystem_error', messageFromError(error)));
    }
  }

  private async readCurrentFile(absolutePath: string): Promise<CurrentFileState> {
    const exists = await this.fileSystem.pathExists(absolutePath);
    if (!exists) {
      return { exists: false, isFile: false };
    }

    const stats = await this.fileSystem.stat(absolutePath);
    if (!stats.isFile()) {
      return { exists: true, isFile: false };
    }

    const content = await this.fileSystem.readFile(absolutePath, 'utf8');
    return {
      exists: true,
      isFile: true,
      content,
      hash: sha256(content),
    };
  }

  private requireBeforeSnapshot(changedFile: WorkspaceChangedFile): WorkspaceSnapshotContent | undefined {
    if (!changedFile.beforeContentRefId || !changedFile.beforeHash || changedFile.beforeByteLength === undefined) {
      return undefined;
    }
    const snapshot = this.repository.getSnapshotContent(changedFile.beforeContentRefId);
    if (!snapshot) {
      return undefined;
    }

    const contentByteLength = Buffer.byteLength(snapshot.contentText, 'utf8');
    return snapshot.sessionId === changedFile.sessionId
      && snapshot.runId === changedFile.runId
      && snapshot.projectPath === changedFile.projectPath
      && snapshot.sha256 === changedFile.beforeHash
      && snapshot.byteLength === changedFile.beforeByteLength
      && sha256(snapshot.contentText) === snapshot.sha256
      && contentByteLength === snapshot.byteLength
      ? snapshot
      : undefined;
  }

  private currentMatchesBeforeState(
    changedFile: WorkspaceChangedFile,
    current: CurrentFileState,
  ): BeforeStateMatch {
    if (
      !current.exists
      || !current.isFile
      || current.content === undefined
      || !changedFile.beforeHash
      || changedFile.beforeByteLength === undefined
      || current.hash !== changedFile.beforeHash
      || Buffer.byteLength(current.content, 'utf8') !== changedFile.beforeByteLength
    ) {
      return 'different';
    }

    return this.requireBeforeSnapshot(changedFile) ? 'matches' : 'snapshot_missing';
  }

  private markRequestFailedAfterException(request: WorkspaceRestoreRequest): void {
    try {
      this.repository.updateRestoreOperation({
        restoreRequestId: request.restoreRequestId,
        status: 'failed',
        completedAt: this.clock.now(),
        metadata: request.metadata,
      });
    } catch {
      // Preserve the original aggregate/persistence failure for the caller.
    }
  }

  private async findAlreadyRestoredChainIds(changedFiles: WorkspaceChangedFile[]): Promise<Set<string>> {
    const ids = new Set<string>();
    const pathGroups = groupChangedFilesByProjectPath(changedFiles);
    for (const pathChanges of pathGroups) {
      if (pathChanges.length < 2 || !(await this.isPathChainAlreadyRestored(pathChanges))) {
        continue;
      }
      for (const changedFile of pathChanges) {
        ids.add(changedFile.changedFileId);
      }
    }
    return ids;
  }

  private async isPathChainAlreadyRestored(pathChanges: WorkspaceChangedFile[]): Promise<boolean> {
    const firstChange = pathChanges[0];
    let absolutePath: string;
    try {
      absolutePath = assertOrdinaryProjectPath({ projectRoot: this.projectRoot }, firstChange.projectPath).absolutePath;
    } catch {
      return false;
    }

    if (firstChange.changeKind === 'created') {
      try {
        return !(await this.fileSystem.pathExists(absolutePath));
      } catch {
        return false;
      }
    }

    try {
      const current = await this.readCurrentFile(absolutePath);
      return this.currentMatchesBeforeState(firstChange, current) === 'matches';
    } catch {
      return false;
    }
  }
}

function createFileResult(input: {
  outcome: RestoreFileOutcome;
  restoreResultId: string;
  restoreFileResultId: string;
  restoredAt: string;
}): WorkspaceRestoreFileResult {
  return {
    restoreFileResultId: input.restoreFileResultId,
    restoreResultId: input.restoreResultId,
    changedFileId: input.outcome.changedFile.changedFileId,
    projectPath: input.outcome.changedFile.projectPath,
    status: input.outcome.status,
    ...(input.outcome.conflictReason ? { conflictReason: input.outcome.conflictReason } : {}),
    ...(input.outcome.error ? { error: input.outcome.error } : {}),
    ...(
      input.outcome.status === 'restored' || input.outcome.status === 'noop'
        ? { restoredAt: input.restoredAt }
        : {}
    ),
    ...(input.outcome.metadata ? { metadata: input.outcome.metadata } : {}),
  };
}

function changedFileRestoreMetadata(input: {
  outcome: RestoreFileOutcome;
  restoreRequestId: string;
  restoreResultId: string;
}): WorkspaceChangedFile['metadata'] {
  return {
    restoreRequestId: input.restoreRequestId,
    restoreResultId: input.restoreResultId,
    ...(input.outcome.conflictReason ? { conflictReason: input.outcome.conflictReason } : {}),
    ...(input.outcome.metadata ?? {}),
  };
}

function restoreStateForFileOutcome(
  outcome: RestoreFileOutcome,
): WorkspaceChangedFile['restoreState'] {
  if (outcome.restoreState) {
    return outcome.restoreState;
  }
  if (outcome.status === 'conflict') {
    return 'conflict';
  }
  if (outcome.status === 'failed') {
    return 'restore_failed';
  }
  return 'restored';
}

function aggregateRestoreStatus(
  outcomes: RestoreFileOutcome[],
): WorkspaceRestoreResult['status'] {
  const counts = resultCounts(outcomes);
  if (outcomes.length === 0 || counts.noopCount === outcomes.length) {
    return 'noop';
  }
  if (counts.failedCount === outcomes.length) {
    return 'failed';
  }
  if (counts.failedCount > 0 && counts.conflictCount > 0) {
    return 'partial';
  }
  if (
    counts.restoredCount > 0
    && counts.restoredCount + counts.noopCount === outcomes.length
  ) {
    return 'restored';
  }
  if (
    counts.restoredCount + counts.noopCount > 0
    && counts.conflictCount + counts.failedCount > 0
  ) {
    return 'partial';
  }
  return 'conflict';
}

function resultCounts(outcomes: RestoreFileOutcome[]): RestoreResultCounts {
  return {
    changedFileCount: outcomes.length,
    restoredCount: outcomes.filter((outcome) => outcome.status === 'restored').length,
    conflictCount: outcomes.filter((outcome) => outcome.status === 'conflict').length,
    failedCount: outcomes.filter((outcome) => outcome.status === 'failed').length,
    noopCount: outcomes.filter((outcome) => outcome.status === 'noop').length,
  };
}

function resultError(
  status: WorkspaceRestoreResult['status'],
  outcomes: RestoreFileOutcome[],
): Pick<WorkspaceRestoreResult, 'error'> | Record<string, never> {
  if (status !== 'failed') {
    return {};
  }
  return {
    error: outcomes.find((outcome) => outcome.error)?.error
      ?? createRestoreRuntimeError('filesystem_error', 'Workspace restore failed.'),
  };
}

function restored(changedFile: WorkspaceChangedFile): RestoreFileOutcome {
  return {
    changedFile,
    status: 'restored',
  };
}

function noop(
  changedFile: WorkspaceChangedFile,
  metadata?: WorkspaceRestoreFileResult['metadata'],
  restoreState?: WorkspaceChangedFile['restoreState'],
): RestoreFileOutcome {
  return {
    changedFile,
    status: 'noop',
    metadata,
    restoreState,
  };
}

function conflict(
  changedFile: WorkspaceChangedFile,
  conflictReason: WorkspaceRestoreConflictReason,
): RestoreFileOutcome {
  return {
    changedFile,
    status: 'conflict',
    conflictReason,
  };
}

function failed(changedFile: WorkspaceChangedFile, error: RuntimeError): RestoreFileOutcome {
  return {
    changedFile,
    status: 'failed',
    error,
  };
}

function createRestoreRuntimeError(
  code: RuntimeError['code'],
  message: string,
): RuntimeError {
  return {
    code,
    message,
    severity: 'error',
    retryable: false,
    source: 'workspace',
  };
}

function messageFromError(error: unknown): string {
  return 'Workspace restore filesystem operation failed.';
}

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function orderChangedFilesForRestore(changedFiles: WorkspaceChangedFile[]): WorkspaceChangedFile[] {
  return groupChangedFilesByProjectPath(changedFiles)
    .flatMap((pathChanges) => [...pathChanges].reverse());
}

function groupChangedFilesByProjectPath(changedFiles: WorkspaceChangedFile[]): WorkspaceChangedFile[][] {
  const paths = new Map<string, WorkspaceChangedFile[]>();
  for (const changedFile of changedFiles) {
    const pathChanges = paths.get(changedFile.projectPath) ?? [];
    pathChanges.push(changedFile);
    paths.set(changedFile.projectPath, pathChanges);
  }

  return Array.from(paths.values());
}


