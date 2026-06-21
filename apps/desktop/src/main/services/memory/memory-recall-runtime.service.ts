// Desktop Main orchestrates long-term memory recall for session runs.
// SQLite remains authoritative; Markdown is synced before recall; failures are best-effort.
import {
  buildMemoryRecallSnapshot,
  selectMemoryRecallResults,
} from '@megumi/memory';
import type { ModelInputMemoryRecallSource } from '@megumi/coding-agent/context';
import type { ModelInputContextBuildRequest } from '@megumi/shared/model';
import type { JsonObject, JsonValue } from '@megumi/shared/primitives';
import type {
  MemoryAccessLog,
  MemoryAuditLog,
  MemoryKind,
  MemoryRecallRequest,
  MemoryRecallResult,
  MemoryRecallSnapshot,
  MemoryRecord,
  MemoryRecordStatus,
  MemoryScope,
} from '@megumi/shared/memory';
import type { MemoryDiagnosticWriter } from './memory-diagnostic-writer.service';
import type { MemoryMarkdownSyncResult } from './memory-markdown-sync.service';

export interface MemoryRecallRuntimeRepository {
  listMemories(filter?: {
    scope?: MemoryScope;
    projectId?: string | null;
    status?: MemoryRecordStatus;
    kind?: MemoryKind;
    query?: string;
    limit?: number;
  }): MemoryRecord[];
  saveMemory(memory: MemoryRecord): MemoryRecord;
  saveRecallRequest(request: MemoryRecallRequest): MemoryRecallRequest;
  saveRecallResult(result: MemoryRecallResult): MemoryRecallResult;
  saveAccessLog(accessLog: MemoryAccessLog): MemoryAccessLog;
  saveAuditLog(auditLog: MemoryAuditLog): MemoryAuditLog;
}

export interface MemoryRecallRuntimeSyncService {
  syncBeforeRecall(input: { homePath: string; projectId?: string | null }): Promise<MemoryMarkdownSyncResult>;
}

export interface RecallForNewUserInput {
  enabled?: boolean;
  homePath: string;
  sessionId: string;
  runId: string;
  modelStepId?: string | null;
  projectId?: string | null;
  effectiveCwd?: string | null;
  queryText: string;
  providerId?: string | null;
  modelId?: string | null;
  maxResults?: number;
  maxTokens?: number;
  createdAt?: string;
  toolSummaryMetadata?: JsonObject;
}

export type MemoryRecallRuntimeResult =
  | {
      status: 'recalled';
      snapshot: MemoryRecallSnapshot;
      memoryRecallSources: ModelInputMemoryRecallSource[];
      memoryRecallSeed: ModelInputContextBuildRequest['memoryRecallSeed'];
    }
  | {
      status: 'skipped';
      reason: 'memory_disabled' | 'empty_query';
      memoryRecallSources: [];
      memoryRecallSeed?: ModelInputContextBuildRequest['memoryRecallSeed'];
    }
  | {
      status: 'degraded';
      reason: string;
      memoryRecallSources: [];
      memoryRecallSeed?: ModelInputContextBuildRequest['memoryRecallSeed'];
    };

export interface MemoryRecallRuntimeServiceOptions {
  repository: MemoryRecallRuntimeRepository;
  markdownSync: MemoryRecallRuntimeSyncService;
  diagnostics: Pick<MemoryDiagnosticWriter, 'write'>;
  clock: { now(): string };
  ids: {
    recallRequestId(): string;
    snapshotId(): string;
    accessLogId(): string;
    auditId(): string;
  };
}

const DEFAULT_MAX_RESULTS = 8;
const DEFAULT_MAX_TOKENS = 1024;

export class MemoryRecallRuntimeService {
  constructor(private readonly options: MemoryRecallRuntimeServiceOptions) {}

