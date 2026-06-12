import type {
  MemoryCandidate,
  MemoryKind,
  MemoryPolicy,
  MemoryProposedBy,
  MemoryRecallResult,
  MemoryRecord,
  MemoryRiskLevel,
  MemoryScope,
  MemorySourceKind,
  MemorySourceRef,
} from '@megumi/shared/memory';

const MAX_SUMMARY_LENGTH = 500;
const MAX_CONTENT_PREVIEW_LENGTH = 1000;

const BLOCKED_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /\b(api[_-]?key|access[_-]?token|secret|credential|password)\b\s*[:=]\s*\S+/i,
  /\braw full prompt\b/i,
  /\braw provider body\b/i,
  /\braw restricted file content\b/i,
];

export interface DefaultMemoryPolicyInput {
  now: string;
  autoCaptureEnabled?: boolean;
}

export function createDefaultMemoryPolicy(input: DefaultMemoryPolicyInput): MemoryPolicy {
  return {
    allowedScopes: ['user', 'project'],
    allowedKinds: ['preference', 'constraint', 'fact', 'decision'],
    blockedSourceKinds: [],
    requiresReviewRiskLevels: ['medium', 'high'],
    blockedPatterns: BLOCKED_PATTERNS.map((pattern) => pattern.source),
    autoCaptureEnabled: input.autoCaptureEnabled ?? true,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export interface MemoryCandidatePolicyInput {
  policy: MemoryPolicy;
  scope: MemoryScope;
  kind: MemoryKind;
  sourceKinds: MemorySourceKind[];
  content: string;
}

export interface MemoryCandidatePolicyDecision {
  allowed: boolean;
  riskLevel: MemoryRiskLevel;
  reason: string;
}

export function evaluateMemoryCandidatePolicy(input: MemoryCandidatePolicyInput): MemoryCandidatePolicyDecision {
  if (!input.policy.autoCaptureEnabled) {
    return { allowed: false, riskLevel: 'blocked', reason: 'auto_capture_disabled' };
  }
  if (!input.policy.allowedScopes.includes(input.scope)) {
    return { allowed: false, riskLevel: 'blocked', reason: 'scope_not_allowed' };
  }
  if (!input.policy.allowedKinds.includes(input.kind)) {
    return { allowed: false, riskLevel: 'blocked', reason: 'kind_not_allowed' };
  }
  if (input.sourceKinds.some((kind) => input.policy.blockedSourceKinds.includes(kind))) {
    return { allowed: false, riskLevel: 'blocked', reason: 'source_kind_blocked' };
  }
  if (BLOCKED_PATTERNS.some((pattern) => pattern.test(input.content))) {
    return { allowed: false, riskLevel: 'blocked', reason: 'sensitive_content_blocked' };
  }
  const riskLevel: MemoryRiskLevel = input.scope === 'user' ? 'medium' : 'low';
  return { allowed: true, riskLevel, reason: 'allowed' };
}

export interface CreateMemoryCandidateDraftInput {
  candidateId: string;
  workspaceId?: string;
  projectId?: string;
  sessionId?: string;
  scope: MemoryScope;
  kind: MemoryKind;
  content: string;
  sourceRefs: MemorySourceRef[];
  proposedBy: MemoryProposedBy;
  now: string;
  confidence?: number;
  riskLevel?: MemoryRiskLevel;
}

export function createMemoryCandidateDraft(input: CreateMemoryCandidateDraftInput): MemoryCandidate {
  const content = normalizeSafeText(input.content, 4000);
  return {
    candidateId: input.candidateId,
    ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
    ...(input.projectId ? { projectId: input.projectId } : {}),
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    scope: input.scope,
    kind: input.kind,
    content,
    summary: normalizeSafeText(content, MAX_SUMMARY_LENGTH),
    sourceRefs: input.sourceRefs,
    confidence: input.confidence ?? 0.8,
    riskLevel: input.riskLevel ?? 'low',
    status: 'proposed',
    proposedBy: input.proposedBy,
    createdAt: input.now,
  };
}

export interface RecallScoringInput {
  scopes: MemoryScope[];
  kinds?: MemoryKind[];
  query?: string;
}

export interface RecallScore {
  eligible: boolean;
  score: number;
  reason: string;
}

export function scoreMemoryRecordForRecall(record: MemoryRecord, input: RecallScoringInput): RecallScore {
  if (record.status !== 'active') {
    return { eligible: false, score: 0, reason: 'inactive_status' };
  }
  if (!input.scopes.includes(record.scope)) {
    return { eligible: false, score: 0, reason: 'scope_mismatch' };
  }
  if (input.kinds && !input.kinds.includes(record.kind)) {
    return { eligible: false, score: 0, reason: 'kind_mismatch' };
  }

  const normalizedQuery = normalizeForSearch(input.query ?? '');
  const searchable = normalizeForSearch(`${record.summary ?? ''} ${record.content} ${record.normalizedText}`);
  const queryTokens = normalizedQuery ? normalizedQuery.split(/\s+/) : [];
  const queryMatches = queryTokens.filter((token) => searchable.includes(token)).length;
  if (queryTokens.length > 0 && queryMatches < queryTokens.length) {
    return { eligible: false, score: 0, reason: 'query_mismatch' };
  }
  const queryScore = normalizedQuery.length === 0
    ? 0.2
    : queryMatches / queryTokens.length;
  const useScore = Math.min(record.useCount ?? 0, 10) / 100;
  const recencyScore = record.lastUsedAt ? 0.05 : 0;
  const score = clamp01(0.4 + queryScore * 0.45 + useScore + recencyScore);
  return { eligible: true, score, reason: normalizedQuery ? 'scope_match query_match' : 'scope_match' };
}

export interface SelectMemoryRecallResultsInput {
  recallRequestId: string;
  records: MemoryRecord[];
  scopes: MemoryScope[];
  kinds?: MemoryKind[];
  query?: string;
  limit: number;
  budget?: number;
  now: string;
}

export function selectMemoryRecallResults(input: SelectMemoryRecallResultsInput): MemoryRecallResult[] {
  let spent = 0;
  return input.records
    .map((record) => ({ record, score: scoreMemoryRecordForRecall(record, input) }))
    .filter((entry) => entry.score.eligible)
    .sort((left, right) => right.score.score - left.score.score)
    .slice(0, input.limit)
    .map((entry, index) => {
      const contentPreview = normalizeSafeText(entry.record.content, MAX_CONTENT_PREVIEW_LENGTH);
      const tokenEstimate = estimateTokens(contentPreview);
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
          contentPreview,
        },
      };
    });
}

export function normalizeSafeText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength ? normalized.slice(0, maxLength) : normalized;
}

export function estimateTokens(value: string): number {
  return Math.ceil(value.length / 4);
}

function normalizeForSearch(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}_-]+/gu, ' ').trim();
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

