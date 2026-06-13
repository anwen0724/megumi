import { describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { MemoryDiagnosticWriter } from '@megumi/desktop/main/services/memory/memory-diagnostic-writer.service';
import type { MemoryRuntimeFileSystem } from '@megumi/desktop/main/services/memory/memory-runtime-file-system';

class FakeMemoryRuntimeFileSystem implements MemoryRuntimeFileSystem {
  readonly appended: Array<{ filePath: string; entry: unknown }> = [];
  appendResult: { ok: true } | { ok: false; reason: 'append_failed'; message: string } = { ok: true };

  async readText(): ReturnType<MemoryRuntimeFileSystem['readText']> {
    return { ok: false, reason: 'not_found', message: 'missing' };
  }

  async writeTextAtomic(): ReturnType<MemoryRuntimeFileSystem['writeTextAtomic']> {
    return { ok: true };
  }

  async appendJsonLine(filePath: string, entry: unknown): ReturnType<MemoryRuntimeFileSystem['appendJsonLine']> {
    this.appended.push({ filePath, entry });
    return this.appendResult;
  }
}

describe('MemoryDiagnosticWriter', () => {
  const homePath = path.resolve('C:/tmp/megumi-home');

  it('appends safe JSONL diagnostics under Megumi Home', async () => {
    const fileSystem = new FakeMemoryRuntimeFileSystem();
    const writer = new MemoryDiagnosticWriter({ fileSystem });

    await writer.write({
      operation: 'candidate_rejected',
      severity: 'warning',
      createdAt: '2026-06-13T10:20:30.000Z',
      homePath,
      runId: 'run:1',
      sessionId: 'session:1',
      projectId: 'project:1',
      targetId: 'memory:1',
      reason: 'secret_detected',
      metadata: {
        normalizedText: 'User prefers concise answers.',
        redactedSnippet: 'x'.repeat(200),
        nested: {
          content: 'raw memory content',
          apiKey: 'sk-secret',
          safe: 'kept',
        },
      },
    });

    expect(fileSystem.appended).toHaveLength(1);
    expect(fileSystem.appended[0]?.filePath).toBe(path.join(homePath, 'memory', 'diagnostics', '2026-06-13.jsonl'));
    expect(fileSystem.appended[0]?.entry).toMatchObject({
      createdAt: '2026-06-13T10:20:30.000Z',
      operation: 'candidate_rejected',
      severity: 'warning',
      runId: 'run:1',
      sessionId: 'session:1',
      projectId: 'project:1',
      targetId: 'memory:1',
      reason: 'secret_detected',
      metadata: {
        normalizedHash: expect.stringMatching(/^[a-f0-9]{16}$/),
        redactedSnippet: 'x'.repeat(160),
        nested: {
          safe: 'kept',
        },
      },
    });
    expect(JSON.stringify(fileSystem.appended[0]?.entry)).not.toContain('raw memory content');
    expect(JSON.stringify(fileSystem.appended[0]?.entry)).not.toContain('sk-secret');
    expect(JSON.stringify(fileSystem.appended[0]?.entry)).not.toContain('User prefers concise answers.');
  });

  it('removes raw sensitive keys recursively and logs append failures without throwing', async () => {
    const fileSystem = new FakeMemoryRuntimeFileSystem();
    fileSystem.appendResult = { ok: false, reason: 'append_failed', message: 'disk full' };
    const logger = { warn: vi.fn() };
    const writer = new MemoryDiagnosticWriter({ fileSystem, logger });

    await expect(writer.write({
      operation: 'extraction_failed',
      severity: 'error',
      createdAt: '2026-06-13T00:00:00.000Z',
      homePath,
      metadata: {
        rawPrompt: 'full prompt',
        rawToolOutput: 'tool output',
        transcript: 'transcript',
        plaintextSecret: 'secret',
        password: 'password',
        secret: 'secret',
        nested: [{ rawContent: 'raw' }, { ok: true }],
      },
    })).resolves.toBeUndefined();

    expect(JSON.stringify(fileSystem.appended[0]?.entry)).toBe(JSON.stringify({
      createdAt: '2026-06-13T00:00:00.000Z',
      operation: 'extraction_failed',
      severity: 'error',
      metadata: {
        nested: [{}, { ok: true }],
      },
    }));
    expect(logger.warn).toHaveBeenCalledWith(
      'Failed to write memory diagnostic.',
      expect.objectContaining({ reason: 'append_failed', message: 'disk full' }),
    );
  });
});
