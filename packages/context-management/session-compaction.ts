import type { ModelInputContextSourceRef } from '@megumi/shared/model-input-context-contracts';
import type {
  SessionContextInput,
  SessionHistoryEntry,
  SessionRuntimeFact,
  SessionSummaryEntry,
} from '@megumi/shared/session-context-contracts';
import { estimateModelInputContextTokens } from './context-budget';

export const RUNTIME_FACT_MAX_CHARS = 1200;

export interface PrepareSessionCompactionInputOptions {
  sessionId: string;
  builtAt: string;
  sessionContext: SessionContextInput;
  keepRecentTokens: number;
  tokensBefore: number;
}

export interface PreparedSessionCompactionInput {
  sessionId: string;
  builtAt: string;
  tokensBefore: number;
  firstKeptSourceRef: ModelInputContextSourceRef;
  previousSummaryEntries: SessionSummaryEntry[];
  historyEntriesToSummarize: SessionHistoryEntry[];
  runtimeFactsToSummarize: SessionRuntimeFact[];
  keptHistoryEntries: SessionHistoryEntry[];
}

export function prepareSessionCompactionInput(
  options: PrepareSessionCompactionInputOptions,
): PreparedSessionCompactionInput | null {
  const { sessionId, builtAt, sessionContext, keepRecentTokens, tokensBefore } = options;

  if (keepRecentTokens < 0) {
    throw new Error('keepRecentTokens must be non-negative');
  }

  const completedHistoryEntries = (sessionContext.historyEntries ?? []).filter(
    (entry) => entry.status === 'completed',
  );
  if (completedHistoryEntries.length < 2) {
    return null;
  }

  const keptHistoryEntries: SessionHistoryEntry[] = [];
  let keptTokens = 0;

  for (let index = completedHistoryEntries.length - 1; index >= 0; index -= 1) {
    const entry = completedHistoryEntries[index];
    const tokenEstimate = estimateModelInputContextTokens(`[${entry.role}] ${entry.text}`);

    keptHistoryEntries.unshift(entry);
    keptTokens += tokenEstimate;

    if (keptTokens >= keepRecentTokens) {
      break;
    }
  }

  const firstKeptHistoryEntry = keptHistoryEntries[0];
  if (!firstKeptHistoryEntry) {
    return null;
  }

  const firstKeptIndex = completedHistoryEntries.findIndex(
    (entry) => entry.entryId === firstKeptHistoryEntry.entryId,
  );
  if (firstKeptIndex <= 0) {
    return null;
  }

  return {
    sessionId,
    builtAt,
    tokensBefore,
    firstKeptSourceRef: firstKeptHistoryEntry.sourceRef,
    previousSummaryEntries: sessionContext.summaryEntries ?? [],
    historyEntriesToSummarize: completedHistoryEntries.slice(0, firstKeptIndex),
    runtimeFactsToSummarize: sessionContext.runtimeFacts ?? [],
    keptHistoryEntries,
  };
}

export function serializeSessionCompactionInput(
  prepared: PreparedSessionCompactionInput,
): string {
  const lines: string[] = [];

  lines.push('# Previous summaries');
  for (const summary of prepared.previousSummaryEntries) {
    lines.push(`[${summary.summaryKind ?? 'explicit'}] ${summary.text ?? ''}`);
  }

  lines.push('');
  lines.push('# Conversation history to summarize');
  for (const entry of prepared.historyEntriesToSummarize) {
    lines.push(`[${entry.role}] ${entry.text ?? ''}`);
  }

  lines.push('');
  lines.push('# Runtime facts to summarize');
  for (const fact of prepared.runtimeFactsToSummarize) {
    lines.push(
      `[runtime_fact:${fact.factKind}] ${truncateRuntimeFactText(fact.text ?? '')}`,
    );
  }

  return lines.join('\n').trim();
}

function truncateRuntimeFactText(text: string): string {
  if (text.length <= RUNTIME_FACT_MAX_CHARS) {
    return text;
  }

  return `${text.slice(0, RUNTIME_FACT_MAX_CHARS)}\n[truncated]`;
}
