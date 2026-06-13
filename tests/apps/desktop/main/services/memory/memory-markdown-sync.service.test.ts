import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { MemoryDiagnosticWriter } from '@megumi/desktop/main/services/memory/memory-diagnostic-writer.service';
import { MemoryMarkdownSyncService } from '@megumi/desktop/main/services/memory/memory-markdown-sync.service';
import type { MemoryRuntimeFileSystem } from '@megumi/desktop/main/services/memory/memory-runtime-file-system';
import type {
  MemoryAuditLog,
  MemoryMarkdownMirror,
  MemoryRecord,
  MemoryRecordStatus,
  MemoryScope,
} from '@megumi/shared/memory';

const now = '2026-06-13T10:00:00.000Z';
const homePath = path.resolve('C:/tmp/megumi-home');

class FakeMemoryRuntimeFileSystem implements MemoryRuntimeFileSystem {
  readonly files = new Map<string, string>();
  readonly writes: Array<{ filePath: string; content: string }> = [];
  readonly diagnostics: Array<{ filePath: string; entry: unknown }> = [];
  writeResult: { ok: true } | { ok: false; reason: 'write_failed'; message: string } = { ok: true };

  async readText(filePath: string): ReturnType<MemoryRuntimeFileSystem['readText']> {
    if (!this.files.has(filePath)) {
      return { ok: false, reason: 'not_found', message: 'missing' };
    }
    return { ok: true, content: this.files.get(filePath) ?? '' };
  }

  async writeTextAtomic(filePath: string, content: string): ReturnType<MemoryRuntimeFileSystem['writeTextAtomic']> {
    this.writes.push({ filePath, content });
    if (!this.writeResult.ok) {
      return this.writeResult;
    }
    this.files.set(filePath, content);
    return { ok: true };
  }

  async appendJsonLine(filePath: string, entry: unknown): ReturnType<MemoryRuntimeFileSystem['appendJsonLine']> {
    this.diagnostics.push({ filePath, entry });
    return { ok: true };
  }
}

class FakeMemoryMarkdownSyncRepository {
  readonly memories = new Map<string, MemoryRecord>();
  readonly mirrors = new Map<string, MemoryMarkdownMirror>();
  readonly audits: MemoryAuditLog[] = [];

  listMemories(filter: {
    scope?: MemoryScope;
    projectId?: string | null;
    status?: MemoryRecordStatus;
    kind?: MemoryRecord['kind'];
    query?: string;
    limit?: number;
  } = {}): MemoryRecord[] {
    return [...this.memories.values()]
      .filter((memory) => !filter.scope || memory.scope === filter.scope)
      .filter((memory) => !Object.hasOwn(filter, 'projectId') || (memory.projectId ?? null) === (filter.projectId ?? null))
      .filter((memory) => !filter.status || memory.status === filter.status)
      .filter((memory) => !filter.kind || memory.kind === filter.kind)
      .slice(0, filter.limit ?? 1000);
  }

  getMemory(memoryId: string): MemoryRecord | undefined {
    return this.memories.get(memoryId);
  }

  saveMemory(memory: MemoryRecord): MemoryRecord {
    this.memories.set(memory.memoryId, memory);
    return memory;
  }

  saveMarkdownMirror(mirror: MemoryMarkdownMirror): void {
    this.mirrors.set(mirror.mirrorId, mirror);
  }

  getMarkdownMirror(mirrorId: string): MemoryMarkdownMirror | null {
    return this.mirrors.get(mirrorId) ?? null;
  }

  saveAuditLog(auditLog: MemoryAuditLog): MemoryAuditLog {
    this.audits.push(auditLog);
    return auditLog;
  }
}

function createService() {
  const repository = new FakeMemoryMarkdownSyncRepository();
  const fileSystem = new FakeMemoryRuntimeFileSystem();
  const diagnostics = new MemoryDiagnosticWriter({ fileSystem });
  let memoryIndex = 0;
  let auditIndex = 0;
  const service = new MemoryMarkdownSyncService({
    repository,
    fileSystem,
    diagnostics,
    clock: { now: () => now },
    ids: {
      memoryId: () => `memory:new:${++memoryIndex}`,
      auditId: () => `audit:${++auditIndex}`,
    },
  });
  return { service, repository, fileSystem };
}