  async recallForNewUserInput(input: RecallForNewUserInput): Promise<MemoryRecallRuntimeResult> {
    const queryText = input.queryText.trim();
    if (input.enabled === false) {
      return { status: 'skipped', reason: 'memory_disabled', memoryRecallSources: [] };
    }
    if (!queryText) {
      return { status: 'skipped', reason: 'empty_query', memoryRecallSources: [] };
    }

    const createdAt = input.createdAt ?? this.options.clock.now();
    const recallRequestId = this.options.ids.recallRequestId();
    const requestedScopes: MemoryScope[] = input.projectId ? ['user', 'project'] : ['user'];

    try {
      await this.syncBeforeRecall(input, createdAt);

      const request = this.options.repository.saveRecallRequest({
        recallRequestId,
        runId: input.runId,
        sessionId: input.sessionId,
        projectId: input.projectId ?? null,
        queryText,
        requestedScopes,
        maxResults: input.maxResults ?? DEFAULT_MAX_RESULTS,
        createdAt,
        metadata: cleanJsonObject({
          providerId: input.providerId ?? undefined,
          modelId: input.modelId ?? undefined,
          modelStepId: input.modelStepId ?? undefined,
          effectiveCwd: input.effectiveCwd ?? undefined,
          maxTokens: input.maxTokens ?? DEFAULT_MAX_TOKENS,
          toolSummaryMetadata: input.toolSummaryMetadata,
        }),
      });
      this.saveAuditSafe({
        operation: 'recall_requested',
        targetKind: 'recall',
        targetId: request.recallRequestId,
        runId: input.runId,
        sessionId: input.sessionId,
        projectId: input.projectId ?? null,
        reason: 'new_user_input',
        createdAt,
        metadata: {
          requestedScopes,
          maxResults: request.maxResults,
          maxTokens: input.maxTokens ?? DEFAULT_MAX_TOKENS,
        },
      });

      const records = this.listRecallCandidates(input);
      const results = selectMemoryRecallResults({
        recallRequestId,
        records,
        projectId: input.projectId ?? null,
        query: queryText,
        limit: input.maxResults ?? DEFAULT_MAX_RESULTS,
        budget: input.maxTokens ?? DEFAULT_MAX_TOKENS,
        now: createdAt,
      });
      for (const result of results) {
        this.options.repository.saveRecallResult(result);
      }

      const snapshot = buildMemoryRecallSnapshot({
        snapshotId: this.options.ids.snapshotId(),
        recallRequestId,
        sessionId: input.sessionId,
        runId: input.runId,
        projectId: input.projectId ?? null,
        query: queryText,
        records,
        maxResults: input.maxResults ?? DEFAULT_MAX_RESULTS,
        maxTokens: input.maxTokens ?? DEFAULT_MAX_TOKENS,
        now: createdAt,
      });
      this.persistSelectedAccess(input, snapshot, records, createdAt);
      if (snapshot.selected.length > 0) {
        this.saveAuditSafe({
          operation: 'recall_selected',
          targetKind: 'recall',
          targetId: recallRequestId,
          runId: input.runId,
          sessionId: input.sessionId,
          projectId: input.projectId ?? null,
          reason: 'selected_for_context',
          createdAt,
          metadata: {
            selectedCount: snapshot.selected.length,
            memoryIds: snapshot.selected.map((item) => item.memoryId),
            estimatedTokens: snapshot.budget.estimatedTokens,
            truncated: snapshot.budget.truncated,
          },
        });
      }

      return {
        status: 'recalled',
        snapshot,
        memoryRecallSources: toModelInputMemoryRecallSources(snapshot),
        memoryRecallSeed: recallSeed({
          queryText,
          status: 'recalled',
          snapshot,
        }),
      };
    } catch (error) {
      const reason = errorMessage(error);
      this.saveAuditSafe({
        operation: 'recall_failed',
        targetKind: 'recall',
        targetId: recallRequestId,
        runId: input.runId,
        sessionId: input.sessionId,
        projectId: input.projectId ?? null,
        reason,
        createdAt,
        metadata: {},
      });
      await this.writeDiagnosticSafe({
        input,
        createdAt,
        operation: 'memory_recall_failed',
        severity: 'error',
        reason,
        targetId: recallRequestId,
      });
      return {
        status: 'degraded',
        reason,
        memoryRecallSources: [],
        memoryRecallSeed: recallSeed({
          queryText,
          status: 'degraded',
          reason,
        }),
      };
    }
  }

  private async syncBeforeRecall(input: RecallForNewUserInput, createdAt: string): Promise<void> {
    try {
      const result = await this.options.markdownSync.syncBeforeRecall({
        homePath: input.homePath,
        projectId: input.projectId ?? null,
      });
      if (result.status === 'degraded') {
        await this.writeDiagnosticSafe({
          input,
          createdAt,
          operation: 'memory_recall_sync_degraded',
          severity: 'warning',
          reason: result.reason,
          metadata: { syncStatus: result.status },
        });
      }
    } catch (error) {
      await this.writeDiagnosticSafe({
        input,
        createdAt,
        operation: 'memory_recall_sync_degraded',
        severity: 'warning',
        reason: errorMessage(error),
      });
    }
  }

  private listRecallCandidates(input: RecallForNewUserInput): MemoryRecord[] {
    const userRecords = this.options.repository.listMemories({
      scope: 'user',
      projectId: null,
      status: 'active',
    });
    if (!input.projectId) {
      return userRecords;
    }
    const projectRecords = this.options.repository.listMemories({
      scope: 'project',
      projectId: input.projectId,
      status: 'active',
    });
    return [...userRecords, ...projectRecords];
  }

