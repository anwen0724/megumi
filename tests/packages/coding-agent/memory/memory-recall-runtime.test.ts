// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  MemoryRecallRuntimeService,
  toModelInputMemoryRecallSources,
  type MemoryRecallRuntimeCaptureAttempt,
  type MemoryRecallRuntimeRepository,
  type MemoryRecallRuntimeTrace,
} from '@megumi/coding-agent/memory';
import type { MemoryDiagnosticWriterPort, MemoryMarkdownSyncResult } from '@megumi/coding-agent/memory';
import type {
  MemoryAccessLog,
  MemoryAuditLog,
  MemoryKind,
  MemoryMarkdownMirror,
  MemoryRecallRequest,
  MemoryRecallResult,
  MemoryRecord,
  MemoryRecordStatus,
  MemoryScope,
} from '@megumi/coding-agent/memory/legacy-contracts/memory-contracts';

const now = '2026-06-13T10:00:00.000Z';

describe('MemoryRecallRuntimeService', () => {
  it('syncs before DB recall, continues after degraded sync, and recalls active user plus current project memories only', async () => {
    const user = memoryRecord({
      memoryId: 'memory:user:1',
      scope: 'user',
      projectId: null,
      kind: 'preference',
      content: 'User prefers concise pnpm answers.',
    });
    const project = memoryRecord({
      memoryId: 'memory:project:1',
      scope: 'project',
      projectId: 'project:1',
      kind: 'decision',
      content: 'Project uses pnpm for package scripts.',
    });
    const repo = createRepo([user, project]);
    const operationOrder: string[] = [];
    repo.onListMemories = () => operationOrder.push('listMemories');
    const sync = {
      syncBeforeRecall: vi.fn(async (): Promise<MemoryMarkdownSyncResult> => {
        operationOrder.push('syncBeforeRecall');
        return { status: 'degraded', reason: 'markdown_import_failed' };
      }),
    };
    const diagnostics = createDiagnostics();
    const service = new MemoryRecallRuntimeService({
      repository: repo,
      markdownSync: sync,
      diagnostics,
      clock: { now: () => now },
      ids: fixedIds(),
    });

    const result = await service.recallForNewUserInput({
      homePath: 'C:/megumi-home',
      sessionId: 'session:1',
      runId: 'run:1',
      projectId: 'project:1',
      effectiveCwd: 'C:/project',
      queryText: 'How should I run pnpm tests?',
      providerId: 'openai',
      modelId: 'gpt-4.1',
    });

    expect(result.status).toBe('recalled');
    expect(operationOrder[0]).toBe('syncBeforeRecall');
    expect(operationOrder.slice(1)).toEqual(['listMemories', 'listMemories']);
    expect(sync.syncBeforeRecall).toHaveBeenCalledWith({
      homePath: 'C:/megumi-home',
      projectId: 'project:1',
    });
    expect(repo.listCalls).toEqual([
      { scope: 'user', projectId: null, status: 'active' },
      { scope: 'project', projectId: 'project:1', status: 'active' },
    ]);
    expect(result.memoryRecallSources).toHaveLength(1);
    expect(result.memoryRecallSources[0]).toMatchObject({
      sourceId: 'memory-recall:memory-recall-snapshot:1',
      memoryIds: ['memory:project:1', 'memory:user:1'],
      metadata: {
        snapshotId: 'memory-recall-snapshot:1',
        recallRequestId: 'memory-recall-request:1',
        selectedCount: 2,
      },
    });
    expect(result.memoryRecallSeed).toEqual({
      queryText: 'How should I run pnpm tests?',
      metadata: {
        snapshotId: 'memory-recall-snapshot:1',
        recallRequestId: 'memory-recall-request:1',
        selectedCount: 2,
        status: 'recalled',
      },
    });
    expect(repo.recallRequests).toEqual([
      expect.objectContaining({
        recallRequestId: 'memory-recall-request:1',
        requestedScopes: ['user', 'project'],
        queryText: 'How should I run pnpm tests?',
        metadata: expect.objectContaining({
          providerId: 'openai',
          modelId: 'gpt-4.1',
          effectiveCwd: 'C:/project',
        }),
      }),
    ]);
    expect(repo.recallResults.map((entry) => entry.memoryId)).toEqual(['memory:project:1', 'memory:user:1']);
    expect(repo.accessLogs).toEqual([
      expect.objectContaining({
        accessLogId: 'memory-access:1',
        memoryId: 'memory:project:1',
        accessKind: 'selected_for_context',
        selectedForContext: true,
      }),
      expect.objectContaining({
        accessLogId: 'memory-access:2',
        memoryId: 'memory:user:1',
        accessKind: 'selected_for_context',
        selectedForContext: true,
      }),
    ]);
    expect(repo.savedMemories.map((entry) => [entry.memoryId, entry.lastUsedAt, entry.useCount])).toEqual([
      ['memory:project:1', now, 1],
      ['memory:user:1', now, 1],
    ]);
    expect(repo.auditLogs.map((entry) => entry.operation)).toEqual(['recall_requested', 'recall_selected']);
    expect(JSON.stringify(repo.auditLogs)).not.toContain('User prefers concise pnpm answers.');
    expect(diagnostics.write).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'memory_recall_sync_degraded',
      reason: 'markdown_import_failed',
    }));
  });

  it('continues DB recall when sync is degraded and diagnostic writing fails', async () => {
    const repo = createRepo([
      memoryRecord({
        memoryId: 'memory:user:1',
        scope: 'user',
        projectId: null,
        content: 'User prefers pnpm.',
      }),
    ]);
    const sync = {
      syncBeforeRecall: vi.fn(async (): Promise<MemoryMarkdownSyncResult> => ({
        status: 'degraded',
        reason: 'markdown_import_failed',
      })),
    };
    const diagnostics = createFailingDiagnostics();
    const service = createService({ repo, sync, diagnostics });

    const result = await service.recallForNewUserInput({
      homePath: 'C:/megumi-home',
      sessionId: 'session:1',
      runId: 'run:1',
      queryText: 'pnpm',
    });

    expect(result.status).toBe('recalled');
    expect(repo.listCalls).toEqual([
      { scope: 'user', projectId: null, status: 'active' },
    ]);
    expect(result.memoryRecallSources[0]?.text).toContain('User prefers pnpm.');
    expect(diagnostics.write).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'memory_recall_sync_degraded',
      reason: 'markdown_import_failed',
    }));
  });

  it('does not query project memories when projectId is absent', async () => {
    const repo = createRepo([
      memoryRecord({
        memoryId: 'memory:user:1',
        scope: 'user',
        projectId: null,
        content: 'User prefers npm.',
      }),
    ]);
    const service = createService({ repo });

    const result = await service.recallForNewUserInput({
      homePath: 'C:/megumi-home',
      sessionId: 'session:1',
      runId: 'run:1',
      queryText: 'npm',
    });

    expect(result.status).toBe('recalled');
    expect(repo.listCalls).toEqual([
      { scope: 'user', projectId: null, status: 'active' },
    ]);
    expect(repo.recallRequests[0]?.requestedScopes).toEqual(['user']);
  });

  it('returns degraded and writes safe diagnostics when repository reads fail', async () => {
    const repo = createRepo([]);
    repo.listMemories = vi.fn(() => {
      throw new Error('database is locked');
    });
    const diagnostics = createDiagnostics();
    const service = createService({ repo, diagnostics });

    const result = await service.recallForNewUserInput({
      homePath: 'C:/megumi-home',
      sessionId: 'session:1',
      runId: 'run:1',
      projectId: 'project:1',
      queryText: 'pnpm',
    });

    expect(result).toEqual({
      status: 'degraded',
      reason: 'database is locked',
      memoryRecallSources: [],
      memoryRecallSeed: {
        queryText: 'pnpm',
        metadata: {
          status: 'degraded',
          reason: 'database is locked',
        },
      },
    });
    expect(diagnostics.write).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'memory_recall_failed',
      severity: 'error',
      reason: 'database is locked',
    }));
    expect(repo.auditLogs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        operation: 'recall_requested',
        targetKind: 'recall',
      }),
      expect.objectContaining({
        operation: 'recall_failed',
        targetKind: 'recall',
        reason: 'database is locked',
      }),
    ]));
    expect(JSON.stringify(diagnostics.write.mock.calls)).not.toContain('pnpm');
  });

  it('returns degraded instead of throwing when repository reads and diagnostic writing both fail', async () => {
    const repo = createRepo([]);
    repo.listMemories = vi.fn(() => {
      throw new Error('database is locked');
    });
    const diagnostics = createFailingDiagnostics();
    const service = createService({ repo, diagnostics });

    const result = await service.recallForNewUserInput({
      homePath: 'C:/megumi-home',
      sessionId: 'session:1',
      runId: 'run:1',
      projectId: 'project:1',
      queryText: 'pnpm',
    });

    expect(result).toEqual({
      status: 'degraded',
      reason: 'database is locked',
      memoryRecallSources: [],
      memoryRecallSeed: {
        queryText: 'pnpm',
        metadata: {
          status: 'degraded',
          reason: 'database is locked',
        },
      },
    });
    expect(diagnostics.write).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'memory_recall_failed',
      severity: 'error',
      reason: 'database is locked',
    }));
    expect(repo.auditLogs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        operation: 'recall_failed',
        reason: 'database is locked',
      }),
    ]));
  });

  it('skips disabled or empty recalls without syncing or reading the repository', async () => {
    const repo = createRepo([]);
    const sync = { syncBeforeRecall: vi.fn(async () => ({ status: 'synced' as const })) };
    const service = createService({ repo, sync });

    await expect(service.recallForNewUserInput({
      enabled: false,
      homePath: 'C:/megumi-home',
      sessionId: 'session:1',
      runId: 'run:1',
      queryText: 'pnpm',
    })).resolves.toEqual({
      status: 'skipped',
      reason: 'memory_disabled',
      memoryRecallSources: [],
    });
    await expect(service.recallForNewUserInput({
      homePath: 'C:/megumi-home',
      sessionId: 'session:1',
      runId: 'run:1',
      queryText: '   ',
    })).resolves.toEqual({
      status: 'skipped',
      reason: 'empty_query',
      memoryRecallSources: [],
    });
    expect(sync.syncBeforeRecall).not.toHaveBeenCalled();
    expect(repo.listCalls).toEqual([]);
    expect(repo.recallRequests).toEqual([]);
  });

  it('converts snapshots into stable hidden model input memory recall sources', () => {
    const sources = toModelInputMemoryRecallSources({
      snapshotId: 'memory-recall-snapshot:1',
      recallRequestId: 'memory-recall-request:1',
      sessionId: 'session:1',
      runId: 'run:1',
      projectId: 'project:1',
      query: 'pnpm',
      selected: [
        {
          memoryId: 'memory:project:1',
          scope: 'project',
          kind: 'decision',
          content: 'Project uses pnpm.',
          reason: 'lexical_match',
          score: 0.8,
          tokenEstimate: 6,
        },
        {
          memoryId: 'memory:user:1',
          scope: 'user',
          kind: 'preference',
          content: 'User prefers concise answers.',
          reason: 'lexical_match',
          score: 0.7,
          tokenEstimate: 7,
        },
      ],
      diagnostics: [],
      budget: {
        maxTokens: 128,
        estimatedTokens: 13,
        truncated: false,
      },
      createdAt: now,
    });

    expect(sources).toEqual([{
      sourceId: 'memory-recall:memory-recall-snapshot:1',
      text: [
        'Relevant long-term memory:',
        '1. [project/decision] Project uses pnpm.',
        '2. [user/preference] User prefers concise answers.',
      ].join('\n'),
      memoryIds: ['memory:project:1', 'memory:user:1'],
      loadedAt: now,
      metadata: {
        snapshotId: 'memory-recall-snapshot:1',
        recallRequestId: 'memory-recall-request:1',
        selectedCount: 2,
        estimatedTokens: 13,
        truncated: false,
      },
    }]);
  });
});

