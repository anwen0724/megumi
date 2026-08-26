// @vitest-environment node
/* Verifies bounded single-Trace export, byte support, missing evidence, and secondary secret removal. */
import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ContentStoreReadResult } from '../../../packages/agent/observability/src/content/content-store';
import type { TraceJournalRecord } from '../../../packages/agent/observability/src/persistence/trace-journal-record';
import { createTraceDiagnosticBundle } from '../../../packages/agent/observability/src/query/diagnostic-bundle';
import { projectTrace } from '../../../packages/agent/observability/src/query/trace-projector';

describe('Trace diagnostic bundle', () => {
  it('exports only one Trace, its records, referenced bytes, and an explicit missing list', async () => {
    const traceId = '00000000-0000-4000-8000-000000000401';
    const availableBytes = new TextEncoder().encode('ordinary provider response');
    const availableContentId = sha256(availableBytes);
    const missingContentId = 'b'.repeat(64);
    const trace = projectTrace({
      traceId,
      records: recordsWithStoredContent(traceId, availableContentId, missingContentId),
    });
    const bundle = await createTraceDiagnosticBundle({
      trace,
      now: () => new Date('2026-08-26T12:00:00.000Z'),
      readContent: async (contentId): Promise<ContentStoreReadResult> => (
        contentId === availableContentId
          ? { status: 'available', bytes: availableBytes }
          : { status: 'missing' }
      ),
    });

    expect(bundle.suggestedDirectoryName).toBe(`megumi-trace-${traceId}`);
    expect(bundle.files.map((file) => file.relativePath)).toEqual([
      'manifest.json',
      'trace/records.jsonl',
      `content/${availableContentId}.blob`,
    ]);
    expect(bundle.files.every((file) => isSafeRelativePath(file.relativePath))).toBe(true);
    const manifest = parseManifest(bundle.files[0]?.content);
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      traceId,
      recordCount: 4,
      missing: [{ contentId: missingContentId, reason: 'missing' }],
    });
    expect(bundle.files[2]?.content).toEqual(availableBytes);
    expect(bundle.files.map((file) => file.relativePath).join('\n')).not.toContain('runtime');
  });

  it('redacts credentials during the second export scan without mutating source evidence', async () => {
    const traceId = '00000000-0000-4000-8000-000000000402';
    const secret = 'Bearer abcdefghijklmnopqrstuvwxyz';
    const secretBytes = new TextEncoder().encode(`authorization=${secret}`);
    const contentId = sha256(secretBytes);
    const trace = projectTrace({
      traceId,
      records: recordsWithStoredContent(traceId, contentId),
    });

    const bundle = await createTraceDiagnosticBundle({
      trace,
      readContent: async () => ({ status: 'available', bytes: secretBytes }),
    });

    const serialized = bundle.files.map((file) => (
      typeof file.content === 'string'
        ? file.content
        : new TextDecoder().decode(file.content)
    )).join('\n');
    expect(serialized).not.toContain(secret);
    expect(serialized).toContain('[redacted]');
    expect(bundle.files.map((file) => file.relativePath)).toContain(
      `content/${contentId}.redacted.txt`,
    );
    expect(new TextDecoder().decode(secretBytes)).toContain(secret);
  });
});

function recordsWithStoredContent(
  traceId: string,
  firstContentId: string,
  secondContentId?: string,
): TraceJournalRecord[] {
  const contentIds = secondContentId ? [firstContentId, secondContentId] : [firstContentId];
  return [
    {
      ...base(traceId, 1),
      type: 'trace.started',
      traceKind: 'conversation',
      correlation: {},
    },
    ...contentIds.map((contentId, index): TraceJournalRecord => ({
      ...base(traceId, index + 2),
      type: 'content.recorded',
      kind: 'model.provider_response',
      content: {
        mode: 'stored',
        contentId,
        mediaType: 'text/plain;charset=utf-8',
        byteLength: index === 0 ? 26 : 10,
      },
      correlation: {},
    })),
    {
      ...base(traceId, contentIds.length + 2),
      type: 'trace.ended',
      outcome: { status: 'ok' },
      diagnostics: 'complete',
    },
  ];
}

function base(traceId: string, sequence: number) {
  return {
    schemaVersion: 1 as const,
    recordId: `00000000-0000-4000-8000-${String(800 + sequence).padStart(12, '0')}`,
    traceId,
    sequence,
    timestamp: `2026-08-26T00:00:${String(sequence).padStart(2, '0')}.000Z`,
  };
}

function parseManifest(content: string | Uint8Array | undefined): unknown {
  if (typeof content !== 'string') throw new Error('Expected a UTF-8 manifest.');
  return JSON.parse(content);
}

function isSafeRelativePath(relativePath: string): boolean {
  return !posix.isAbsolute(relativePath)
    && relativePath.split('/').every((segment) => segment !== '..' && segment !== '');
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
