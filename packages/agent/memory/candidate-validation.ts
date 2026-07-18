// Converts extraction or Markdown-import candidates into normalized,
// host-owned memory candidate data. It does not persist records.
import { z } from 'zod';
import type { MemoryEvidence, MemoryKind, MemoryRecordSource, MemoryScope } from './legacy-contracts/memory-contracts';
import { buildMemoryDedupeKey, clipMemoryEvidenceQuote, normalizeMemoryText } from './text-normalization';
import { validateMemorySafety } from './memory-security-policy';

const CandidateInputSchema = z.object({
  scope: z.enum(['user', 'project']),
  kind: z.enum(['preference', 'constraint', 'fact', 'decision']),
  text: z.string().min(1).max(4000),
  confidence: z.number().min(0).max(1),
  evidence: z.object({
    source: z.enum(['user_message', 'assistant_message', 'tool_result', 'source_file']).optional(),
    quote: z.string().max(200).optional(),
    filePath: z.string().min(1).optional(),
  }).optional(),
}).strict();

export interface MemoryCandidateValidationInput {
  candidate: unknown;
  source: MemoryRecordSource;
  now: string;
  projectId?: string | null;
  sourceRunId?: string | null;
  sourceSessionId?: string | null;
  sourceMessageId?: string | null;
  sourceToolCallId?: string | null;
  minConfidence?: number;
}

export interface ValidatedMemoryCandidate {
  scope: MemoryScope;
  projectId?: string | null;
  kind: MemoryKind;
  content: string;
  summary: string;
  normalizedText: string;
  dedupeKey: string;
  source: MemoryRecordSource;
  sourceRunId?: string | null;
  sourceSessionId?: string | null;
  sourceMessageId?: string | null;
  sourceToolCallId?: string | null;
  confidence: number;
  evidence: MemoryEvidence[];
  createdAt: string;
  updatedAt: string;
}

export type MemoryCandidateValidationResult =
  | { accepted: true; candidate: ValidatedMemoryCandidate }
  | { accepted: false; reason: 'invalid_schema' | 'project_scope_requires_project' | 'confidence_too_low' | string; diagnostic: string };

export function validateMemoryCandidate(input: MemoryCandidateValidationInput): MemoryCandidateValidationResult {
  const parsed = CandidateInputSchema.safeParse(input.candidate);
  if (!parsed.success) {
    return { accepted: false, reason: 'invalid_schema', diagnostic: parsed.error.issues.map((issue) => issue.message).join('; ') };
  }
  const candidate = parsed.data;
  if (candidate.scope === 'project' && !input.projectId) {
    return { accepted: false, reason: 'project_scope_requires_project', diagnostic: 'Project memory requires projectId.' };
  }
  if (candidate.confidence < (input.minConfidence ?? 0.4)) {
    return { accepted: false, reason: 'confidence_too_low', diagnostic: 'Candidate confidence was below threshold.' };
  }
  const safety = validateMemorySafety({ text: candidate.text, source: input.source === 'markdown_import' ? 'markdown_import' : 'capture' });
  if (!safety.accepted) {
    return { accepted: false, reason: safety.reason, diagnostic: safety.redactedSnippet };
  }
  const projectId = candidate.scope === 'project' ? input.projectId ?? null : null;
  return {
    accepted: true,
    candidate: {
      scope: candidate.scope,
      projectId,
      kind: candidate.kind,
      content: safety.sanitizedText,
      summary: safety.sanitizedText.length > 500 ? safety.sanitizedText.slice(0, 500) : safety.sanitizedText,
      normalizedText: normalizeMemoryText(safety.sanitizedText),
      dedupeKey: buildMemoryDedupeKey({ scope: candidate.scope, projectId, kind: candidate.kind, text: safety.sanitizedText }),
      source: input.source,
      sourceRunId: input.sourceRunId ?? null,
      sourceSessionId: input.sourceSessionId ?? null,
      sourceMessageId: input.sourceMessageId ?? null,
      sourceToolCallId: input.sourceToolCallId ?? null,
      confidence: candidate.confidence,
      evidence: candidate.evidence ? [toMemoryEvidence(candidate.evidence, input)] : [],
      createdAt: input.now,
      updatedAt: input.now,
    },
  };
}

function toMemoryEvidence(
  evidence: { source?: string; quote?: string; filePath?: string },
  input: MemoryCandidateValidationInput,
): MemoryEvidence {
  return {
    kind: evidence.source ?? 'message',
    runId: input.sourceRunId ?? undefined,
    sessionId: input.sourceSessionId ?? undefined,
    messageId: input.sourceMessageId ?? undefined,
    toolCallId: input.sourceToolCallId ?? undefined,
    filePath: evidence.filePath,
    metadata: evidence.quote ? { quote: clipMemoryEvidenceQuote(evidence.quote) } : {},
  } as MemoryEvidence;
}