function memory(overrides: Partial<MemoryRecord> & Pick<MemoryRecord, 'memoryId' | 'scope' | 'kind' | 'content'>): MemoryRecord {
  const projectId = overrides.scope === 'project' ? overrides.projectId ?? 'project:1' : null;
  const normalizedText = overrides.normalizedText ?? overrides.content.toLowerCase().replace(/\s+/g, ' ');
  return {
    memoryId: overrides.memoryId,
    scope: overrides.scope,
    projectId,
    kind: overrides.kind,
    status: overrides.status ?? 'active',
    content: overrides.content,
    summary: overrides.summary ?? overrides.content,
    normalizedText,
    dedupeKey: overrides.dedupeKey ?? `${overrides.scope}:${projectId ?? ''}:${overrides.kind}:${normalizedText}`,
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

describe('MemoryMarkdownSyncService', () => {
  it('exports only active records with renderer ordering and synced mirror metadata', async () => {
    const { service, repository, fileSystem } = createService();
    repository.saveMemory(memory({
      memoryId: 'memory:old',
      scope: 'project',
      kind: 'preference',
      content: 'Old preference.',
      updatedAt: '2026-06-11T00:00:00.000Z',
    }));
    repository.saveMemory(memory({
      memoryId: 'memory:new',
      scope: 'project',
      kind: 'preference',
      content: 'New preference.',
      updatedAt: '2026-06-12T00:00:00.000Z',
    }));
    repository.saveMemory(memory({
      memoryId: 'memory:constraint',
      scope: 'project',
      kind: 'constraint',
      content: 'Use npm.',
      updatedAt: '2026-06-10T00:00:00.000Z',
    }));
    repository.saveMemory(memory({
      memoryId: 'memory:deleted',
      scope: 'project',
      kind: 'fact',
      content: 'Deleted fact.',
      status: 'deleted',
    }));

    const result = await service.exportMirror({ homePath, scope: 'project', projectId: 'project:1' });

    expect(result.status).toBe('synced');
    expect(fileSystem.writes).toHaveLength(1);
    expect(fileSystem.writes[0]?.filePath).toContain(path.join('memory', 'projects'));
    const markdown = fileSystem.writes[0]?.content ?? '';
    expect(markdown.indexOf('New preference.')).toBeLessThan(markdown.indexOf('Old preference.'));
    expect(markdown.indexOf('## Preference')).toBeLessThan(markdown.indexOf('## Constraint'));
    expect(markdown).toContain('Use npm.');
    expect(markdown).not.toContain('Deleted fact.');
    const mirror = [...repository.mirrors.values()][0];
    expect(mirror).toMatchObject({
      scope: 'project',
      projectId: 'project:1',
      status: 'synced',
      lastExportedAt: now,
      metadata: {
        exportedMemoryIds: ['memory:new', 'memory:old', 'memory:constraint'],
      },
    });
    expect(mirror?.contentHash).toMatch(/^[a-f0-9]{32}$/);
  });

  it('marks missing mirrors without throwing', async () => {
    const { service, repository } = createService();

    const result = await service.importMirror({ homePath, scope: 'user' });

    expect(result).toMatchObject({ status: 'skipped', reason: 'mirror_missing' });
    expect(repository.mirrors.get('memory:user')).toMatchObject({
      scope: 'user',
      status: 'missing',
    });
  });

  it('imports id updates, id-less creates, deleted exported ids, parser diagnostics, then exports canonical markdown', async () => {
    const { service, repository, fileSystem } = createService();
    const existing = memory({
      memoryId: 'memory:existing',
      scope: 'user',
      kind: 'preference',
      content: 'Old concise preference.',
    });
    const removed = memory({
      memoryId: 'memory:removed',
      scope: 'user',
      kind: 'constraint',
      content: 'Old constraint.',
    });
    repository.saveMemory(existing);
    repository.saveMemory(removed);
    repository.saveMarkdownMirror({
      mirrorId: 'memory:user',
      scope: 'user',
      filePath: path.join(homePath, 'memory', 'user.md'),
      status: 'synced',
      lastExportedAt: '2026-06-12T00:00:00.000Z',
      contentHash: 'old',
      metadata: { exportedMemoryIds: ['memory:existing', 'memory:removed'] },
    });
    fileSystem.files.set(path.join(homePath, 'memory', 'user.md'), [
      '# User Memory',
      '',
      '## Preference',
      '',
      '<!-- memory:id=memory:existing kind=preference updated=2026-06-12T00:00:00.000Z -->',
      '- User prefers concise answers.',
      '',
      '## Unknown',
      '',
      '- ignored text',
      '',
      '## Fact',
      '',
      '- User works on local desktop agent tools.',
      '',
    ].join('\n'));

    const result = await service.importMirror({ homePath, scope: 'user' });

    expect(result.status).toBe('synced');
    expect(repository.getMemory('memory:existing')).toMatchObject({
      content: 'User prefers concise answers.',
      source: 'markdown_import',
      updatedAt: now,
    });
    expect(repository.getMemory('memory:new:1')).toMatchObject({
      scope: 'user',
      kind: 'fact',
      content: 'User works on local desktop agent tools.',
      status: 'active',
    });
    expect(repository.getMemory('memory:removed')).toMatchObject({
      status: 'deleted',
      deletedAt: now,
    });
    expect(repository.audits.map((audit) => audit.operation)).toContain('memory_deleted');
    expect(fileSystem.diagnostics.map((diagnostic) => JSON.stringify(diagnostic.entry))).toEqual(
      expect.arrayContaining([expect.stringContaining('unknown_heading')]),
    );
    expect(fileSystem.writes).toHaveLength(1);
    expect(fileSystem.writes[0]?.content).toContain('memory:new:1');
  });

  it('continues after validation rejection and records candidate diagnostics', async () => {
    const { service, repository, fileSystem } = createService();
    fileSystem.files.set(path.join(homePath, 'memory', 'user.md'), [
      '# User Memory',
      '',
      '## Preference',
      '',
      '- api_key=sk-12345678901234567890 should never be saved',
      '- User prefers short implementation reports.',
      '',
    ].join('\n'));

    const result = await service.importMirror({ homePath, scope: 'user' });

    expect(result.status).toBe('synced');
    expect(repository.listMemories({ scope: 'user', status: 'active' })).toHaveLength(1);
    expect(repository.audits.map((audit) => audit.operation)).toContain('candidate_rejected');
    expect(fileSystem.diagnostics.map((diagnostic) => JSON.stringify(diagnostic.entry))).toEqual(
      expect.arrayContaining([expect.stringContaining('candidate_rejected')]),
    );
    expect(JSON.stringify(repository.audits)).not.toContain('sk-12345678901234567890');
  });

  it('records conflicts without exporting over the user edited file', async () => {
    const { service, repository, fileSystem } = createService();
    repository.saveMemory(memory({
      memoryId: 'memory:concise',
      scope: 'user',
      kind: 'preference',
      content: 'User prefers concise answers.',
      normalizedText: 'user prefers concise answers',
    }));
    fileSystem.files.set(path.join(homePath, 'memory', 'user.md'), [
      '# User Memory',
      '',
      '## Preference',
      '',
      '- User prefers detailed answers.',
      '',
    ].join('\n'));

    const result = await service.importMirror({ homePath, scope: 'user' });

    expect(result).toMatchObject({ status: 'degraded', reason: 'conflict_detected' });
    expect(fileSystem.writes).toHaveLength(0);
    expect(repository.mirrors.get('memory:user')).toMatchObject({ status: 'conflict' });
    expect(repository.audits.map((audit) => audit.operation)).toContain('conflict_detected');
    expect(fileSystem.diagnostics.map((diagnostic) => JSON.stringify(diagnostic.entry))).toEqual(
      expect.arrayContaining([expect.stringContaining('conflict_detected')]),
    );
  });

  it('syncs user before project before recall without requiring session-run wiring', async () => {
    const { service, repository } = createService();

    const result = await service.syncBeforeRecall({ homePath, projectId: 'project:1' });

    expect(result.status).toBe('skipped');
    expect(repository.mirrors.get('memory:user')).toMatchObject({ status: 'missing' });
    expect([...repository.mirrors.values()].some((mirror) => mirror.scope === 'project')).toBe(true);
  });
});
