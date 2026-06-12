// Provides deterministic text normalization shared by memory capture,
// Markdown import, dedupe, and recall scoring. It has no IO or provider access.
import type { MemoryKind, MemoryScope } from '@megumi/shared/memory';

export interface MemoryDedupeKeyInput {
  scope: MemoryScope;
  projectId?: string | null;
  kind: MemoryKind;
  text: string;
}

export function normalizeMemoryPatternText(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[，。！？；：、“”‘’（）【】《》]/g, ' ')
    .replace(/[^\p{L}\p{N}_-]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function normalizeMemoryText(value: string): string {
  return normalizeMemoryPatternText(value);
}

export function buildMemoryDedupeKey(input: MemoryDedupeKeyInput): string {
  return `${input.scope}:${input.projectId ?? ''}:${input.kind}:${normalizeMemoryText(input.text)}`;
}

export function estimateMemoryTokens(value: string): number {
  return Math.ceil(value.length / 4);
}

export function clipMemoryEvidenceQuote(value: string, maxLength = 200): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength ? normalized.slice(0, maxLength) : normalized;
}
