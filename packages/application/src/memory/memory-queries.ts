/* Owns bounded, versioned text queries for Memory management and task consumers. */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { MemoryFiles, MemoryDocumentSlice } from './memory-files';
import type { MemorySources } from './source-contracts';
import type { MemoryFailure } from './contracts';

const Collection = z.enum(['summary', 'memory', 'rollouts', 'skills', 'raw']);
export const MemorySearchSchema = z.object({ terms: z.array(z.string().trim().min(1).max(128)).min(1).max(5),
  collections: z.array(Collection).min(1).max(5).optional(), match: z.enum(['any', 'all']).optional(),
  limit: z.number().int().min(1).max(50).optional(), cursor: z.string().max(4096).optional() }).strict();
export const MemoryReadSchema = z.object({ path: z.string().min(1), startLine: z.number().int().positive().optional(),
  lineCount: z.number().int().min(1).max(400).optional(), expectedVersion: z.string().optional() }).strict();
export const MemorySourceSchema = z.object({ sourceRef: z.string().min(1).max(4096),
  cursor: z.string().max(4096).optional(), limit: z.number().int().min(1).max(50).optional() }).strict();
export type MemorySearchRequest = z.infer<typeof MemorySearchSchema>;
export type MemoryReadRequest = z.infer<typeof MemoryReadSchema>;
export type MemorySourceRequest = z.infer<typeof MemorySourceSchema>;
const Cursor = z.object({ revision: z.string(), offset: z.number().int().nonnegative(), character: z.number().int().nonnegative().optional() }).strict();
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const encode = (value: z.infer<typeof Cursor>) => Buffer.from(JSON.stringify(value)).toString('base64url');
function decode(value: string | undefined, revision: string) {
  if (!value) return { revision, offset: 0, character: 0 };
  let cursor;
  try { cursor = Cursor.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))); }
  catch { throw new Error('INVALID_ARGUMENT'); }
  if (cursor.revision !== revision) throw new Error('VERSION_CONFLICT');
  return cursor;
}
/** Converts boundary failures without returning file contents or host paths as error text. */
export function memoryQueryFailure(error: unknown): MemoryFailure {
  const code = error instanceof Error && ['INVALID_ARGUMENT', 'VERSION_CONFLICT', 'PATH_DENIED', 'OUTPUT_INVALID', 'SOURCE_UNAVAILABLE'].includes(error.message)
    ? error.message : error instanceof z.ZodError ? 'INVALID_ARGUMENT' : 'STORAGE_FAILED';
  return { status: 'failed', error: { code, message: `Memory query failed: ${code}.` } };
}
/** Reads management data without starting production or changing source qualification. */
export function createMemoryQueries(options: { files: MemoryFiles; sources: MemorySources; excluded: (sessionId: string) => boolean }) {
  return {
    searchDocuments(request: MemorySearchRequest) {
      try {
        const input = MemorySearchSchema.parse(request);
        const collections = new Set(input.collections ?? ['memory']);
        const paths = options.files.paths().filter(file => collections.has(file === 'MEMORY.md' ? 'memory'
          : file === 'memory_summary.md' ? 'summary' : file === 'raw_memories.md' ? 'raw' : file.startsWith('skills/') ? 'skills' : 'rollouts'));
        const versions = paths.map(file => [file, options.files.readLines(file, 1, 1)?.version]);
        const revision = hash({ versions, terms: input.terms, match: input.match ?? 'any' });
        const cursor = decode(input.cursor, revision);
        const terms = input.terms.map(term => term.toLowerCase());
        const hits: (MemoryDocumentSlice & { line: number })[] = [];
        let ordinal = 0; let characters = 0; let more = false;
        outer: for (const file of paths) {
          for (const { line, text: original } of options.files.lines(file)) {
            const text = original.toLowerCase();
            const matches = terms.map(term => text.includes(term));
            if (!(input.match === 'all' ? matches.every(Boolean) : matches.some(Boolean))) continue;
            if (ordinal++ < cursor.offset) continue;
            if (hits.length >= (input.limit ?? 20) || characters >= 16000) { more = true; break outer; }
            const excerpt = options.files.readLines(file, Math.max(1, line - 1), line === 1 ? 2 : 3)!;
            if (excerpt.version !== versions.find(pair => pair[0] === file)?.[1]) throw new Error('VERSION_CONFLICT');
            const content = excerpt.content.slice(0, 16000 - characters);
            hits.push({ ...excerpt, content, line, truncated: excerpt.truncated || content.length < excerpt.content.length,
              lastLineComplete: excerpt.lastLineComplete && content.length === excerpt.content.length });
            characters += content.length;
          }
        }
        for (const [file, version] of versions) if (file && options.files.readLines(file, 1, 1)?.version !== version) throw new Error('VERSION_CONFLICT');
        return { status: 'ok' as const, hits, ...(more ? { nextCursor: encode({ revision, offset: cursor.offset + hits.length }) } : {}) };
      } catch (error) { return memoryQueryFailure(error); }
    },
    readSource(request: MemorySourceRequest) {
      try {
        const input = MemorySourceSchema.parse(request);
        const result = options.sources.readSource(input.sourceRef);
        if (result.status !== 'found') return result;
        if (options.excluded(result.snapshot.sessionId)) throw new Error('SOURCE_UNAVAILABLE');
        const cursor = decode(input.cursor, hash(input.sourceRef));
        const messages: { messageId: string; kind: string; text: string; characterOffset: number; truncated: boolean }[] = [];
        let index = cursor.offset; let character = cursor.character ?? 0; let remaining = 16000;
        while (index < result.snapshot.messages.length && messages.length < (input.limit ?? 20) && remaining > 0) {
          const message = result.snapshot.messages[index];
          // Only original user content and saved reply/tool bodies are evidence; host receipts are not.
          const content = message.message_kind === 'user_message' ? message.display_content : message.content;
          const text = JSON.stringify(content);
          const part = text.slice(character, character + remaining);
          const truncated = character + part.length < text.length;
          messages.push({ messageId: message.message_id, kind: message.message_kind, text: part, characterOffset: character, truncated });
          remaining -= part.length;
          if (truncated) { character += part.length; break; }
          index++; character = 0;
        }
        return { status: 'found' as const, sessionId: result.snapshot.sessionId, workspaceId: result.snapshot.workspaceId,
          sourceVersion: result.snapshot.sourceVersion, sourceChanged: result.sourceChanged, messages,
          ...(index < result.snapshot.messages.length ? { nextCursor: encode({ revision: hash(input.sourceRef), offset: index, character }) } : {}) };
      } catch (error) { return memoryQueryFailure(error); }
    },
  };
}