function createService(input: {
  repo?: FakeMemoryRecallRuntimeRepository;
  sync?: { syncBeforeRecall(input: { homePath: string; projectId?: string | null }): Promise<MemoryMarkdownSyncResult> };
  diagnostics?: ReturnType<typeof createDiagnostics>;
} = {}): MemoryRecallRuntimeService {
  return new MemoryRecallRuntimeService({
    repository: input.repo ?? createRepo([]),
    markdownSync: input.sync ?? {
      syncBeforeRecall: vi.fn(async (): Promise<MemoryMarkdownSyncResult> => ({ status: 'synced' })),
    },
    diagnostics: input.diagnostics ?? createDiagnostics(),
    clock: { now: () => now },
    ids: fixedIds(),
  });
}

function createDiagnostics() {
  return {
    write: vi.fn(async () => undefined),
  } satisfies MemoryDiagnosticWriterPort;
}

function createFailingDiagnostics() {
  return {
    write: vi.fn(async () => {
      throw new Error('diagnostic writer unavailable');
    }),
  } satisfies MemoryDiagnosticWriterPort;
}

function fixedIds() {
  let access = 0;
  return {
    recallRequestId: () => 'memory-recall-request:1',
    snapshotId: () => 'memory-recall-snapshot:1',
    accessLogId: () => {
      access += 1;
      return `memory-access:${access}`;
    },
    auditId: (() => {
      let audit = 0;
      return () => {
        audit += 1;
        return `memory-audit:${audit}`;
      };
    })(),
  };
}

