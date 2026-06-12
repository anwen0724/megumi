// Selects long-term memories for recall using deterministic lexical scoring
// and builds run-scoped snapshots. It does not inspect persistence.
import type {
  MemoryKind,
  MemoryRecallDiagnostic,
  MemoryRecallResult,
  MemoryRecallSnapshot,
  MemoryRecord,
  MemoryScope,
} from '@megumi/shared/memory';
import { estimateMemoryTokens, normalizeMemoryText } from './text-normalization';

export interface RecallScore {
  eligible: boolean;
  score: number;
  reason: string;
}

export interface RecallScoreInput {
  projectId?: string | null;
  query?: string;
  scopes?: MemoryScope[];
  kinds?: MemoryKind[];
}

export interface SelectMemoryRecallResultsInput {
  recallRequestId: string;
  records: MemoryRecord[];
  projectId?: string | null;
  query?: string;
  limit: number;
  budget?: number;
  now: string;
  scopes?: MemoryScope[];
  kinds?: MemoryKind[];
}

export function scoreMemoryRecordForRecall(record: MemoryRecord, input: RecallScoreInput): RecallScore {
  if (record.status !== 'active') {
    return { eligible: false, score: 0, reason: 'inactive_status' };
  }
  if (input.scopes && !input.scopes.includes(record.scope)) {
    return { eligible: false, score: 0, reason: 'scope_mismatch' };
  }
  if (input.kinds && !input.kinds.includes(record.kind)) {
    return { eligible: false, score: 0, reason: 'kind_mismatch' };
  }
  if (record.scope === 'project' && input.projectId && record.projectId !== input.projectId) {
    return { eligible: false, score: 0, reason: 'scope_mismatch' };
  }

  const searchable = normalizeMemoryText(`${record.summary ?? ''} ${record.content} ${record.normalizedText}`);
  const queryTokens = tokenize(input.query ?? '');
  const queryMatches = queryTokens.filter((token) => searchable.includes(token)).length;
  if (queryTokens.length > 0 && queryMatches === 0) {
    return { eligible: false, score: 0, reason: 'query_mismatch' };
  }

  const lexicalScore = queryTokens.length === 0 ? 0.15 : queryMatches / queryTokens.length;
  const scopeScore = record.scope === 'project' ? 0.25 : 0.1;
  const kindScore = kindPriority(record.kind);
  const recencyScore = recencyBoost(record, input);
  const confidenceScore = (record.confidence ?? 0.5) * 0.1;
  const usageScore = Math.min(record.useCount ?? 0, 10) * 0.005;
  const score = clamp01(scopeScore + kindScore + lexicalScore * 0.3 + recencyScore + confidenceScore + usageScore);
  return {
    eligible: true,
    score,
    reason: [
      record.scope === 'project' ? 'project_scope' : 'user_scope',
      'kind_priority',
      queryMatches > 0 ? 'lexical_match' : 'contextual',
    ].join(' '),
  };
}

export function selectMemoryRecallResults(input: SelectMemoryRecallResultsInput): MemoryRecallResult[] {
  let spent = 0;
  return input.records
    .map((record) => ({ record, score: scoreMemoryRecordForRecall(record, input) }))
    .filter((entry) => entry.score.eligible)
    .sort((left, right) => right.score.score - left.score.score || left.record.memoryId.localeCompare(right.record.memoryId))
    .slice(0, input.limit)
    .map((entry, index) => {
      const tokenEstimate = estimateMemoryTokens(entry.record.content);
      const selectedForContext = input.budget === undefined || spent + tokenEstimate <= input.budget;
      if (selectedForContext) {
        spent += tokenEstimate;
      }
      return {
        recallResultId: `${input.recallRequestId}:result:${index + 1}`,
        recallRequestId: input.recallRequestId,
        memoryId: entry.record.memoryId,
        score: entry.score.score,
        rank: index + 1,
        selectedForContext,
        reason: entry.score.reason,
        createdAt: input.now,
        metadata: {
          tokenEstimate,
          scope: entry.record.scope,
          kind: entry.record.kind,
          contentPreview: clipPreview(entry.record.content),
        },
      };
    });
}

export function buildMemoryRecallSnapshot(input: {
  snapshotId: string;
  recallRequestId: string;
  sessionId: string;
  runId: string;
  projectId?: string | null;
  query: string;
  records: MemoryRecord[];
  maxResults: number;
  maxTokens: number;
  now: string;
}): MemoryRecallSnapshot {
  const diagnostics: MemoryRecallDiagnostic[] = [];
  for (const record of input.records) {
    const score = scoreMemoryRecordForRecall(record, {
      projectId: input.projectId,
      query: input.query,
    });
    if (!score.eligible) {
      diagnostics.push({
        code: 'candidate_excluded',
        severity: 'info',
        reason: score.reason,
        memoryId: record.memoryId,
        metadata: {},
      });
    }
  }

  const selectedResults = selectMemoryRecallResults({
    recallRequestId: input.recallRequestId,
    records: input.records,
    projectId: input.projectId,
    query: input.query,
    limit: input.maxResults,
    budget: input.maxTokens,
    now: input.now,
  });
  const recordById = new Map(input.records.map((record) => [record.memoryId, record]));
  for (const result of selectedResults) {
    if (!result.selectedForContext) {
      diagnostics.push({
        code: 'candidate_excluded',
        severity: 'info',
        reason: 'budget_exceeded',
        memoryId: result.memoryId,
        metadata: {
          tokenEstimate: result.metadata.tokenEstimate,
        },
      });
    }
  }

  const selected = selectedResults
    .filter((result) => result.selectedForContext)
    .map((result) => {
      const record = recordById.get(result.memoryId);
      const tokenEstimate = typeof result.metadata.tokenEstimate === 'number'
        ? result.metadata.tokenEstimate
        : 0;
      return {
        memoryId: result.memoryId,
        scope: record?.scope ?? 'project',
        kind: record?.kind ?? 'fact',
        content: record?.content ?? '',
        reason: result.reason,
        score: result.score,
        tokenEstimate,
      };
    });

  return {
    snapshotId: input.snapshotId,
    recallRequestId: input.recallRequestId,
    sessionId: input.sessionId,
    runId: input.runId,
    projectId: input.projectId ?? null,
    query: input.query,
    selected,
    diagnostics,
    budget: {
      maxTokens: input.maxTokens,
      estimatedTokens: selected.reduce((total, item) => total + (item.tokenEstimate ?? 0), 0),
      truncated: selectedResults.some((result) => !result.selectedForContext),
    },
    createdAt: input.now,
  };
}

function tokenize(value: string): string[] {
  return normalizeMemoryText(value).split(/\s+/).filter(Boolean);
}

function kindPriority(kind: MemoryKind): number {
  switch (kind) {
    case 'constraint':
      return 0.15;
    case 'decision':
      return 0.13;
    case 'preference':
      return 0.1;
    case 'fact':
      return 0.05;
  }
}

function recencyBoost(record: MemoryRecord, _input: RecallScoreInput): number {
  return (record.updatedAt ? 0.03 : 0) + (record.lastUsedAt ? 0.04 : 0);
}

function clipPreview(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > 1000 ? normalized.slice(0, 1000) : normalized;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(0.999, value));
}
