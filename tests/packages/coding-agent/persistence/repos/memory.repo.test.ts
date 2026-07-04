import { afterEach, describe, expect, it } from 'vitest';

import { createDatabase, type MegumiDatabase } from '@megumi/coding-agent/persistence/connection';
import { MemoryRepository } from '@megumi/coding-agent/persistence/repos/memory.repo';
import { applyCodingAgentDatabaseMigrations } from '@megumi/coding-agent/persistence/schema/migrate';
import type {
  MemoryMarkdownMirror,
  MemoryRecallRequest,
  MemoryRecallResult,
  MemoryRecord,
  MemorySourceRef,
} from '@megumi/shared/memory';

const now = '2026-06-12T00:00:00.000Z';
let database: MegumiDatabase | undefined;

afterEach(() => {
  database?.close();
  database = undefined;
});

function createRepository(): MemoryRepository {
  database = createDatabase(':memory:');
  applyCodingAgentDatabaseMigrations(database);
  seedLifecycle(database);
  return new MemoryRepository(database);
}

describe('MemoryRepository', () => {
  it('writes accepted memory into memory_records with source and evidence JSON', () => {
    const repo = createRepository();
    const memory = memoryRecord();

    expect(repo.saveMemory(memory)).toEqual(memory);
    expect(repo.getMemory(memory.memoryId)).toEqual(memory);
    expect(repo.listMemories({
      scope: 'project',
      projectId: 'workspace:1',
      status: 'active',
      kind: 'decision',
    })).toEqual([memory]);
    expect(repo.findActiveMemoryByDedupeKey({
      scope: 'project',
      projectId: 'workspace:1',
      kind: 'decision',
      dedupeKey: memory.dedupeKey,
    })).toEqual(memory);

    const row = currentDb().prepare('SELECT source_json, evidence_json FROM memory_records WHERE memory_id = ?')
      .get(memory.memoryId) as { source_json: string; evidence_json: string };
    expect(JSON.parse(row.source_json)).toEqual({ source: 'capture' });
    expect(JSON.parse(row.evidence_json)).toEqual(memory.evidence);
  });

  it('records recall request and results as one memory_recall_traces row', () => {
    const repo = createRepository();
    const trace = {
      recallTraceId: 'memory-recall:1',
      runId: 'run:1',
      sessionId: 'session:1',
      projectId: 'workspace:1',
      queryText: 'How should tests be written?',
      request: recallRequest(),
      results: [recallResult()],
      createdAt: now,
      metadata: { source: 'test' },
    };

    expect(repo.recordRecallTrace(trace)).toEqual({
      ...trace,
      selectedCount: 1,
    });
    expect(repo.getRecallTrace('memory-recall:1')).toEqual({
      ...trace,
      selectedCount: 1,
    });

    const row = currentDb().prepare('SELECT selected_count, request_json, results_json FROM memory_recall_traces WHERE recall_trace_id = ?')
      .get('memory-recall:1') as { selected_count: number; request_json: string; results_json: string };
    expect(row.selected_count).toBe(1);
    expect(JSON.parse(row.request_json)).toEqual(recallRequest());
    expect(JSON.parse(row.results_json)).toEqual([recallResult()]);
  });

  it('records automatic capture attempts in memory_capture_attempts', () => {
    const repo = createRepository();
    const attempt = {
      captureAttemptId: 'memory-capture:1',
      runId: 'run:1',
      workspaceId: 'workspace:1',
      sessionId: 'session:1',
      status: 'captured',
      triggerKind: 'run_completed',
      extractedCount: 1,
      createdMemoryIds: ['memory:1'],
      rawOutput: { candidates: 1 },
      createdAt: now,
      completedAt: now,
      metadata: { signal: 'confirmed_decision' },
    };

    expect(repo.recordCaptureAttempt(attempt)).toEqual(attempt);
    expect(repo.getCaptureAttempt('memory-capture:1')).toEqual(attempt);
    expect(repo.listCaptureAttempts({ triggerKind: 'run_completed', status: 'captured' })).toEqual([attempt]);

    const row = currentDb().prepare('SELECT created_memory_ids_json, raw_output_json FROM memory_capture_attempts WHERE capture_attempt_id = ?')
      .get('memory-capture:1') as { created_memory_ids_json: string; raw_output_json: string };
    expect(JSON.parse(row.created_memory_ids_json)).toEqual(['memory:1']);
    expect(JSON.parse(row.raw_output_json)).toEqual({ candidates: 1 });
  });

  it('round-trips markdown mirror state through memory_markdown_mirrors', () => {
    const repo = createRepository();
    const mirror: MemoryMarkdownMirror = {
      mirrorId: 'mirror:1',
      scope: 'project',
      projectId: 'workspace:1',
      filePath: 'C:/repo/.megumi/memory/projects/project-1/memory.md',
      status: 'dirty',
      lastImportedAt: now,
      lastExportedAt: now,
      contentHash: 'hash:1',
      lastError: null,
      metadata: { source: 'test' },
    };

    repo.saveMarkdownMirror(mirror);

    expect(repo.getMarkdownMirror(mirror.mirrorId)).toEqual(mirror);
    expect(repo.listMarkdownMirrors({ scope: 'project', projectId: 'workspace:1', status: 'dirty' })).toEqual([mirror]);
  });

  it('keeps source refs on memory metadata and does not expose candidate/access/audit persistence APIs', () => {
    const repo = createRepository();
    const memory = repo.saveMemory(memoryRecord());
    const ref: MemorySourceRef = {
      sourceRefId: 'memory-source:1',
      ownerId: memory.memoryId,
      ownerKind: 'memory',
      kind: 'message',
      refId: 'message:1',
      label: 'safe source',
      excerptPreview: 'safe preview',
      createdAt: now,
    };

    expect(repo.saveSourceRef(ref)).toEqual(ref);
    expect(repo.listSourceRefsByOwner(memory.memoryId, 'memory')).toEqual([ref]);

    const publicNames = Object.getOwnPropertyNames(MemoryRepository.prototype);
    expect(publicNames).not.toEqual(expect.arrayContaining([
      'saveCandidate',
      'getCandidate',
      'listCandidates',
      'saveAccessLog',
      'listAccessLogs',
      'saveAuditLog',
      'listAuditLogs',
      'saveRecallRequest',
      'saveRecallResult',
      'listRecallResultsByRequest',
    ]));
  });
});

