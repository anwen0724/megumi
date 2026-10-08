/* Defines application-owned memory production, maintenance and query results. */
import type { MemoryChanged } from './wire-contracts';
import type { ModelSelection } from '../contracts';
import type { MemoryDocument, MemoryDocumentSlice } from './memory-files';
import type { ExtractionCoverage } from './extraction-input';
import type { createMemoryQueries } from './memory-queries';
import type { TaskMemory, TaskMemoryInput } from './memory-consumption';
import type { MemoryUsageResult } from './memory-usage';

export type MemoryArtifactState = 'empty' | 'ready' | 'updating' | 'needsRepair' | 'clearing';
export type MemoryModelCapability =
  | { readonly status: 'unconfigured' }
  | { readonly status: 'configured'; readonly selection: ModelSelection }
  | { readonly status: 'unavailable'; readonly selection: ModelSelection; readonly message: string };

export interface MemoryStatus {
  readonly generateMemories: boolean;
  readonly useMemories: boolean;
  readonly extractModel: MemoryModelCapability;
  readonly consolidationModel: MemoryModelCapability;
  readonly artifactState: MemoryArtifactState;
  readonly dirty: boolean;
  readonly dirtyRevision: number;
  readonly processedRevision: number;
  readonly successfulSnapshotId?: string;
  readonly sourceCount: number;
  readonly recentRuns: readonly MemoryRun[];
}

export interface MemoryHost {
  /** Notifications are hints; callers query persisted state and unsubscribe when released. */
  subscribeChanges(handler: (event: MemoryChanged) => void): () => void;
  /** Creates an execution-local consumer; this does not generate knowledge. */
  createTaskMemory(request: TaskMemoryInput): TaskMemory;
  /** Replays only persisted host-verified reply evidence; never accepts model-supplied counters. */
  recordUsage(): MemoryUsageResult;
  searchDocuments: ReturnType<typeof createMemoryQueries>['searchDocuments'];
  readSource: ReturnType<typeof createMemoryQueries>['readSource'];
  getStatus(): { readonly status: 'ok'; readonly memory: MemoryStatus }
    | { readonly status: 'failed'; readonly error: { readonly code: 'SETTINGS_INVALID' | 'STORAGE_FAILED'; readonly message: string } };
  startGeneration(request: MemoryGenerationRequest): MemoryStartResult;
  getRun(runId: string): MemoryRun | undefined;
  waitRun(request: { runId: string; timeoutMs?: number; signal?: AbortSignal }): Promise<MemoryWaitResult>;
  cancelRun(request: { requestId: string; runId: string }): { status: 'cancelling' | 'alreadyFinished' | 'notFound' } | MemoryFailure;
  listDocuments(request?: { cursor?: string; limit?: number }): { status: 'ok'; documents: readonly { path: string; version: string; readOnly: boolean }[]; nextCursor?: string } | MemoryFailure;
  readDocument(request: { path: string; startLine?: number; lineCount?: number; startCharacter?: number; expectedVersion?: string }): { status: 'found'; document: MemoryDocumentSlice } | { status: 'notFound' } | MemoryFailure;
  updateDocument(request: { requestId: string; path: string; content: string; expectedVersion: string }): { status: 'saved'; document: MemoryDocument } | MemoryFailure;
  listSources(request?: { cursor?: string; limit?: number }): { status: 'ok'; sources: readonly MemoryManagedSource[]; nextCursor?: string } | MemoryFailure;
  setSourceEligibility(request: { requestId: string; sessionId: string; eligibility: 'eligible' | 'excluded'; expectedVersion: number }): { status: 'saved'; version: number; maintenance: 'pending' | 'pendingModel' | 'notRequired'; runId?: string } | MemoryFailure;
  clearMemory(request: { requestId: string; confirmed: true }): MemoryStartResult;
  shutdown(): Promise<void>;
}

export interface MemoryFailure { readonly status: 'failed'; readonly error: { readonly code: string; readonly message: string } }
export interface MemoryGenerationRequest { readonly requestId: string; readonly reason: 'startup' | 'manual' | 'retry'; readonly failedJobId?: string; readonly triggerSessionId?: string }
export type MemoryStartResult = { readonly status: 'started' | 'reused'; readonly runId: string } | { readonly status: 'skipped'; readonly reason: 'disabled' | 'stopped' } | MemoryFailure;
export interface MemoryRun {
  readonly runId: string; readonly status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  readonly kind: string; readonly createdAt: string; readonly completedAt?: string;
  readonly result?: { readonly result?: 'generated' | 'unchanged' | 'empty' | 'partial'; readonly extractionRunId?: string; readonly error?: MemoryFailure['error'] };
  readonly jobs: readonly MemoryJob[];
}
export interface MemoryJob {
  readonly jobId: string; readonly stage: 'extract' | 'consolidate';
  readonly status: 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'superseded';
  readonly attempt: number; readonly retryGroupId: string; readonly retryOfJobId?: string; readonly retryAt?: string;
  readonly sourceId?: string; readonly sourceVersion?: string; readonly targetRevision?: number;
  readonly error?: MemoryFailure['error'];
  readonly result?: { readonly coverage?: ExtractionCoverage; readonly versions?: Readonly<Record<string, string>>;
    readonly inputTokens?: number; readonly outputTokens?: number; readonly modelCalls?: number; readonly durationMs?: number };
}
export type MemoryWaitResult = { readonly status: 'completed' | 'timeout'; readonly run: MemoryRun } | { readonly status: 'notFound' } | MemoryFailure;
export interface MemoryManagedSource { readonly sessionId: string; readonly title: string; readonly workspaceId: string; readonly contentUpdatedAt: string; readonly sourceRef?: string; readonly eligibility: 'eligible' | 'excluded'; readonly version: number; readonly usageCount: number; readonly lastUsedAt?: string; readonly selected: boolean; readonly extractionVersion?: string }
