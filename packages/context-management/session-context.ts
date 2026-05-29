import type {
  ModelInputContextExcludedSource,
  SessionPart,
} from '@megumi/shared/model-input-context-contracts';
import type {
  SessionContextInput,
  SessionHistoryEntry,
  SessionRuntimeFact,
  SessionSummaryEntry,
} from '@megumi/shared/session-context-contracts';

export interface BuildSessionContextPartsInput {
  input?: SessionContextInput;
  builtAt: string;
}

export interface BuildSessionContextPartsResult {
  parts: SessionPart[];
  excludedSources: ModelInputContextExcludedSource[];
}

const MAX_MODEL_INPUT_PART_ID_LENGTH = 128;

export function buildSessionContextParts(input: BuildSessionContextPartsInput): BuildSessionContextPartsResult {
  if (!input.input) {
    return {
      parts: [],
      excludedSources: [],
    };
  }

  const excludedSources: ModelInputContextExcludedSource[] = [];
  const completedHistoryEntries: SessionHistoryEntry[] = [];

  for (const entry of input.input.historyEntries ?? []) {
    if (entry.status === 'completed') {
      completedHistoryEntries.push(entry);
    } else {
      excludedSources.push({
        sourceRef: entry.sourceRef,
        reason: `session_history_status_${entry.status}`,
      });
    }
  }

  const retainedHistoryEntries = retainRecentHistoryEntries(
    completedHistoryEntries,
    input.input.maxHistoryEntries,
    excludedSources,
  );

  return {
    parts: [
      ...(input.input.summaryEntries ?? []).map(summaryPart),
      ...retainedHistoryEntries.map(historyPart),
      ...(input.input.runtimeFacts ?? []).map(runtimeFactPart),
    ],
    excludedSources,
  };
}

function retainRecentHistoryEntries(
  entries: SessionHistoryEntry[],
  maxHistoryEntries: number | undefined,
  excludedSources: ModelInputContextExcludedSource[],
): SessionHistoryEntry[] {
  if (!maxHistoryEntries || entries.length <= maxHistoryEntries) {
    return entries;
  }

  const dropCount = entries.length - maxHistoryEntries;
  for (const entry of entries.slice(0, dropCount)) {
    excludedSources.push({
      sourceRef: entry.sourceRef,
      reason: 'outside_recent_session_window',
    });
  }

  return entries.slice(dropCount);
}

function summaryPart(entry: SessionSummaryEntry): SessionPart {
  return {
    partId: sessionPartId('part:session-summary:', entry.summaryId),
    kind: 'session',
    sessionKind: 'session_summary',
    text: entry.text,
    sourceRefs: [entry.sourceRef],
    priority: 45,
    budgetStatus: 'included_reduced',
    metadata: {
      summaryKind: entry.summaryKind ?? 'explicit',
    },
  };
}

function historyPart(entry: SessionHistoryEntry): SessionPart {
  return {
    partId: sessionPartId('part:session-history:', entry.entryId),
    kind: 'session',
    sessionKind: 'session_history',
    text: `[${entry.role}] ${entry.text}`,
    sourceRefs: [entry.sourceRef],
    priority: entry.role === 'user' ? 60 : 55,
    budgetStatus: 'included_reduced',
    metadata: {
      role: entry.role,
      status: entry.status,
    },
  };
}

function runtimeFactPart(fact: SessionRuntimeFact): SessionPart {
  return {
    partId: sessionPartId('part:session-runtime-fact:', fact.factId),
    kind: 'session',
    sessionKind: 'session_runtime_fact',
    text: `[${fact.factKind}] ${fact.text}`,
    sourceRefs: [fact.sourceRef],
    priority: priorityForRuntimeFact(fact),
    budgetStatus: 'included_reduced',
    metadata: {
      factKind: fact.factKind,
      ...(fact.severity ? { severity: fact.severity } : {}),
    },
  };
}

function priorityForRuntimeFact(fact: SessionRuntimeFact): number {
  if (fact.severity === 'error') {
    return 80;
  }
  if (fact.severity === 'warning') {
    return 75;
  }
  return 70;
}

function sessionPartId(prefix: string, rawId: string): string {
  const fullId = `${prefix}${rawId}`;
  if (fullId.length <= MAX_MODEL_INPUT_PART_ID_LENGTH) {
    return fullId;
  }

  const suffix = `:${stableHash(rawId)}`;
  const retainedRawIdLength = MAX_MODEL_INPUT_PART_ID_LENGTH - prefix.length - suffix.length;
  return `${prefix}${rawId.slice(0, retainedRawIdLength)}${suffix}`;
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(36);
}