class FakeMemoryRecallRuntimeRepository implements MemoryRecallRuntimeRepository {
  listCalls: Array<{
    scope?: MemoryScope;
    projectId?: string | null;
    status?: MemoryRecordStatus;
    kind?: MemoryKind;
  }> = [];
  recallRequests: MemoryRecallRequest[] = [];
  recallResults: MemoryRecallResult[] = [];
  accessLogs: MemoryAccessLog[] = [];
  auditLogs: MemoryAuditLog[] = [];
  savedMemories: MemoryRecord[] = [];
  onListMemories?: () => void;

  constructor(private readonly records: MemoryRecord[]) {}

  listMemories(filter: {
    scope?: MemoryScope;
    projectId?: string | null;
    status?: MemoryRecordStatus;
    kind?: MemoryKind;
  } = {}) {
    this.onListMemories?.();
    this.listCalls.push(filter);
    return this.records.filter((record) => (
      (filter.scope === undefined || record.scope === filter.scope)
      && (!Object.hasOwn(filter, 'projectId') || (record.projectId ?? null) === (filter.projectId ?? null))
      && (filter.status === undefined || record.status === filter.status)
      && (filter.kind === undefined || record.kind === filter.kind)
    ));
  }

  saveMemory(memory: MemoryRecord): MemoryRecord {
    this.savedMemories.push(memory);
    return memory;
  }

