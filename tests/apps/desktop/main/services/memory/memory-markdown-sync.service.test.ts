import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { MemoryDiagnosticWriter } from '@megumi/coding-agent/adapters/local/memory/memory-diagnostic-writer.service';
import { MemoryMarkdownSyncService } from '@megumi/coding-agent/adapters/local/memory/memory-markdown-sync.service';
import type { MemoryMarkdownSyncCaptureAttempt } from '@megumi/coding-agent/adapters/local/memory/memory-markdown-sync.service';
import type { MemoryRuntimeFileSystem } from '@megumi/coding-agent/adapters/local/memory/memory-runtime-file-system';
import { resolveProjectMemoryMirrorTarget } from '@megumi/coding-agent/adapters/local/memory/memory-runtime-paths';
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
  throwOnRead = false;
  throwOnWrite = false;

  async readText(filePath: string): ReturnType<MemoryRuntimeFileSystem['readText']> {
    if (this.throwOnRead) {
      throw new Error('read exploded');
    }
    if (!this.files.has(filePath)) {
      return { ok: false, reason: 'not_found', message: 'missing' };
    }
    return { ok: true, content: this.files.get(filePath) ?? '' };
  }

  async writeTextAtomic(filePath: string, content: string): ReturnType<MemoryRuntimeFileSystem['writeTextAtomic']> {
    this.writes.push({ filePath, content });
    if (this.throwOnWrite) {
      throw new Error('write exploded');
    }
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
  failListMemories = false;
  failGetMemory = false;
  failSaveMemory = false;
  failSaveMirror = false;
  failGetMirror = false;
  failSaveAudit = false;

  listMemories(filter: {
    scope?: MemoryScope;
    projectId?: string | null;
    status?: MemoryRecordStatus;
    kind?: MemoryRecord['kind'];
    query?: string;
    limit?: number;
  } = {}): MemoryRecord[] {
    if (this.failListMemories) {
      throw new Error('list memories failed');
    }
    return [...this.memories.values()]
      .filter((memory) => !filter.scope || memory.scope === filter.scope)
      .filter((memory) => !Object.hasOwn(filter, 'projectId') || (memory.projectId ?? null) === (filter.projectId ?? null))
      .filter((memory) => !filter.status || memory.status === filter.status)
      .filter((memory) => !filter.kind || memory.kind === filter.kind)
      .slice(0, filter.limit ?? 1000);
  }

  getMemory(memoryId: string): MemoryRecord | undefined {
    if (this.failGetMemory) {
      throw new Error('get memory failed');
    }
    return this.memories.get(memoryId);
  }

  saveMemory(memory: MemoryRecord): MemoryRecord {
    if (this.failSaveMemory) {
      throw new Error('save memory failed');
    }
    this.memories.set(memory.memoryId, memory);
    return memory;
  }

  saveMarkdownMirror(mirror: MemoryMarkdownMirror): void {
    if (this.failSaveMirror) {
      throw new Error('save mirror failed');
    }
    this.mirrors.set(mirror.mirrorId, mirror);
  }

  getMarkdownMirror(mirrorId: string): MemoryMarkdownMirror | null {
    if (this.failGetMirror) {
      throw new Error('get mirror failed');
    }
    return this.mirrors.get(mirrorId) ?? null;
  }

  recordCaptureAttempt(attempt: MemoryMarkdownSyncCaptureAttempt): MemoryMarkdownSyncCaptureAttempt {
    if (this.failSaveAudit && attempt.triggerKind === 'audit_log') {
      throw new Error('save audit failed');
    }
    const auditLog = attempt.metadata?.auditLog as MemoryAuditLog | undefined;
    if (auditLog) {
      this.audits.push(auditLog);
    }
    return attempt;
  }

  saveAuditLog(auditLog: MemoryAuditLog): MemoryAuditLog {
    if (this.failSaveAudit) {
      throw new Error('save audit failed');
    }
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

function fileSystemPathForProjectMemory(projectId = 'project:1'): string {
  return resolveProjectMemoryMirrorTarget({ homePath, projectId }).filePath;
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
    expect(repository.audits.map((audit) => audit.operation)).toEqual(expect.arrayContaining([
      'markdown_import_parsed',
      'candidate_imported',
      'memory_deleted',
    ]));
    expect(repository.audits.find((audit) => audit.operation === 'markdown_import_parsed')).toMatchObject({
      targetKind: 'markdown_mirror',
      targetId: 'memory:user',
      metadata: expect.objectContaining({
        entryCount: 2,
        diagnosticCount: 1,
      }),
    });
    expect(repository.audits.filter((audit) => audit.operation === 'candidate_imported')).toHaveLength(2);
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

  it('detects conflict for id-based updates without changing the record or exporting', async () => {
    const { service, repository, fileSystem } = createService();
    repository.saveMemory(memory({
      memoryId: 'memory:target',
      scope: 'user',
      kind: 'preference',
      content: 'User prefers short summaries.',
      normalizedText: 'user prefers short summaries',
    }));
    repository.saveMemory(memory({
      memoryId: 'memory:other',
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
      '<!-- memory:id=memory:target kind=preference updated=2026-06-12T00:00:00.000Z -->',
      '- User prefers detailed answers.',
      '',
    ].join('\n'));

    const result = await service.importMirror({ homePath, scope: 'user' });

    expect(result).toMatchObject({ status: 'degraded', reason: 'conflict_detected' });
    expect(repository.getMemory('memory:target')).toMatchObject({
      content: 'User prefers short summaries.',
    });
    expect(fileSystem.writes).toHaveLength(0);
    expect(repository.mirrors.get('memory:user')).toMatchObject({ status: 'conflict' });
    expect(repository.audits.map((audit) => audit.operation)).toContain('conflict_detected');
    expect(JSON.stringify(fileSystem.diagnostics)).toContain('conflict_detected');
  });

  it('dedupes id-based updates into another active record and supersedes the current anchor record', async () => {
    const { service, repository, fileSystem } = createService();
    repository.saveMemory(memory({
      memoryId: 'memory:target',
      scope: 'user',
      kind: 'preference',
      content: 'User prefers short implementation reports.',
      normalizedText: 'user prefers short implementation reports',
      confidence: 0.6,
    }));
    repository.saveMemory(memory({
      memoryId: 'memory:other',
      scope: 'user',
      kind: 'preference',
      content: 'User prefers concise answers.',
      normalizedText: 'user prefers concise answers',
      confidence: 0.7,
    }));
    fileSystem.files.set(path.join(homePath, 'memory', 'user.md'), [
      '# User Memory',
      '',
      '## Preference',
      '',
      '<!-- memory:id=memory:target kind=preference updated=2026-06-12T00:00:00.000Z -->',
      '- User prefers concise answers.',
      '',
    ].join('\n'));

    const result = await service.importMirror({ homePath, scope: 'user' });

    expect(result).toMatchObject({
      status: 'synced',
      importedMemoryIds: expect.arrayContaining(['memory:other', 'memory:target']),
    });
    expect(repository.getMemory('memory:other')).toMatchObject({
      status: 'active',
      confidence: 1,
    });
    expect(repository.getMemory('memory:target')).toMatchObject({
      status: 'superseded',
      supersededById: 'memory:other',
    });
    expect(repository.listMemories({ scope: 'user', status: 'active' })).toHaveLength(1);
    expect(repository.audits.map((audit) => audit.operation)).toEqual(expect.arrayContaining([
      'memory_updated',
      'memory_superseded',
    ]));
    expect(fileSystem.writes[0]?.content).toContain('memory:id=memory:other');
    expect(fileSystem.writes[0]?.content).not.toContain('memory:id=memory:target');
  });

  it('lets an id-based update supersede another active record while preserving the current Markdown anchor id', async () => {
    const { service, repository, fileSystem } = createService();
    repository.saveMemory(memory({
      memoryId: 'memory:target',
      scope: 'project',
      kind: 'constraint',
      content: 'Project documentation uses Chinese.',
      normalizedText: 'project documentation uses chinese',
      projectId: 'project:1',
    }));
    repository.saveMemory(memory({
      memoryId: 'memory:other',
      scope: 'project',
      kind: 'constraint',
      content: 'Project docs use Chinese.',
      normalizedText: 'project docs use chinese',
      projectId: 'project:1',
    }));
    fileSystem.files.set(fileSystemPathForProjectMemory(), [
      '# Project Memory',
      '',
      '## Constraint',
      '',
      '<!-- memory:id=memory:target kind=constraint updated=2026-06-12T00:00:00.000Z -->',
      '- Project docs use Chinese by default and filenames use English kebab-case.',
      '',
    ].join('\n'));

    const result = await service.importMirror({ homePath, scope: 'project', projectId: 'project:1' });

    expect(result).toMatchObject({
      status: 'synced',
      importedMemoryIds: expect.arrayContaining(['memory:target', 'memory:other']),
    });
    expect(repository.getMemory('memory:other')).toMatchObject({
      status: 'superseded',
      supersededById: 'memory:target',
    });
    expect(repository.getMemory('memory:target')).toMatchObject({
      status: 'active',
      content: 'Project docs use Chinese by default and filenames use English kebab-case.',
      supersededById: null,
    });
    expect(fileSystem.writes[0]?.content).toContain('memory:id=memory:target');
    expect(fileSystem.writes[0]?.content).not.toContain('memory:id=memory:other');
    expect(repository.audits.map((audit) => audit.operation)).toEqual(expect.arrayContaining([
      'memory_superseded',
      'memory_updated',
    ]));
  });

  it('degrades dependency throws and records safe diagnostics/audits', async () => {
    const readFailure = createService();
    readFailure.fileSystem.throwOnRead = true;
    await expect(readFailure.service.importMirror({ homePath, scope: 'user' })).resolves.toMatchObject({
      status: 'degraded',
      reason: 'read_failed',
    });
    expect(readFailure.repository.audits.map((audit) => audit.operation)).toContain('markdown_import_failed');
    expect(JSON.stringify(readFailure.fileSystem.diagnostics)).toContain('read exploded');

    const writeFailure = createService();
    writeFailure.repository.saveMemory(memory({
      memoryId: 'memory:1',
      scope: 'user',
      kind: 'preference',
      content: 'User prefers focused reports.',
    }));
    writeFailure.fileSystem.throwOnWrite = true;
    await expect(writeFailure.service.exportMirror({ homePath, scope: 'user' })).resolves.toMatchObject({
      status: 'degraded',
      reason: 'write_failed',
    });
    expect(JSON.stringify(writeFailure.fileSystem.diagnostics)).toContain('markdown_export_failed');

    const repoFailure = createService();
    repoFailure.fileSystem.files.set(path.join(homePath, 'memory', 'user.md'), [
      '# User Memory',
      '',
      '## Preference',
      '',
      '- User prefers concise reports.',
      '',
    ].join('\n'));
    repoFailure.repository.failSaveMemory = true;
    await expect(repoFailure.service.importMirror({ homePath, scope: 'user' })).resolves.toMatchObject({
      status: 'degraded',
      reason: 'import_failed',
    });
    expect(repoFailure.repository.audits.map((audit) => audit.operation)).toContain('markdown_import_failed');
    expect(JSON.stringify(repoFailure.fileSystem.diagnostics)).toContain('save memory failed');

    const mirrorFailure = createService();
    mirrorFailure.repository.failSaveMirror = true;
    await expect(mirrorFailure.service.importMirror({ homePath, scope: 'user' })).resolves.toMatchObject({
      status: 'degraded',
      reason: 'mirror_state_write_failed',
    });
    expect(JSON.stringify(mirrorFailure.fileSystem.diagnostics)).toContain('save mirror failed');
  });

  it('recursively filters raw audit metadata keys', async () => {
    const { service, repository, fileSystem } = createService();
    fileSystem.files.set(path.join(homePath, 'memory', 'user.md'), [
      '# User Memory',
      '',
      '## Preference',
      '',
      '- api_key=sk-12345678901234567890 should never be saved',
      '',
    ].join('\n'));

    await service.importMirror({ homePath, scope: 'user' });

    expect(repository.audits.map((audit) => JSON.stringify(audit))).toEqual(
      expect.arrayContaining([expect.not.stringContaining('sk-12345678901234567890')]),
    );
    expect(JSON.stringify(repository.audits)).not.toContain('rawcontent');
  });

  it('syncs user before project before recall without requiring session-run wiring', async () => {
    const { service, repository } = createService();

    const result = await service.syncBeforeRecall({ homePath, projectId: 'project:1' });

    expect(result.status).toBe('skipped');
    expect(repository.mirrors.get('memory:user')).toMatchObject({ status: 'missing' });
    expect([...repository.mirrors.values()].some((mirror) => mirror.scope === 'project')).toBe(true);
  });
});
