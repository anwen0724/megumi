/* Verifies Memory persists durable records while workflow attempts remain process-local. */
// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase, type MegumiDatabase } from '@megumi/coding-agent/persistence/connection';
import { MemoryRepository } from '@megumi/coding-agent/persistence/repos/memory.repo';
import type { MemoryRecallTrace } from '@megumi/coding-agent/persistence/repos/memory.repo';
import { applyCodingAgentDatabaseMigrations } from '@megumi/coding-agent/persistence/schema';
import type { MemoryMarkdownMirror, MemoryRecord } from '@megumi/coding-agent/memory/legacy-contracts/memory-contracts';

const now = '2026-06-12T00:00:00.000Z';
let database: MegumiDatabase | undefined;

afterEach(() => {
  database?.close();
  database = undefined;
});

describe('MemoryRepository', () => {
  it('round-trips durable Memory and Markdown mirror facts', () => {
    const repo = createRepository();
    const memory = memoryRecord();
    const mirror: MemoryMarkdownMirror = {
      mirrorId: 'mirror:1', scope: 'project', projectId: 'workspace:1',
      filePath: 'C:/repo/.megumi/memory.md', status: 'dirty',
      lastImportedAt: now, lastExportedAt: now, contentHash: 'hash:1',
      lastError: null, metadata: { source: 'test' },
    };

    expect(repo.saveMemory(memory)).toEqual(memory);
    expect(repo.getMemory(memory.memoryId)).toEqual(memory);
    repo.saveMarkdownMirror(mirror);
    expect(repo.getMarkdownMirror(mirror.mirrorId)).toEqual(mirror);
  });

  it('keeps recall and capture workflow state in process memory only', () => {
    const repo = createRepository();
    const attempt = {
      captureAttemptId: 'capture:1', runId: 'run:1', workspaceId: 'workspace:1',
      sessionId: 'session:1', status: 'captured', triggerKind: 'run_completed',
      extractedCount: 1, createdMemoryIds: ['memory:1'], createdAt: now,
      completedAt: now, metadata: {},
    };
    const trace: MemoryRecallTrace = {
      recallTraceId: 'recall:1', runId: 'run:1', sessionId: 'session:1',
      projectId: 'workspace:1', queryText: 'testing', createdAt: now,
      request: {
        recallRequestId: 'recall:1', runId: 'run:1', sessionId: 'session:1',
        projectId: 'workspace:1', queryText: 'testing', requestedScopes: ['project'],
        requestedKinds: ['decision'], maxResults: 8, createdAt: now, metadata: {},
      },
      results: [], metadata: {},
    };

    expect(repo.recordCaptureAttempt(attempt)).toEqual(attempt);
    expect(repo.getCaptureAttempt('capture:1')).toEqual(attempt);
    expect(repo.recordRecallTrace(trace)).toMatchObject({ recallTraceId: 'recall:1', selectedCount: 0 });
    expect(repo.getRecallTrace('recall:1')).toMatchObject({ recallTraceId: 'recall:1' });
    expect(tableExists('memory_capture_attempts')).toBe(false);
    expect(tableExists('memory_recall_traces')).toBe(false);
  });
});

function createRepository(): MemoryRepository {
  database = createDatabase(':memory:');
  applyCodingAgentDatabaseMigrations(database);
  database.exec(`
    INSERT INTO workspaces (
      workspace_id, name, root_path, root_path_key, status, created_at, updated_at, last_opened_at
    ) VALUES ('workspace:1', 'Workspace', '/workspace', '/workspace', 'available', '${now}', '${now}', '${now}');
    INSERT INTO sessions (
      session_id, workspace_id, title, status, active_entry_id, created_at, updated_at, archived_at
    ) VALUES ('session:1', 'workspace:1', 'Session', 'active', NULL, '${now}', '${now}', NULL);
  `);
  return new MemoryRepository(database);
}

function memoryRecord(): MemoryRecord {
  return {
    memoryId: 'memory:1', scope: 'project', projectId: 'workspace:1', kind: 'decision', status: 'active',
    content: 'Use Vitest.', summary: 'Testing decision', normalizedText: 'use vitest',
    dedupeKey: 'project:decision:vitest', source: 'capture', sourceRunId: 'run:1',
    sourceSessionId: 'session:1', evidence: [], supersededById: null,
    createdAt: now, updatedAt: now, lastUsedAt: now, useCount: 1, deletedAt: null,
    metadata: { source: 'test' },
  };
}

function tableExists(table: string): boolean {
  return Boolean(database?.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table));
}
