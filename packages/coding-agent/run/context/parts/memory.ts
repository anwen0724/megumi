// Builds model context parts for recalled long-term memory snippets.
import type { ModelInputContextPartDraft } from '../context-budget';
import type { JsonObject } from '@megumi/shared/primitives';

export interface ModelInputMemoryRecallSource {
  sourceId: string;
  text: string;
  memoryIds?: string[];
  loadedAt?: string;
  metadata?: JsonObject;
}

export function memoryRecallParts(
  sources: ModelInputMemoryRecallSource[],
  builtAt: string,
): ModelInputContextPartDraft[] {
  return sources.map((source): ModelInputContextPartDraft => ({
    partId: `part:memory:${source.sourceId}`,
    kind: 'memory',
    memoryKind: 'memory_recall',
    text: source.text,
    memoryIds: source.memoryIds,
    sourceRefs: [{
      sourceId: source.sourceId,
      sourceKind: 'memory_recall',
      sourceUri: `memory-recall://${source.sourceId}`,
      loadedAt: source.loadedAt ?? builtAt,
      ...(source.metadata ? { metadata: source.metadata } : {}),
    }],
    priority: 55,
    budgetClass: 'contextual',
    required: false,
  }));
}
