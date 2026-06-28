import { describe, expect, it } from 'vitest';
import type { MemoryDiagnosticWriterPort } from '@megumi/coding-agent/memory';
import {
  MemoryRuntimeCaptureService,
  type MemoryExtractionModelClient,
} from '@megumi/coding-agent/memory';
import type {
  MemoryAuditLog,
  MemoryRecord,
  MemoryRecordStatus,
  MemoryScope,
} from '@megumi/shared/memory';
import type { JsonObject } from '@megumi/shared/primitives';

const now = '2026-06-13T10:00:00.000Z';
const homePath = 'C:/tmp/megumi-home';

class FakeMemoryDiagnosticWriter implements MemoryDiagnosticWriterPort {
  readonly diagnostics: unknown[] = [];

  async write(input: { homePath: string; operation: string; severity: 'info' | 'warning' | 'error'; createdAt: string; runId?: string | null; sessionId?: string | null; projectId?: string | null; targetId?: string | null; reason?: string | null; metadata?: JsonObject }): Promise<void> {
    this.diagnostics.push(input);
  }
}

class FakeMemoryRuntimeCaptureRepository {
  readonly memories = new Map<string, MemoryRecord>();
  readonly audits: MemoryAuditLog[] = [];
  failSaveMemory = false;
  failSaveAudit = false;

  listMemories(filter: {
    scope?: MemoryScope;
    projectId?: string | null;
    status?: MemoryRecordStatus;
    limit?: number;
  } = {}): MemoryRecord[] {
    return [...this.memories.values()]
      .filter((memory) => !filter.scope || memory.scope === filter.scope)
      .filter((memory) => !Object.hasOwn(filter, 'projectId') || (memory.projectId ?? null) === (filter.projectId ?? null))
      .filter((memory) => !filter.status || memory.status === filter.status)
      .slice(0, filter.limit ?? 1000);
  }

  getMemory(memoryId: string): MemoryRecord | undefined {
    return this.memories.get(memoryId);
  }

  saveMemory(memory: MemoryRecord): MemoryRecord {
    if (this.failSaveMemory) {
      throw new Error('database locked');
    }
    this.memories.set(memory.memoryId, memory);
    return memory;
  }

  saveAuditLog(auditLog: MemoryAuditLog): MemoryAuditLog {
    if (this.failSaveAudit) {
      throw new Error('audit database locked');
    }
    this.audits.push(auditLog);
    return auditLog;
  }
}

class FakeExtractionClient implements MemoryExtractionModelClient {
  calls: Parameters<MemoryExtractionModelClient['extractMemoryCandidates']>[0][] = [];
  throwOnExtract = false;
  result: Awaited<ReturnType<MemoryExtractionModelClient['extractMemoryCandidates']>> = {
    ok: true,
    text: JSON.stringify({ candidates: [] }),
  };

  async extractMemoryCandidates(input: Parameters<MemoryExtractionModelClient['extractMemoryCandidates']>[0]) {
    this.calls.push(input);
    if (this.throwOnExtract) {
      throw new Error('provider threw');
    }
    return this.result;
  }
}

function createService(
  extractionClient?: MemoryExtractionModelClient,
  options: { throwOnExport?: boolean } = {},
) {
  const repository = new FakeMemoryRuntimeCaptureRepository();
  const diagnostics = new FakeMemoryDiagnosticWriter();
  const exports: Array<{ homePath: string; scope: MemoryScope; projectId?: string | null }> = [];
  let memoryIndex = 0;
  let auditIndex = 0;
  const service = new MemoryRuntimeCaptureService({
    repository,
    markdownSync: {
      exportAfterMemoryWrite: async (input) => {
        if (options.throwOnExport) {
          throw new Error('export failed hard');
        }
        exports.push(input);
        return { status: 'synced', exportedMemoryIds: [] };
      },
    },
    diagnostics,
    extractionClient,
    clock: { now: () => now },
    ids: {
      memoryId: () => `memory:new:${++memoryIndex}`,
      auditId: () => `audit:${++auditIndex}`,
    },
  });
  return { service, repository, diagnostics, exports };
}

