import type {
  MemoryCandidate,
  MemoryKind,
  MemoryPolicy,
  MemoryProposedBy,
  MemoryRiskLevel,
  MemoryScope,
  MemorySourceKind,
  MemorySourceRef,
} from '@megumi/shared/memory';

export * from './text-normalization';
export * from './memory-security-policy';
export * from './capture-trigger-classifier';
export * from './extraction';
export * from './candidate-validation';
export * from './memory-resolution';
export * from './markdown-memory-format';
export * from './recall-scoring';

const MAX_SUMMARY_LENGTH = 500;

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

export function normalizeSafeText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength ? normalized.slice(0, maxLength) : normalized;
}