  recordRecallTrace(trace: MemoryRecallRuntimeTrace): MemoryRecallRuntimeTrace {
    this.recallRequests.push(trace.request);
    this.recallResults.push(...trace.results);
    return trace;
  }

  recordCaptureAttempt(attempt: MemoryRecallRuntimeCaptureAttempt): MemoryRecallRuntimeCaptureAttempt {
    if (attempt.triggerKind === 'access_log') {
      const accessLog = attempt.metadata?.accessLog as MemoryAccessLog | undefined;
      if (accessLog) {
        this.accessLogs.push(accessLog);
      }
    }
    if (attempt.triggerKind === 'audit_log') {
      const auditLog = attempt.metadata?.auditLog as MemoryAuditLog | undefined;
      if (auditLog) {
        this.auditLogs.push(auditLog);
      }
    }
    return attempt;
  }

  saveRecallRequest(request: MemoryRecallRequest): MemoryRecallRequest {
    this.recallRequests.push(request);
    return request;
  }

  saveRecallResult(result: MemoryRecallResult): MemoryRecallResult {
    this.recallResults.push(result);
    return result;
  }

  saveAccessLog(accessLog: MemoryAccessLog): MemoryAccessLog {
    this.accessLogs.push(accessLog);
    return accessLog;
  }

  saveAuditLog(auditLog: MemoryAuditLog): MemoryAuditLog {
    this.auditLogs.push(auditLog);
    return auditLog;
  }

  saveMarkdownMirror(_mirror: MemoryMarkdownMirror): void {}
  getMarkdownMirror(_mirrorId: string): MemoryMarkdownMirror | null { return null; }
}

function createRepo(records: MemoryRecord[]): FakeMemoryRecallRuntimeRepository {
  return new FakeMemoryRecallRuntimeRepository(records);
}

function memoryRecord(overrides: Partial<MemoryRecord>): MemoryRecord {
  const memoryId = overrides.memoryId ?? 'memory:1';
  const content = overrides.content ?? 'Project uses pnpm.';
  return {
    memoryId,
    scope: overrides.scope ?? 'project',
    projectId: Object.hasOwn(overrides, 'projectId') ? overrides.projectId : 'project:1',
    kind: overrides.kind ?? 'fact',
    status: overrides.status ?? 'active',
    content,
    summary: overrides.summary ?? content,
    normalizedText: overrides.normalizedText ?? content.toLowerCase(),
    dedupeKey: overrides.dedupeKey ?? `${overrides.scope ?? 'project'}:${overrides.projectId ?? 'project:1'}:${content.toLowerCase()}`,
    source: overrides.source ?? 'manual_system',
    sourceRunId: overrides.sourceRunId ?? null,
    sourceSessionId: overrides.sourceSessionId ?? null,
    sourceMessageId: overrides.sourceMessageId ?? null,
    sourceToolCallId: overrides.sourceToolCallId ?? null,
    evidence: overrides.evidence ?? [],
    supersededById: overrides.supersededById ?? null,
    createdAt: overrides.createdAt ?? '2026-06-12T00:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-06-12T00:00:00.000Z',
    lastUsedAt: overrides.lastUsedAt ?? null,
    useCount: overrides.useCount ?? 0,
    deletedAt: overrides.deletedAt ?? null,
    metadata: overrides.metadata ?? {},
    confidence: overrides.confidence ?? 0.9,
  };
}
