/* Defines host-read receipts and validates reply citations without copying knowledge bodies. */
import { z } from 'zod';

export const MemoryCitationSchema = z.object({ path: z.string().min(1), fileVersion: z.string().min(1),
  startLine: z.number().int().positive(), endLine: z.number().int().positive(),
  sourceIds: z.array(z.string().min(1)).min(1), sourceVersions: z.array(z.string().min(1)).min(1) }).strict()
  .refine(value => value.endLine >= value.startLine && value.sourceIds.length === value.sourceVersions.length);
export type MemoryCitation = z.infer<typeof MemoryCitationSchema>;
export const MemoryEvidenceSchema = z.object({ executionId: z.string(), controlRevision: z.number().int().nonnegative(),
  snapshotId: z.string().optional(), reads: z.array(MemoryCitationSchema) }).strict();
export type MemoryEvidence = z.infer<typeof MemoryEvidenceSchema>;

/** Accepts only ranges and source versions that the host actually supplied during this run. */
export function validateMemoryCitations(text: string, evidence: MemoryEvidence): { status: 'valid' | 'absent' | 'invalid'; citations: MemoryCitation[] } {
  const matches = [...text.matchAll(/<memory_citations>([\s\S]*?)<\/memory_citations>/g)];
  if (!matches.length) return { status: text.includes('<memory_citations') ? 'invalid' : 'absent', citations: [] };
  try {
    if (matches.length !== 1 || !text.trimEnd().endsWith('</memory_citations>')) throw new Error();
    const citations = z.array(MemoryCitationSchema).min(1).max(100).parse(JSON.parse(matches[0][1]));
    for (const citation of citations) {
      for (let index = 0; index < citation.sourceIds.length; index++) {
        const spans = evidence.reads.filter(read => read.path === citation.path && read.fileVersion === citation.fileVersion
          && read.sourceIds.some((id, at) => id === citation.sourceIds[index] && read.sourceVersions[at] === citation.sourceVersions[index]))
          .sort((left, right) => left.startLine - right.startLine);
        let nextLine = citation.startLine;
        for (const span of spans) if (span.startLine <= nextLine && span.endLine >= nextLine) nextLine = span.endLine + 1;
        if (nextLine <= citation.endLine) throw new Error();
      }
    }
    return { status: 'valid', citations };
  } catch { return { status: 'invalid', citations: [] }; }
}
