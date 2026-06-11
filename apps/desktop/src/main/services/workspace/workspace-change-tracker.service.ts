import { createHash, randomUUID } from 'node:crypto';

import type { ToolExecution } from '@megumi/shared/tool';
import type {
  WorkspaceChangedFile,
  WorkspaceChangeKind,
  WorkspaceChangeSet,
  WorkspaceCheckpoint,
  WorkspaceSnapshotContent,
} from '@megumi/shared/workspace';

import {
  assertOrdinaryProjectPath,
  inputRecord,
  normalizeSlash,
  type ProjectToolFileSystem,
} from '../tool/tool-executors';

export interface WorkspaceChangeExecutionScope {
  sessionId: string;
  runId: string;
  stepId?: string;
  sourceEntryId?: string;
  responseMessageId?: string;
}

export interface WorkspaceChangeTrackerRepositoryPort {
  getChangeSet(changeSetId: string): WorkspaceChangeSet | undefined;
  saveChangeSet(changeSet: WorkspaceChangeSet): WorkspaceChangeSet;
  finalizeChangeSet(changeSetId: string, finalizedAt: string): WorkspaceChangeSet | undefined;
  saveSnapshotContent(snapshot: WorkspaceSnapshotContent): WorkspaceSnapshotContent;
  saveWorkspaceCheckpoint(checkpoint: WorkspaceCheckpoint): WorkspaceCheckpoint;
  saveChangedFile(changedFile: WorkspaceChangedFile): WorkspaceChangedFile;
}

export interface WorkspaceChangeTrackerOptions {
  projectRoot: string;
  fileSystem: Pick<ProjectToolFileSystem, 'readFile' | 'stat'>;
  repository: WorkspaceChangeTrackerRepositoryPort;
  now?: () => string;
  ids?: {
    changeSetId(): string;
    workspaceCheckpointId(): string;
    snapshotContentRefId(): string;
    changedFileId(): string;
  };
  maxSnapshotBytes?: number;
}

interface ResolvedWorkspaceChangeTrackerOptions extends WorkspaceChangeTrackerOptions {
  now: () => string;
  ids: NonNullable<WorkspaceChangeTrackerOptions['ids']>;
  maxSnapshotBytes: number;
}

interface TrackToolExecutionInput<T> {
  scope?: WorkspaceChangeExecutionScope;
  toolExecution: ToolExecution;
  execute(): Promise<T>;
}

interface ActiveChangeSetState {
  changeSetId: string;
  scope: WorkspaceChangeExecutionScope;
}

interface ManagedMutationTarget {
  absolutePath: string;
  projectPath: string;
}

interface CapturedFileState {
  exists: boolean;
  contentRefId?: string;
  sha256?: string;
  byteLength?: number;
}

interface CapturedFileContent extends CapturedFileState {
  contentText?: string;
}

const DEFAULT_MAX_SNAPSHOT_BYTES = 1024 * 1024;
const MANAGED_FILE_TOOL_NAMES = new Set(['edit_file', 'write_file']);

export class WorkspaceChangeTrackerService {
  private readonly options: ResolvedWorkspaceChangeTrackerOptions;
  private readonly activeChangeSets = new Map<string, ActiveChangeSetState>();
  private readonly fileMutationQueues = new Map<string, Promise<void>>();

  constructor(options: WorkspaceChangeTrackerOptions) {
    this.options = {
      ...options,
      now: options.now ?? (() => new Date().toISOString()),
      ids: options.ids ?? {
        changeSetId: () => `workspace-change-set:${randomUUID()}`,
        workspaceCheckpointId: () => `workspace-checkpoint:${randomUUID()}`,
        snapshotContentRefId: () => `workspace-snapshot:${randomUUID()}`,
        changedFileId: () => `workspace-changed-file:${randomUUID()}`,
      },
      maxSnapshotBytes: options.maxSnapshotBytes ?? DEFAULT_MAX_SNAPSHOT_BYTES,
    };
  }

  async trackToolExecution<T>(input: TrackToolExecutionInput<T>): Promise<T> {
    if (!input.scope || !MANAGED_FILE_TOOL_NAMES.has(input.toolExecution.toolName)) {
      return input.execute();
    }

    const scope = input.scope;
    const target = this.resolveMutationTarget(input.toolExecution);
    return this.enqueueFileMutation(target.projectPath, () => this.trackManagedMutation({
      ...input,
      scope,
    }, target));
  }

  finalizeChangeSet(scope: WorkspaceChangeExecutionScope): WorkspaceChangeSet | undefined {
    const scopeKey = scopeKeyFor(scope);
    const active = this.activeChangeSets.get(scopeKey);
    if (!active) {
      return undefined;
    }

    this.activeChangeSets.delete(scopeKey);
    return this.options.repository.finalizeChangeSet(active.changeSetId, this.options.now());
  }