function currentDb(): MegumiDatabase {
  if (!database) {
    throw new Error('Test database is not initialized.');
  }
  return database;
}

function memoryRecord(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    memoryId: 'memory:1',
    scope: 'project',
    projectId: 'workspace:1',
    kind: 'decision',
    status: 'active',
    content: 'Use Vitest for unit tests.',
    summary: 'Testing framework decision',
    normalizedText: 'use vitest for unit tests',
    dedupeKey: 'project:workspace:1:decision:use-vitest',
    source: 'capture',
    sourceRunId: 'run:1',
    sourceSessionId: 'session:1',
    sourceMessageId: 'message:1',
    sourceToolCallId: 'tool-call:1',
    evidence: [{
      kind: 'message',
      runId: 'run:1',
      sessionId: 'session:1',
      messageId: 'message:1',
      metadata: {},
    }],
    supersededById: null,
    createdAt: now,
    updatedAt: now,
    lastUsedAt: now,
    useCount: 2,
    deletedAt: null,
    metadata: { source: 'test' },
    ...overrides,
  };
}

function recallRequest(overrides: Partial<MemoryRecallRequest> = {}): MemoryRecallRequest {
  return {
    recallRequestId: 'memory-recall:1',
    runId: 'run:1',
    sessionId: 'session:1',
    projectId: 'workspace:1',
    queryText: 'How should tests be written?',
    requestedScopes: ['user', 'project'],
    requestedKinds: ['decision'],
    maxResults: 8,
    createdAt: now,
    metadata: { source: 'test' },
    ...overrides,
  };
}

function recallResult(overrides: Partial<MemoryRecallResult> = {}): MemoryRecallResult {
  return {
    recallResultId: 'memory-recall-result:1',
    recallRequestId: 'memory-recall:1',
    memoryId: 'memory:1',
    score: 0.82,
    rank: 1,
    selectedForContext: true,
    reason: 'query_match',
    createdAt: now,
    metadata: {},
    ...overrides,
  };
}

function seedLifecycle(db: MegumiDatabase): void {
  db.exec(`
    INSERT INTO workspaces (
      workspace_id, name, root_path, root_path_key, status,
      created_at, updated_at, last_opened_at
    ) VALUES (
      'workspace:1', 'Workspace 1', '/workspace-1', '/workspace-1', 'available',
      '${now}', '${now}', '${now}'
    );

    INSERT INTO sessions (
      session_id, workspace_id, title, status, active_entry_id,
      created_at, updated_at, archived_at, metadata_json
    ) VALUES (
      'session:1', 'workspace:1', 'Memory session', 'active', NULL,
      '${now}', '${now}', NULL, NULL
    );

    INSERT INTO agent_loop_runs (
      run_id, workspace_id, session_id, run_kind, user_message_id,
      assistant_message_id, base_run_id, base_message_id, base_entry_id,
      attempt_number, status, permission_mode, permission_snapshot_json,
      memory_recall_trace_id, started_at, completed_at, cancelled_at,
      error_json, created_at, metadata_json
    ) VALUES (
      'run:1', 'workspace:1', 'session:1', 'input', NULL, NULL,
      NULL, NULL, NULL, 1, 'running', 'chat', NULL, NULL,
      '${now}', NULL, NULL, NULL, '${now}', NULL
    );

    INSERT INTO session_messages (
      message_id, session_id, run_id, role, content_text,
      created_at, completed_at
    ) VALUES (
      'message:1', 'session:1', 'run:1', 'user',
      'Remember the test decision.', '${now}', '${now}'
    );

    INSERT INTO model_calls (
      model_call_id, run_id, call_order, provider_id, model_id, status,
      input_summary_json, context_snapshot_json, request_json, response_json,
      output_summary_json, token_usage_json, started_at, completed_at,
      error_json, metadata_json
    ) VALUES (
      'model-call:1', 'run:1', 1, 'openai-compatible', 'gpt-5', 'completed',
      NULL, NULL, NULL, NULL, NULL, NULL, '${now}', '${now}', NULL, NULL
    );

    INSERT INTO tool_calls (
      tool_call_id, run_id, model_call_id, call_order, provider_tool_call_id,
      tool_source_id, tool_name, model_visible_name, input_json, input_preview,
      status, permission_decision_json, approval_request_id, result_json,
      result_preview, observation_json, submitted_to_model_at, started_at,
      completed_at, error_json, metadata_json
    ) VALUES (
      'tool-call:1', 'run:1', 'model-call:1', 1, 'provider-tool-call:1',
      NULL, 'read_file', 'read_file', '{}', NULL, 'completed',
      NULL, NULL, NULL, NULL, NULL, NULL, '${now}', '${now}', NULL, NULL
    );
  `);
}