  private persistSelectedAccess(
    input: RecallForNewUserInput,
    snapshot: MemoryRecallSnapshot,
    records: MemoryRecord[],
    createdAt: string,
  ): void {
    const recordById = new Map(records.map((record) => [record.memoryId, record]));
    for (const selected of snapshot.selected) {
      this.options.repository.saveAccessLog({
        accessLogId: this.options.ids.accessLogId(),
        memoryId: selected.memoryId,
        sessionId: input.sessionId,
        runId: input.runId,
        recallRequestId: snapshot.recallRequestId,
        accessKind: 'selected_for_context',
        accessedAt: createdAt,
        selectedForContext: true,
        metadata: {
          scope: selected.scope,
          kind: selected.kind,
          score: selected.score,
          tokenEstimate: selected.tokenEstimate ?? 0,
        },
      });
      const record = recordById.get(selected.memoryId);
      if (record) {
        this.options.repository.saveMemory({
          ...record,
          lastUsedAt: createdAt,
          useCount: (record.useCount ?? 0) + 1,
        });
      }
    }
  }

  private saveAuditSafe(input: {
    operation: MemoryAuditLog['operation'];
    targetKind: MemoryAuditLog['targetKind'];
    targetId?: string | null;
    runId?: string | null;
    sessionId?: string | null;
    projectId?: string | null;
    reason?: string | null;
    createdAt: string;
    metadata?: Record<string, unknown>;
  }): void {
    try {
      this.options.repository.saveAuditLog({
        auditId: this.options.ids.auditId(),
        operation: input.operation,
        targetKind: input.targetKind,
        targetId: input.targetId ?? null,
        runId: input.runId ?? null,
        sessionId: input.sessionId ?? null,
        projectId: input.projectId ?? null,
        actorKind: 'host',
        reason: input.reason ?? null,
        beforeState: null,
        afterState: null,
        createdAt: input.createdAt,
        metadata: cleanJsonObject(input.metadata ?? {}),
      });
    } catch {
      // Audit failures must not block a normal agent run.
    }
  }

  private async writeDiagnosticSafe(input: {
    input: RecallForNewUserInput;
    createdAt: string;
    operation: string;
    severity: 'info' | 'warning' | 'error';
    targetId?: string | null;
    reason?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    try {
      await this.options.diagnostics.write({
        homePath: input.input.homePath,
        operation: input.operation,
        severity: input.severity,
        createdAt: input.createdAt,
        runId: input.input.runId,
        sessionId: input.input.sessionId,
        projectId: input.input.projectId ?? null,
        targetId: input.targetId ?? null,
        reason: input.reason ?? null,
        metadata: cleanJsonObject(input.metadata ?? {}),
      });
    } catch {
      // Diagnostic persistence is best-effort and must never affect recall.
    }
  }
}

export function toModelInputMemoryRecallSources(
  snapshot: MemoryRecallSnapshot,
): ModelInputMemoryRecallSource[] {
  if (snapshot.selected.length === 0) {
    return [];
  }

  return [{
    sourceId: `memory-recall:${snapshot.snapshotId}`,
    text: [
      'Relevant long-term memory:',
      ...snapshot.selected.map((item, index) =>
        `${index + 1}. [${item.scope}/${item.kind}] ${item.content}`),
    ].join('\n'),
    memoryIds: snapshot.selected.map((item) => item.memoryId),
    loadedAt: snapshot.createdAt,
    metadata: {
      snapshotId: snapshot.snapshotId,
      recallRequestId: snapshot.recallRequestId,
      selectedCount: snapshot.selected.length,
      estimatedTokens: snapshot.budget.estimatedTokens,
      truncated: snapshot.budget.truncated,
    },
  }];
}

function recallSeed(input: {
  queryText: string;
  status: 'recalled' | 'degraded';
  snapshot?: MemoryRecallSnapshot;
  reason?: string;
}): ModelInputContextBuildRequest['memoryRecallSeed'] {
  return {
    queryText: input.queryText,
    metadata: cleanJsonObject({
      status: input.status,
      reason: input.reason,
      snapshotId: input.snapshot?.snapshotId,
      recallRequestId: input.snapshot?.recallRequestId,
      selectedCount: input.snapshot?.selected.length,
    }),
  };
}

const FORBIDDEN_METADATA_KEYS = new Set([
  'content',
  'rawcontent',
  'rawprompt',
  'rawtooloutput',
  'transcript',
  'plaintextsecret',
  'apikey',
  'password',
  'secret',
]);

function cleanJsonObject(value: Record<string, unknown>): JsonObject {
  const output: JsonObject = {};
  for (const [key, child] of Object.entries(value)) {
    if (child === undefined || FORBIDDEN_METADATA_KEYS.has(normalizeMetadataKey(key))) {
      continue;
    }
    const jsonValue = toJsonValue(child);
    if (jsonValue !== undefined) {
      output[key] = jsonValue;
    }
  }
  return output;
}

function toJsonValue(value: unknown): JsonValue | undefined {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(toJsonValue).filter((item): item is JsonValue => item !== undefined);
  }
  if (value && typeof value === 'object') {
    return cleanJsonObject(value as Record<string, unknown>);
  }
  return undefined;
}

function normalizeMetadataKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}