function baseInput(overrides: Partial<Parameters<MemoryRuntimeCaptureService['evaluateRunCompletedCapture']>[0]> = {}) {
  return {
    homePath,
    runId: 'run:1',
    sessionId: 'session:1',
    projectId: 'project:1',
    runStatus: 'completed' as const,
    userText: 'Please remember this project decision.',
    assistantText: 'Confirmed. The durable decision is stable.',
    hasProject: true,
    ...overrides,
  };
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
    source: overrides.source ?? 'capture',
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

describe('MemoryRuntimeCaptureService', () => {
  it('skips non-completed runs without extraction or memory writes', async () => {
    for (const runStatus of ['failed', 'cancelled', 'interrupted', 'running'] as const) {
      const extraction = new FakeExtractionClient();
      const { service, repository } = createService(extraction);

      const result = await service.evaluateRunCompletedCapture(baseInput({ runStatus }));

      expect(result).toMatchObject({ status: 'skipped', reason: 'run_not_completed' });
      expect(extraction.calls).toHaveLength(0);
      expect(repository.memories.size).toBe(0);
    }
  });

  it('skips when memory is disabled or trigger classifier does not request extraction', async () => {
    const disabledExtraction = new FakeExtractionClient();
    const disabled = createService(disabledExtraction);
    await expect(disabled.service.evaluateRunCompletedCapture(baseInput({ memoryEnabled: false }))).resolves.toMatchObject({
      status: 'skipped',
      reason: 'memory_disabled',
    });
    expect(disabledExtraction.calls).toHaveLength(0);
    expect(disabled.repository.audits.map((audit) => audit.operation)).toEqual([
      'capture_evaluated',
      'extraction_skipped',
    ]);

    const triggerSkipExtraction = new FakeExtractionClient();
    const triggerSkip = createService(triggerSkipExtraction);
    await expect(triggerSkip.service.evaluateRunCompletedCapture(baseInput({
      userText: 'What is TypeScript?',
      assistantText: 'TypeScript is a typed JavaScript superset.',
    }))).resolves.toMatchObject({
      status: 'skipped',
      reason: 'no_long_term_signal',
    });
    expect(triggerSkipExtraction.calls).toHaveLength(0);
    expect(triggerSkip.repository.audits.map((audit) => audit.operation)).toEqual([
      'capture_evaluated',
      'extraction_skipped',
    ]);
  });

  it('writes run-level audit targets for capture evaluation and extraction outcomes', async () => {
    const disabled = createService(new FakeExtractionClient());
    await disabled.service.evaluateRunCompletedCapture(baseInput({ memoryEnabled: false }));
    expect(disabled.repository.audits).toEqual([
      expect.objectContaining({
        operation: 'capture_evaluated',
        targetKind: 'run',
        targetId: 'run:1',
      }),
      expect.objectContaining({
        operation: 'extraction_skipped',
        targetKind: 'run',
        targetId: 'run:1',
      }),
    ]);

    const extraction = new FakeExtractionClient();
    extraction.result = { ok: false, reason: 'provider unavailable' };
    const failed = createService(extraction);
    await failed.service.evaluateRunCompletedCapture(baseInput());
    expect(failed.repository.audits).toEqual(expect.arrayContaining([
      expect.objectContaining({
        operation: 'extraction_failed',
        targetKind: 'run',
        targetId: 'run:1',
      }),
    ]));
  });

  it('builds extraction prompts and degrades on missing client or extraction failure', async () => {
    const missing = createService();
    await expect(missing.service.evaluateRunCompletedCapture(baseInput())).resolves.toMatchObject({
      status: 'degraded',
      reason: 'missing_extraction_client',
    });
    expect(missing.repository.audits.map((audit) => audit.operation)).toContain('extraction_failed');
    expect(JSON.stringify(missing.diagnostics.diagnostics)).toContain('missing_extraction_client');

    const extraction = new FakeExtractionClient();
    extraction.result = { ok: false, reason: 'provider unavailable' };
    const failed = createService(extraction);

    await expect(failed.service.evaluateRunCompletedCapture(baseInput())).resolves.toMatchObject({
      status: 'degraded',
      reason: 'provider unavailable',
    });
    expect(extraction.calls).toHaveLength(1);
    expect(extraction.calls[0]?.prompt.user).toContain('Please remember this project decision.');
    expect(failed.repository.audits.map((audit) => audit.operation)).toContain('extraction_failed');
  });

  it('passes provider target into extraction client for completed triggered runs', async () => {
    const extraction = new FakeExtractionClient();
    extraction.result = { ok: true, text: '{ "candidates": [] }' };
    const { service } = createService(extraction);

    const result = await service.evaluateRunCompletedCapture(baseInput({
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
      userText: 'Please remember this preference.',
      assistantText: 'I will remember this preference.',
    }));

    expect(result).toMatchObject({ status: 'skipped', reason: 'no_candidates' });
    expect(extraction.calls).toEqual([
      expect.objectContaining({
        runId: 'run:1',
        sessionId: 'session:1',
        projectId: 'project:1',
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
      }),
    ]);
  });

  it('records invalid extraction output without throwing', async () => {
    const extraction = new FakeExtractionClient();
    extraction.result = { ok: true, text: '{not-json' };
    const { service, repository, diagnostics } = createService(extraction);

    await expect(service.evaluateRunCompletedCapture(baseInput())).resolves.toMatchObject({
      status: 'degraded',
      reason: 'invalid_json',
    });
    expect(repository.audits.map((audit) => audit.operation)).toContain('extraction_failed');
    expect(JSON.stringify(diagnostics.diagnostics)).toContain('invalid_json');
    expect(JSON.stringify(repository.audits)).toContain('{not-json');
    expect(JSON.stringify(diagnostics.diagnostics)).toContain('{not-json');
  });

  it('uses structured extraction output before falling back to text JSON parsing', async () => {
    const extraction = new FakeExtractionClient();
    extraction.result = {
      ok: true,
      text: '{not-json',
      structuredOutput: {
        candidates: [{
          scope: 'project',
          kind: 'decision',
          text: 'Memory extraction uses provider structured output.',
          confidence: 0.92,
        }],
      },
    };
    const { service, repository, exports } = createService(extraction);

    const result = await service.evaluateRunCompletedCapture(baseInput());

    expect(result.status).toBe('captured');
    expect(repository.getMemory('memory:new:1')).toMatchObject({
      scope: 'project',
      projectId: 'project:1',
      kind: 'decision',
      content: 'Memory extraction uses provider structured output.',
    });
    expect(exports).toEqual([{ homePath, scope: 'project', projectId: 'project:1' }]);
    expect(JSON.stringify(repository.audits)).not.toContain('invalid_json');
  });

  it('records raw extraction output when schema validation fails', async () => {
    const extraction = new FakeExtractionClient();
    extraction.result = {
      ok: true,
      text: JSON.stringify({
        candidates: [{
          scope: 'user',
          kind: 'preference',
          text: 'User wants every reply to end with a fixed phrase.',
          confidence: '0.9',
          evidence: [{ source: 'user_message', quote: 'please remember' }],
        }],
      }),
    };
    const { service, repository, diagnostics } = createService(extraction);

    await expect(service.evaluateRunCompletedCapture(baseInput())).resolves.toMatchObject({
      status: 'degraded',
      reason: 'invalid_schema',
    });
    const failureAudit = repository.audits.find((audit) => audit.operation === 'extraction_failed');
    expect(failureAudit?.metadata?.rawOutput).toContain('"confidence":"0.9"');
    expect(JSON.stringify(diagnostics.diagnostics)).toContain('\\"confidence\\":\\"0.9\\"');
    expect(JSON.stringify(diagnostics.diagnostics)).toContain('Expected number');
  });

  it('persists valid candidates and exports affected markdown mirrors', async () => {
    const extraction = new FakeExtractionClient();
    extraction.result = {
      ok: true,
      text: JSON.stringify({
        candidates: [{
          scope: 'project',
          kind: 'decision',
          text: 'Project uses SQLite as the authoritative memory store.',
          confidence: 0.91,
          evidence: { source: 'assistant_message', quote: 'SQLite authoritative memory store' },
        }],
      }),
    };
    const { service, repository, exports } = createService(extraction);

    const result = await service.evaluateRunCompletedCapture(baseInput());

    expect(result.status).toBe('captured');
    expect(repository.getMemory('memory:new:1')).toMatchObject({
      scope: 'project',
      projectId: 'project:1',
      kind: 'decision',
      status: 'active',
      sourceRunId: 'run:1',
      sourceSessionId: 'session:1',
    });
    expect(exports).toEqual([{ homePath, scope: 'project', projectId: 'project:1' }]);
    expect(JSON.stringify(repository.audits)).not.toContain('Please remember this project decision.');
  });

  it('rejects invalid candidates while accepting other candidates', async () => {
    const extraction = new FakeExtractionClient();
    extraction.result = {
      ok: true,
      text: JSON.stringify({
        candidates: [
          { scope: 'project', kind: 'fact', text: 'Project fact needs a project.', confidence: 0.9 },
          { scope: 'user', kind: 'preference', text: 'User prefers focused completion reports.', confidence: 0.9 },
        ],
      }),
    };
    const { service, repository, diagnostics } = createService(extraction);

    const result = await service.evaluateRunCompletedCapture(baseInput({ projectId: null, hasProject: false }));

    expect(result.status).toBe('captured');
    expect(repository.listMemories({ status: 'active' })).toHaveLength(1);
    expect(repository.audits.map((audit) => audit.operation)).toContain('candidate_rejected');
    expect(JSON.stringify(diagnostics.diagnostics)).toContain('project_scope_requires_project');
  });

  it('dedupes exact candidates and supersedes less specific memories', async () => {
    const exactExtraction = new FakeExtractionClient();
    exactExtraction.result = {
      ok: true,
      text: JSON.stringify({
        candidates: [{ scope: 'user', kind: 'preference', text: 'User prefers concise answers.', confidence: 0.95 }],
      }),
    };
    const exact = createService(exactExtraction);
    exact.repository.saveMemory(memory({
      memoryId: 'memory:existing',
      scope: 'user',
      kind: 'preference',
      content: 'User prefers concise answers.',
      normalizedText: 'user prefers concise answers',
    }));

    await exact.service.evaluateRunCompletedCapture(baseInput());
    expect(exact.repository.memories.size).toBe(1);
    expect(exact.repository.getMemory('memory:existing')?.confidence).toBe(0.95);

    const supersedeExtraction = new FakeExtractionClient();
    supersedeExtraction.result = {
      ok: true,
      text: JSON.stringify({
        candidates: [{
          scope: 'project',
          kind: 'constraint',
          text: 'Project documents use Chinese by default and filenames use English kebab-case.',
          confidence: 0.92,
        }],
      }),
    };
    const supersede = createService(supersedeExtraction);
    supersede.repository.saveMemory(memory({
      memoryId: 'memory:old',
      scope: 'project',
      kind: 'constraint',
      content: 'Project documents use Chinese.',
      normalizedText: 'project documents use chinese',
    }));

    await supersede.service.evaluateRunCompletedCapture(baseInput());
    expect(supersede.repository.getMemory('memory:old')).toMatchObject({
      status: 'superseded',
      supersededById: 'memory:new:1',
    });
    expect(supersede.repository.getMemory('memory:new:1')).toMatchObject({ status: 'active' });
  });

  it('records conflicts without saving active memory or exporting markdown', async () => {
    const extraction = new FakeExtractionClient();
    extraction.result = {
      ok: true,
      text: JSON.stringify({
        candidates: [{ scope: 'user', kind: 'preference', text: 'User prefers detailed answers.', confidence: 0.9 }],
      }),
    };
    const { service, repository, exports, diagnostics } = createService(extraction);
    repository.saveMemory(memory({
      memoryId: 'memory:concise',
      scope: 'user',
      kind: 'preference',
      content: 'User prefers concise answers.',
      normalizedText: 'user prefers concise answers',
    }));

    await expect(service.evaluateRunCompletedCapture(baseInput())).resolves.toMatchObject({
      status: 'degraded',
      reason: 'conflict_detected',
    });
    expect(repository.memories.size).toBe(1);
    expect(exports).toHaveLength(0);
    expect(repository.audits.map((audit) => audit.operation)).toContain('conflict_detected');
    expect(JSON.stringify(diagnostics.diagnostics)).toContain('conflict_detected');
  });

  it('degrades repository save failures without throwing to the run', async () => {
    const extraction = new FakeExtractionClient();
    extraction.result = {
      ok: true,
      text: JSON.stringify({
        candidates: [{ scope: 'user', kind: 'preference', text: 'User prefers brief answers.', confidence: 0.9 }],
      }),
    };
    const { service, repository, diagnostics } = createService(extraction);
    repository.failSaveMemory = true;

    await expect(service.evaluateRunCompletedCapture(baseInput())).resolves.toMatchObject({
      status: 'degraded',
      reason: 'memory_write_failed',
    });
    expect(JSON.stringify(diagnostics.diagnostics)).toContain('database locked');
  });

  it('degrades audit, extraction throw, and export throw failures without rejecting the run', async () => {
    const auditExtraction = new FakeExtractionClient();
    auditExtraction.result = {
      ok: true,
      text: JSON.stringify({
        candidates: [{ scope: 'user', kind: 'preference', text: 'User prefers concise answers.', confidence: 0.9 }],
      }),
    };
    const audit = createService(auditExtraction);
    audit.repository.failSaveAudit = true;

    await expect(audit.service.evaluateRunCompletedCapture(baseInput())).resolves.toMatchObject({
      status: 'degraded',
      reason: 'audit_write_failed',
    });
    expect(audit.repository.memories.size).toBe(1);
    expect(JSON.stringify(audit.diagnostics.diagnostics)).toContain('audit database locked');

    const thrownExtraction = new FakeExtractionClient();
    thrownExtraction.throwOnExtract = true;
    const extraction = createService(thrownExtraction);

    await expect(extraction.service.evaluateRunCompletedCapture(baseInput())).resolves.toMatchObject({
      status: 'degraded',
      reason: 'extraction_threw',
    });
    expect(JSON.stringify(extraction.diagnostics.diagnostics)).toContain('provider threw');

    const exportExtraction = new FakeExtractionClient();
    exportExtraction.result = {
      ok: true,
      text: JSON.stringify({
        candidates: [{ scope: 'user', kind: 'preference', text: 'User prefers brief answers.', confidence: 0.9 }],
      }),
    };
    const exportFailure = createService(exportExtraction, { throwOnExport: true });

    await expect(exportFailure.service.evaluateRunCompletedCapture(baseInput())).resolves.toMatchObject({
      status: 'degraded',
      reason: 'markdown_export_failed',
    });
    expect(exportFailure.repository.memories.size).toBe(1);
    expect(JSON.stringify(exportFailure.diagnostics.diagnostics)).toContain('export failed hard');
  });
});