  private async trackManagedMutation<T>(
    input: TrackToolExecutionInput<T> & { scope: WorkspaceChangeExecutionScope },
    target: ManagedMutationTarget,
  ): Promise<T> {
    const changeSet = this.openChangeSet(input.scope);
    const before = await this.captureFileContent(input.scope, target.projectPath, target.absolutePath);
    this.assertProjectedAfterSnapshotWithinLimit(input.toolExecution, target.projectPath, before);

    const checkpoint = this.options.repository.saveWorkspaceCheckpoint({
      workspaceCheckpointId: this.options.ids.workspaceCheckpointId(),
      changeSetId: changeSet.changeSetId,
      sessionId: input.scope.sessionId,
      runId: input.scope.runId,
      stepId: input.scope.stepId,
      toolCallId: input.toolExecution.toolCallId,
      toolExecutionId: input.toolExecution.toolExecutionId,
      sourceEntryId: input.scope.sourceEntryId,
      responseMessageId: input.scope.responseMessageId,
      projectPath: target.projectPath,
      ...beforeStateFields(before),
      createdAt: this.options.now(),
    });

    const result = await input.execute();
    const after = await this.captureFileContent(input.scope, target.projectPath, target.absolutePath);
    const changeKind = determineChangeKind(before, after);
    if (!changeKind) {
      return result;
    }

    const createdAt = this.options.now();
    this.options.repository.saveChangedFile({
      changedFileId: this.options.ids.changedFileId(),
      changeSetId: changeSet.changeSetId,
      workspaceCheckpointId: checkpoint.workspaceCheckpointId,
      sessionId: input.scope.sessionId,
      runId: input.scope.runId,
      stepId: input.scope.stepId,
      toolCallId: input.toolExecution.toolCallId,
      toolExecutionId: input.toolExecution.toolExecutionId,
      sourceEntryId: input.scope.sourceEntryId,
      responseMessageId: input.scope.responseMessageId,
      projectPath: target.projectPath,
      changeKind,
      restoreState: 'restorable',
      ...beforeStateFields(before),
      ...afterStateFields(after),
      createdAt,
      updatedAt: createdAt,
    });

    return result;
  }

  private openChangeSet(scope: WorkspaceChangeExecutionScope): ActiveChangeSetState {
    const scopeKey = scopeKeyFor(scope);
    const active = this.activeChangeSets.get(scopeKey);
    if (active) {
      const persisted = this.options.repository.getChangeSet(active.changeSetId);
      if (persisted?.status === 'finalized') {
        throw new Error(`Workspace change set ${active.changeSetId} is already finalized.`);
      }
      return active;
    }

    const changeSet: WorkspaceChangeSet = {
      changeSetId: this.options.ids.changeSetId(),
      sessionId: scope.sessionId,
      runId: scope.runId,
      stepId: scope.stepId,
      sourceEntryId: scope.sourceEntryId,
      responseMessageId: scope.responseMessageId,
      status: 'open',
      changedFileCount: 0,
      createdAt: this.options.now(),
    };
    const saved = this.options.repository.saveChangeSet(changeSet);
    const state = { changeSetId: saved.changeSetId, scope };
    this.activeChangeSets.set(scopeKey, state);
    return state;
  }

  private resolveMutationTarget(toolExecution: ToolExecution): ManagedMutationTarget {
    const input = inputRecord(toolExecution);
    const pathInput = input.path;
    if (typeof pathInput !== 'string') {
      throw new Error('Missing or invalid string input: path');
    }

    const resolved = assertOrdinaryProjectPath({ projectRoot: this.options.projectRoot }, pathInput);
    const projectPath = normalizeProjectPath(resolved.relativePath);
    return {
      absolutePath: resolved.absolutePath,
      projectPath,
    };
  }

  private async captureFileContent(
    scope: WorkspaceChangeExecutionScope,
    projectPath: string,
    absolutePath: string,
  ): Promise<CapturedFileContent> {
    const exists = await this.fileExists(absolutePath);
    if (!exists) {
      return { exists: false };
    }

    const contentText = await this.readExistingFile(absolutePath);
    if (contentText === undefined) {
      return { exists: false };
    }
    assertSupportedSnapshotText(projectPath, contentText);

    const byteLength = Buffer.byteLength(contentText, 'utf8');
    this.assertSnapshotByteLengthWithinLimit(projectPath, byteLength);

    const sha256 = sha256Hex(contentText);
    const contentRefId = this.options.ids.snapshotContentRefId();
    this.options.repository.saveSnapshotContent({
      contentRefId,
      sessionId: scope.sessionId,
      runId: scope.runId,
      projectPath,
      storage: 'sqlite_text',
      encoding: 'utf8',
      sha256,
      byteLength,
      contentText,
      createdAt: this.options.now(),
    });

    return {
      exists: true,
      contentRefId,
      sha256,
      byteLength,
      contentText,
    };
  }

