// Resolves normalized memory candidates against active records without
// touching persistence. Callers apply the returned patches in their own layer.
import type { MemoryRecord } from './legacy-contracts/memory-contracts';
import { normalizeMemoryText } from './text-normalization';

export type MemoryResolutionDecision =
  | { action: 'create'; newRecord: MemoryRecord }
  | { action: 'update_existing'; targetMemoryId: string; recordPatch: Partial<MemoryRecord>; reason: 'exact_dedupe' | 'near_duplicate' }
  | { action: 'supersede'; supersededMemoryId: string; newRecord: MemoryRecord; oldRecordPatch: Partial<MemoryRecord>; reason: 'more_specific' }
  | { action: 'conflict'; conflictingMemoryId: string; reason: 'opposing_preference' | 'opposing_project_fact' | 'opposing_constraint' };

export function resolveMemoryCandidate(input: {
  candidate: MemoryRecord;
  existingActiveRecords: MemoryRecord[];
  now: string;
  createMemoryId: () => string;
}): MemoryResolutionDecision {
  const comparableRecords = input.existingActiveRecords.filter((record) => isComparable(record, input.candidate));

  for (const existing of comparableRecords) {
    if (existing.dedupeKey === input.candidate.dedupeKey
      && existing.normalizedText === input.candidate.normalizedText) {
      return {
        action: 'update_existing',
        targetMemoryId: existing.memoryId,
        reason: 'exact_dedupe',
        recordPatch: mergePatch(existing, input.candidate, input.now),
      };
    }
  }

  for (const existing of comparableRecords) {
    const conflict = detectConflict(existing, input.candidate);
    if (conflict) {
      return {
        action: 'conflict',
        conflictingMemoryId: existing.memoryId,
        reason: conflict,
      };
    }
  }

  for (const existing of comparableRecords) {
    if (tokenJaccard(existing.normalizedText, input.candidate.normalizedText) >= 0.86) {
      return {
        action: 'update_existing',
        targetMemoryId: existing.memoryId,
        reason: 'near_duplicate',
        recordPatch: mergePatch(existing, input.candidate, input.now),
      };
    }
  }

  for (const existing of comparableRecords) {
    if (isMoreSpecific(input.candidate, existing)) {
      const memoryId = input.createMemoryId();
      return {
        action: 'supersede',
        supersededMemoryId: existing.memoryId,
        reason: 'more_specific',
        newRecord: {
          ...input.candidate,
          memoryId,
          status: 'active',
          createdAt: input.now,
          updatedAt: input.now,
        },
        oldRecordPatch: {
          status: 'superseded',
          supersededById: memoryId,
          updatedAt: input.now,
        },
      };
    }
  }

  return {
    action: 'create',
    newRecord: {
      ...input.candidate,
      memoryId: input.createMemoryId(),
      status: 'active',
      createdAt: input.now,
      updatedAt: input.now,
    },
  };
}

function isComparable(record: MemoryRecord, candidate: MemoryRecord): boolean {
  return record.status === 'active'
    && record.scope === candidate.scope
    && (record.projectId ?? null) === (candidate.projectId ?? null)
    && record.kind === candidate.kind;
}

function mergePatch(existing: MemoryRecord, candidate: MemoryRecord, now: string): Partial<MemoryRecord> {
  return {
    updatedAt: now,
    confidence: Math.max(existing.confidence ?? 0, candidate.confidence ?? 0),
    evidence: [...(existing.evidence ?? []), ...(candidate.evidence ?? [])],
  };
}

function detectConflict(
  existing: MemoryRecord,
  candidate: MemoryRecord,
): 'opposing_preference' | 'opposing_project_fact' | 'opposing_constraint' | null {
  const existingText = normalizeMemoryText(`${existing.content} ${existing.normalizedText}`);
  const candidateText = normalizeMemoryText(`${candidate.content} ${candidate.normalizedText}`);

  if (hasAny(existingText, ['简洁', 'concise', 'brief']) && hasAny(candidateText, ['详细', 'detailed', 'thorough'])) {
    return 'opposing_preference';
  }
  if (hasAny(candidateText, ['简洁', 'concise', 'brief']) && hasAny(existingText, ['详细', 'detailed', 'thorough'])) {
    return 'opposing_preference';
  }

  const existingPackageManager = packageManagerMention(existingText);
  const candidatePackageManager = packageManagerMention(candidateText);
  if (existingPackageManager && candidatePackageManager && existingPackageManager !== candidatePackageManager) {
    return 'opposing_project_fact';
  }

  const existingDocLanguage = documentationLanguage(existingText);
  const candidateDocLanguage = documentationLanguage(candidateText);
  if (existingDocLanguage && candidateDocLanguage && existingDocLanguage !== candidateDocLanguage) {
    return 'opposing_constraint';
  }

  return null;
}

function isMoreSpecific(candidate: MemoryRecord, existing: MemoryRecord): boolean {
  const candidateText = normalizeMemoryText(candidate.normalizedText || candidate.content);
  const existingText = normalizeMemoryText(existing.normalizedText || existing.content);
  if (candidateText.length <= existingText.length) {
    return false;
  }
  if (candidateText.includes(existingText)) {
    return true;
  }

  const candidateTokens = tokenSet(candidateText);
  const existingTokens = tokenSet(existingText);
  const shared = [...existingTokens].filter((token) => candidateTokens.has(token));
  const extra = [...candidateTokens].filter((token) => !existingTokens.has(token));
  return shared.length >= Math.min(2, existingTokens.size) && extra.length >= 2;
}

function tokenJaccard(left: string, right: string): number {
  const leftTokens = tokenSet(left);
  const rightTokens = tokenSet(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return 0;
  }
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return intersection / union;
}

function tokenSet(value: string): Set<string> {
  const normalized = normalizeMemoryText(value);
  const tokens = normalized.split(/\s+/).filter(Boolean);
  const grams = new Set(tokens);
  for (const token of tokens) {
    if (/[\p{Script=Han}]/u.test(token) && token.length > 1) {
      for (let index = 0; index < token.length - 1; index += 1) {
        grams.add(token.slice(index, index + 2));
      }
    }
  }
  return grams;
}

function hasAny(text: string, values: string[]): boolean {
  return values.some((value) => text.includes(normalizeMemoryText(value)));
}

function packageManagerMention(text: string): 'npm' | 'pnpm' | 'yarn' | null {
  if (/\bpnpm\b/.test(text)) return 'pnpm';
  if (/\byarn\b/.test(text)) return 'yarn';
  if (/\bnpm\b/.test(text)) return 'npm';
  return null;
}

function documentationLanguage(text: string): 'zh' | 'en' | null {
  if (hasAny(text, ['中文', 'chinese'])) return 'zh';
  if (hasAny(text, ['英文', 'english'])) return 'en';
  return null;
}
