import type { ContextBudgetPolicy } from '@megumi/shared/context-budget-contracts';
import type { ModelInputContext } from '@megumi/shared/model-input-context-contracts';
import type { ModelInputContextSourceRef } from '@megumi/shared/model-input-context-contracts';
import type {
  SessionContextInput,
  SessionHistoryEntry,
  SessionRuntimeFact,
  SessionSummaryEntry,
} from '@megumi/shared/session-context-contracts';
import { estimateModelInputContextTokens } from './context-budget';
import { buildModelInputContext } from './model-input-context-builder';

export const RUNTIME_FACT_MAX_CHARS = 1200;

export const SESSION_COMPACTION_SUMMARY_SYSTEM_PROMPT = [
  'You are a context summarization assistant.',
  'Read the serialized conversation and produce a structured summary.',
  'Do not continue the conversation.',
  'Do not answer questions from the conversation.',
  'Only output the structured summary.',
].join(' ');

const SESSION_COMPACTION_SUMMARY_PROMPT = [
  'Create a structured context checkpoint summary that another LLM will use to continue the work.',
  '',
  'Use this exact format:',
  '',
  '## Goal',
  '',
  '## Constraints & Preferences',
  '',
  '## Progress',
  '### Done',
  '### In Progress',
  '### Blocked',
  '',
  '## Key Decisions',
  '',
  '## Next Steps',
  '',
  '## Critical Context',
  '',
  '<read-files>',
  '</read-files>',
  '',
  '<modified-files>',
  '</modified-files>',
].join('\n');

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

export interface SessionCompactionBudgetPressureResult {
  shouldCompact: boolean;
  triggerReason: 'context_budget_pressure';
  tokensBefore: number;
  availableInputTokens: number;
}

export interface BuildSessionCompactionSummaryInputContextInput {
  contextId: string;
  sessionId: string;
  runId: string;
  stepId: string;
  builtAt: string;
  prepared: PreparedSessionCompactionInput;
  budgetPolicy: ContextBudgetPolicy;
}

export function shouldRunSessionCompaction(input: {
  preflightInputContext: ModelInputContext;
  budgetPolicy: ContextBudgetPolicy;
}): SessionCompactionBudgetPressureResult {
  const availableInputTokens = Math.max(
    0,
    input.budgetPolicy.modelContextWindow - input.budgetPolicy.reservedOutputTokens,
  );
  const tokensBefore = input.preflightInputContext.budget.inputTokenEstimate;

  return {
    shouldCompact: tokensBefore > availableInputTokens,
    triggerReason: 'context_budget_pressure',
    tokensBefore,
    availableInputTokens,
  };
}

export function buildSessionCompactionSummaryInputContext(
  input: BuildSessionCompactionSummaryInputContextInput,
): ModelInputContext {
  const serialized = serializeSessionCompactionInput(input.prepared);
  const prompt = [
    '<conversation>',
    serialized,
    '</conversation>',
    '',
    SESSION_COMPACTION_SUMMARY_PROMPT,
  ].join('\n');

  return buildModelInputContext({
    contextId: input.contextId,
    sessionId: input.sessionId,
    runId: input.runId,
    stepId: input.stepId,
    buildReason: 'session_compaction_summary',
    builtAt: input.builtAt,
    budgetPolicy: input.budgetPolicy,
    parts: [
      {
        partId: `part:session-compaction:system:${input.stepId}`,
        kind: 'instruction',
        instructionKind: 'system',
        text: SESSION_COMPACTION_SUMMARY_SYSTEM_PROMPT,
        sourceRefs: [{
          sourceId: `session-compaction-system:${input.stepId}`,
          sourceKind: 'system_instruction',
          sourceUri: `session-compaction-system://${input.stepId}`,
          loadedAt: input.builtAt,
        }],
        priority: 100,
        required: true,
      },
      {
        partId: `part:session-compaction:input:${input.stepId}`,
        kind: 'current_turn',
        role: 'user',
        text: prompt,
        sourceRefs: [{
          sourceId: `session-compaction-input:${input.stepId}`,
          sourceKind: 'session_runtime_fact',
          sourceUri: `session-compaction-input://${input.stepId}`,
          loadedAt: input.builtAt,
          metadata: {
            summarizedSourceCount:
              input.prepared.historyEntriesToSummarize.length
              + input.prepared.runtimeFactsToSummarize.length,
          },
        }],
        priority: 95,
        required: true,
      },
    ],
  });
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

export function extractSessionCompactionFileMetadata(summary: string): {
  readFiles?: string[];
  modifiedFiles?: string[];
} {
  return {
    ...extractTaggedLines(summary, 'read-files', 'readFiles'),
    ...extractTaggedLines(summary, 'modified-files', 'modifiedFiles'),
  };
}

function extractTaggedLines<TName extends 'readFiles' | 'modifiedFiles'>(
  text: string,
  tagName: string,
  outputName: TName,
): Partial<Record<TName, string[]>> {
  const startTag = `<${tagName}>`;
  const endTag = `</${tagName}>`;
  const start = text.indexOf(startTag);
  const end = text.indexOf(endTag);

  if (start < 0 || end <= start) {
    return {};
  }

  const values = text
    .slice(start + startTag.length, end)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  return values.length > 0
    ? { [outputName]: values } as Partial<Record<TName, string[]>>
    : {};
}

function truncateRuntimeFactText(text: string): string {
  if (text.length <= RUNTIME_FACT_MAX_CHARS) {
    return text;
  }

  return `${text.slice(0, RUNTIME_FACT_MAX_CHARS)}\n[truncated]`;
}