  private async fileExists(absolutePath: string): Promise<boolean> {
    try {
      const stat = await this.options.fileSystem.stat(absolutePath);
      if (!stat.isFile()) {
        throw new Error(`Workspace change target is not a file: ${absolutePath}`);
      }
      return true;
    } catch (error) {
      if (isEnoentError(error)) {
        return false;
      }
      throw error;
    }
  }

  private async readExistingFile(absolutePath: string): Promise<string | undefined> {
    try {
      return await this.options.fileSystem.readFile(absolutePath, 'utf8');
    } catch (error) {
      if (isEnoentError(error)) {
        return undefined;
      }
      throw error;
    }
  }

  private assertProjectedAfterSnapshotWithinLimit(
    toolExecution: ToolExecution,
    projectPath: string,
    before: CapturedFileContent,
  ): void {
    const projected = projectAfterContent(toolExecution, before.contentText);
    if (projected !== undefined) {
      assertSupportedSnapshotText(projectPath, projected);
      this.assertSnapshotByteLengthWithinLimit(
        projectPath,
        Buffer.byteLength(projected, 'utf8'),
      );
    }
  }

  private assertSnapshotByteLengthWithinLimit(projectPath: string, byteLength: number): void {
    if (byteLength > this.options.maxSnapshotBytes) {
      throw new Error(
        `Workspace snapshot for ${projectPath} exceeds maxSnapshotBytes ${this.options.maxSnapshotBytes}.`,
      );
    }
  }

  private enqueueFileMutation<T>(projectPath: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.fileMutationQueues.get(projectPath) ?? Promise.resolve();
    const execution = previous.catch(() => undefined).then(operation);
    const tail = execution.then(
      () => undefined,
      () => undefined,
    );
    this.fileMutationQueues.set(projectPath, tail);
    void tail.then(() => {
      if (this.fileMutationQueues.get(projectPath) === tail) {
        this.fileMutationQueues.delete(projectPath);
      }
    });
    return execution;
  }
}

function scopeKeyFor(scope: WorkspaceChangeExecutionScope): string {
  return [
    scope.sessionId,
    scope.runId,
    scope.stepId ?? '',
    scope.sourceEntryId ?? '',
    scope.responseMessageId ?? '',
  ].join('\0');
}

function normalizeProjectPath(relativePath: string): string {
  const normalized = normalizeSlash(relativePath);
  if (!normalized || normalized === '.') {
    throw new Error('Workspace change target must be a project-relative file path.');
  }
  return normalized;
}

function sha256Hex(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function beforeStateFields(state: CapturedFileState): Pick<
  WorkspaceCheckpoint,
  'beforeExists' | 'beforeContentRefId' | 'beforeHash' | 'beforeByteLength'
> {
  return {
    beforeExists: state.exists,
    beforeContentRefId: state.contentRefId,
    beforeHash: state.sha256,
    beforeByteLength: state.byteLength,
  };
}

function afterStateFields(state: CapturedFileState): Pick<
  WorkspaceChangedFile,
  'afterExists' | 'afterContentRefId' | 'afterHash' | 'afterByteLength'
> {
  return {
    afterExists: state.exists,
    afterContentRefId: state.contentRefId,
    afterHash: state.sha256,
    afterByteLength: state.byteLength,
  };
}

function determineChangeKind(
  before: CapturedFileState,
  after: CapturedFileState,
): WorkspaceChangeKind | undefined {
  if (!before.exists && after.exists) {
    return 'created';
  }
  if (before.exists && after.exists) {
    if (before.sha256 === after.sha256) {
      return undefined;
    }
    return 'modified';
  }
  if (before.exists && !after.exists) {
    return 'deleted';
  }
  return undefined;
}

function projectAfterContent(toolExecution: ToolExecution, beforeContent: string | undefined): string | undefined {
  const input = inputRecord(toolExecution);
  if (toolExecution.toolName === 'write_file') {
    return typeof input.content === 'string' ? input.content : undefined;
  }
  if (
    toolExecution.toolName === 'edit_file'
    && beforeContent !== undefined
    && typeof input.oldText === 'string'
    && typeof input.newText === 'string'
  ) {
    return beforeContent.split(input.oldText).join(input.newText);
  }
  return undefined;
}

function assertSupportedSnapshotText(projectPath: string, contentText: string): void {
  if (contentText.includes('\u0000') || contentText.includes('\uFFFD')) {
    throw new Error(`Workspace snapshot for ${projectPath} has unsupported text content.`);
  }
}

function isEnoentError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as NodeJS.ErrnoException).code === 'ENOENT';
}


