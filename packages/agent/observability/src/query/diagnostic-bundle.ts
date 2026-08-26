/*
 * Builds a path-safe, secondarily sanitized diagnostic bundle for exactly one projected Trace.
 */
import type { ContentStoreReadResult } from '../content/content-store';
import { redactRuntimeMessage, redactRuntimeValue } from '../redaction';
import type { TraceProjection } from './trace-projector';

const CONTENT_ID_PATTERN = /^[a-f0-9]{64}$/;

export interface TraceDiagnosticBundleFile {
  readonly relativePath: string;
  readonly content: string | Uint8Array;
}

export interface TraceDiagnosticBundle {
  readonly suggestedDirectoryName: string;
  readonly files: readonly TraceDiagnosticBundleFile[];
}

export interface CreateTraceDiagnosticBundleOptions {
  readonly trace: TraceProjection;
  readonly readContent: (contentId: string) => Promise<ContentStoreReadResult>;
  readonly now?: () => Date;
}

interface ExportedContent {
  readonly contentId: string;
  readonly relativePath: string;
  readonly mediaType: string;
  readonly redacted: boolean;
}

interface MissingContent {
  readonly contentId: string;
  readonly reason: Exclude<ContentStoreReadResult['status'], 'available'> | 'invalid_content_id';
}

/** Creates a bounded diagnostic bundle without reading Runtime Log or business state. */
export async function createTraceDiagnosticBundle(
  options: CreateTraceDiagnosticBundleOptions,
): Promise<TraceDiagnosticBundle> {
  const contentFiles: TraceDiagnosticBundleFile[] = [];
  const exported: ExportedContent[] = [];
  const missing: MissingContent[] = [];
  const storedReferences = uniqueStoredReferences(options.trace);

  for (const reference of storedReferences) {
    if (!CONTENT_ID_PATTERN.test(reference.contentId)) {
      missing.push({ contentId: reference.contentId, reason: 'invalid_content_id' });
      continue;
    }
    let read: ContentStoreReadResult;
    try {
      read = await options.readContent(reference.contentId);
    } catch {
      read = { status: 'failed' };
    }
    if (read.status !== 'available') {
      missing.push({ contentId: reference.contentId, reason: read.status });
      continue;
    }

    const sanitized = sanitizeExportBytes(read.bytes);
    const extension = sanitized.redacted ? 'redacted.txt' : 'blob';
    const relativePath = safeRelativePath(`content/${reference.contentId}.${extension}`);
    contentFiles.push({ relativePath, content: sanitized.bytes });
    exported.push({
      contentId: reference.contentId,
      relativePath,
      mediaType: reference.mediaType,
      redacted: sanitized.redacted,
    });
  }

  const recordLines = options.trace.records.map((record) => (
    JSON.stringify(redactRuntimeValue(record))
  ));
  const manifest = JSON.stringify({
    schemaVersion: 1,
    createdAt: (options.now ?? (() => new Date()))().toISOString(),
    traceId: options.trace.traceId,
    traceKind: options.trace.traceKind,
    status: options.trace.status,
    diagnostics: options.trace.diagnostics,
    recordCount: options.trace.records.length,
    exportedContent: exported,
    missing,
  }, null, 2);
  const files: TraceDiagnosticBundleFile[] = [
    { relativePath: safeRelativePath('manifest.json'), content: manifest },
    {
      relativePath: safeRelativePath('trace/records.jsonl'),
      content: recordLines.length > 0 ? `${recordLines.join('\n')}\n` : '',
    },
    ...contentFiles,
  ];

  return {
    suggestedDirectoryName: `megumi-trace-${sanitizeDirectoryName(options.trace.traceId)}`,
    files,
  };
}

function uniqueStoredReferences(trace: TraceProjection): readonly {
  readonly contentId: string;
  readonly mediaType: string;
}[] {
  const references = new Map<string, { readonly contentId: string; readonly mediaType: string }>();
  for (const checkpoint of trace.contents) {
    if (checkpoint.content.mode !== 'stored') continue;
    references.set(checkpoint.content.contentId, {
      contentId: checkpoint.content.contentId,
      mediaType: checkpoint.content.mediaType,
    });
  }
  return [...references.values()];
}

function sanitizeExportBytes(bytes: Uint8Array): {
  readonly bytes: Uint8Array;
  readonly redacted: boolean;
} {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return { bytes: new Uint8Array(bytes), redacted: false };
  }

  const patternRedacted = redactRuntimeMessage(text);
  const structuredRedacted = sanitizeStructuredText(patternRedacted);
  const redacted = structuredRedacted !== text;
  return redacted
    ? { bytes: new TextEncoder().encode(structuredRedacted), redacted: true }
    : { bytes: new Uint8Array(bytes), redacted: false };
}

function sanitizeStructuredText(text: string): string {
  try {
    const value: unknown = JSON.parse(text);
    return JSON.stringify(redactRuntimeValue(value));
  } catch {
    return text;
  }
}

function safeRelativePath(relativePath: string): string {
  if (
    relativePath.startsWith('/')
    || relativePath.startsWith('\\')
    || /^[a-zA-Z]:/.test(relativePath)
    || relativePath.split(/[\\/]/).some((segment) => segment === '..' || segment.length === 0)
  ) {
    throw new Error('Diagnostic bundle path must stay inside the selected directory.');
  }
  return relativePath.replace(/\\/g, '/');
}

function sanitizeDirectoryName(traceId: string): string {
  const sanitized = traceId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
  return sanitized || 'unknown';
}
