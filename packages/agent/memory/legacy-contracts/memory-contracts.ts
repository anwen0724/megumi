// Defines serializable memory contracts shared across package,
// Desktop Main, preload, and renderer boundaries. This file owns shape only;
// persistence mapping and runtime memory decisions live outside this legacy file.
import { z } from 'zod';
export type IsoDateTime = string;
import { JsonObjectSchema, type JsonObject } from './memory-json';
import { IsoDateTimeSchema } from './memory-json';

const IdSchema = z.string().min(1).max(128);
const OptionalJsonObjectSchema = JsonObjectSchema.optional();

export const MEMORY_SCOPES = ['user', 'project'] as const;
export const MemoryScopeSchema = z.enum(MEMORY_SCOPES);
export type MemoryScope = z.infer<typeof MemoryScopeSchema>;

export const MEMORY_KINDS = ['preference', 'constraint', 'fact', 'decision'] as const;
export const MemoryKindSchema = z.enum(MEMORY_KINDS);
export type MemoryKind = z.infer<typeof MemoryKindSchema>;

export const MEMORY_CANDIDATE_STATUSES = ['proposed', 'accepted', 'rejected', 'archived'] as const;
export const MemoryCandidateStatusSchema = z.enum(MEMORY_CANDIDATE_STATUSES);
export type MemoryCandidateStatus = z.infer<typeof MemoryCandidateStatusSchema>;

export const MEMORY_RECORD_STATUSES = ['active', 'superseded', 'deleted'] as const;
export const MemoryRecordStatusSchema = z.enum(MEMORY_RECORD_STATUSES);
export type MemoryRecordStatus = z.infer<typeof MemoryRecordStatusSchema>;

export const MEMORY_RECORD_SOURCES = ['capture', 'markdown_import', 'manual_system'] as const;
export const MemoryRecordSourceSchema = z.enum(MEMORY_RECORD_SOURCES);
export type MemoryRecordSource = z.infer<typeof MemoryRecordSourceSchema>;

export const MEMORY_CAPTURE_SIGNALS = [
  'explicit_remember',
  'explicit_forget_or_correction',
  'future_preference',
  'project_rule',
  'confirmed_decision',
  'stable_project_fact',
  'source_of_truth_doc_changed',
] as const;
export const MemoryCaptureSignalSchema = z.enum(MEMORY_CAPTURE_SIGNALS);
export type MemoryCaptureSignal = z.infer<typeof MemoryCaptureSignalSchema>;

export const MEMORY_EVIDENCE_KINDS = [
  'message',
  'user_message',
  'assistant_message',
  'tool_result',
  'source_file',
  'user_edit',
  'markdown_import',
] as const;
export const MemoryEvidenceKindSchema = z.enum(MEMORY_EVIDENCE_KINDS);
export type MemoryEvidenceKind = z.infer<typeof MemoryEvidenceKindSchema>;

export const MEMORY_SOURCE_KINDS = [
  'message',
  'session',
  'run',
  'step',
  'runtime_event',
  'observation',
  'artifact',
  'tool_call',
  'manual',
  'host_context',
] as const;
export const MemorySourceKindSchema = z.enum(MEMORY_SOURCE_KINDS);
export type MemorySourceKind = z.infer<typeof MemorySourceKindSchema>;

export const MEMORY_OWNER_KINDS = ['candidate', 'memory'] as const;
export const MemoryOwnerKindSchema = z.enum(MEMORY_OWNER_KINDS);
export type MemoryOwnerKind = z.infer<typeof MemoryOwnerKindSchema>;

export const MEMORY_PROPOSED_BY = ['agent', 'host', 'user', 'system'] as const;
export const MemoryProposedBySchema = z.enum(MEMORY_PROPOSED_BY);
export type MemoryProposedBy = z.infer<typeof MemoryProposedBySchema>;

export const MEMORY_RISK_LEVELS = ['low', 'medium', 'high', 'blocked'] as const;
export const MemoryRiskLevelSchema = z.enum(MEMORY_RISK_LEVELS);
export type MemoryRiskLevel = z.infer<typeof MemoryRiskLevelSchema>;

export const MEMORY_REVIEW_MODES = ['manual'] as const;
export const MemoryReviewModeSchema = z.enum(MEMORY_REVIEW_MODES);
export type MemoryReviewMode = z.infer<typeof MemoryReviewModeSchema>;

export const MEMORY_ACCESS_KINDS = ['recalled', 'selected_for_context', 'viewed', 'exported'] as const;
export const MemoryAccessKindSchema = z.enum(MEMORY_ACCESS_KINDS);
export type MemoryAccessKind = z.infer<typeof MemoryAccessKindSchema>;

export const MEMORY_AUDIT_TARGET_KINDS = ['candidate', 'memory', 'settings', 'recall', 'markdown_mirror', 'run'] as const;
export const MemoryAuditTargetKindSchema = z.enum(MEMORY_AUDIT_TARGET_KINDS);
export type MemoryAuditTargetKind = z.infer<typeof MemoryAuditTargetKindSchema>;

export const MEMORY_AUDIT_ACTORS = ['agent', 'host', 'user', 'system'] as const;
export const MemoryAuditActorSchema = z.enum(MEMORY_AUDIT_ACTORS);
export type MemoryAuditActor = z.infer<typeof MemoryAuditActorSchema>;

export const MEMORY_AUDIT_OPERATIONS = [
  'capture_evaluated',
  'extraction_skipped',
  'extraction_failed',
  'candidate_proposed',
  'candidate_accepted',
  'candidate_rejected',
  'candidate_imported',
  'markdown_import_parsed',
  'markdown_import_failed',
  'memory_created',
  'memory_updated',
  'memory_superseded',
  'memory_deleted',
  'recall_requested',
  'recall_selected',
  'recall_failed',
  'conflict_detected',
] as const;
export const MemoryAuditOperationSchema = z.enum(MEMORY_AUDIT_OPERATIONS);
export type MemoryAuditOperation = z.infer<typeof MemoryAuditOperationSchema>;

export const MemorySourceRefSchema = z
  .object({
    sourceRefId: IdSchema,
    ownerId: IdSchema,
    ownerKind: MemoryOwnerKindSchema,
    kind: MemorySourceKindSchema,
    refId: IdSchema,
    label: z.string().min(1).optional(),
    excerptPreview: z.string().max(1000).optional(),
    createdAt: IsoDateTimeSchema,
    metadata: OptionalJsonObjectSchema,
  })
  .strict();

export type MemorySourceRef = z.infer<typeof MemorySourceRefSchema>;

const MemorySourceRefsSchema = z.array(MemorySourceRefSchema);

export const MemoryCandidateSchema = z
  .object({
    candidateId: IdSchema,
    workspaceId: IdSchema.optional(),
    projectId: IdSchema.optional(),
    sessionId: IdSchema.optional(),
    scope: MemoryScopeSchema,
    kind: MemoryKindSchema,
    content: z.string().min(1).max(4000),
    summary: z.string().min(1).max(500),
    sourceRefs: MemorySourceRefsSchema,
    confidence: z.number().min(0).max(1),
    riskLevel: MemoryRiskLevelSchema,
    status: MemoryCandidateStatusSchema,
    proposedBy: MemoryProposedBySchema,
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema.optional(),
    reviewedAt: IsoDateTimeSchema.optional(),
    reviewedBy: z.string().min(1).optional(),
    rejectionReason: z.string().min(1).optional(),
    metadata: OptionalJsonObjectSchema,
  })
  .strict();

export type MemoryCandidate = z.infer<typeof MemoryCandidateSchema>;

export const MemoryEvidenceSchema = z.object({
  kind: MemoryEvidenceKindSchema,
  runId: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
  messageId: z.string().min(1).optional(),
  toolCallId: z.string().min(1).optional(),
  filePath: z.string().min(1).optional(),
  lineStart: z.number().int().positive().optional(),
  lineEnd: z.number().int().positive().optional(),
  metadata: JsonObjectSchema.default({}),
});
export type MemoryEvidence = z.infer<typeof MemoryEvidenceSchema>;

export const MemoryRecordSchema = z
  .object({
    memoryId: z.string().min(1),
    scope: MemoryScopeSchema,
    projectId: z.string().min(1).nullable().optional(),
    kind: MemoryKindSchema,
    status: MemoryRecordStatusSchema,
    content: z.string().min(1),
    summary: z.string().min(1).nullable().optional(),
    normalizedText: z.string().min(1),
    dedupeKey: z.string().min(1),
    source: MemoryRecordSourceSchema,
    sourceRunId: z.string().min(1).nullable().optional(),
    sourceSessionId: z.string().min(1).nullable().optional(),
    sourceMessageId: z.string().min(1).nullable().optional(),
    sourceToolCallId: z.string().min(1).nullable().optional(),
    evidence: z.array(MemoryEvidenceSchema).default([]),
    supersededById: z.string().min(1).nullable().optional(),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
    lastUsedAt: IsoDateTimeSchema.nullable().optional(),
    useCount: z.number().int().min(0).default(0),
    deletedAt: IsoDateTimeSchema.nullable().optional(),
    metadata: JsonObjectSchema.default({}),
    sourceRefs: MemorySourceRefsSchema.optional(),
    confidence: z.number().min(0).max(1).optional(),
    createdFromCandidateId: z.string().min(1).optional(),
  })
  .superRefine((record, ctx) => {
    if (record.scope === 'project' && !record.projectId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['projectId'],
        message: 'project scoped memory requires projectId',
      });
    }
    if (record.scope === 'user' && record.projectId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['projectId'],
        message: 'user scoped memory must not set projectId',
      });
    }
  });
export type MemoryRecord = z.infer<typeof MemoryRecordSchema>;

export const MEMORY_MARKDOWN_MIRROR_STATUSES = ['synced', 'dirty', 'conflict', 'missing'] as const;
export const MemoryMarkdownMirrorStatusSchema = z.enum(MEMORY_MARKDOWN_MIRROR_STATUSES);
export type MemoryMarkdownMirrorStatus = z.infer<typeof MemoryMarkdownMirrorStatusSchema>;

export const MemoryMarkdownMirrorSchema = z
  .object({
    mirrorId: z.string().min(1),
    scope: MemoryScopeSchema,
    projectId: z.string().min(1).nullable().optional(),
    filePath: z.string().min(1),
    status: MemoryMarkdownMirrorStatusSchema,
    lastImportedAt: IsoDateTimeSchema.nullable().optional(),
    lastExportedAt: IsoDateTimeSchema.nullable().optional(),
    contentHash: z.string().min(1).nullable().optional(),
    lastError: z.string().min(1).nullable().optional(),
    metadata: JsonObjectSchema.default({}),
  })
  .superRefine((mirror, ctx) => {
    if (mirror.scope === 'project' && !mirror.projectId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['projectId'],
        message: 'project scoped markdown mirror requires projectId',
      });
    }
    if (mirror.scope === 'user' && mirror.projectId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['projectId'],
        message: 'user scoped markdown mirror must not set projectId',
      });
    }
  });
export type MemoryMarkdownMirror = z.infer<typeof MemoryMarkdownMirrorSchema>;

export const MemoryRecallRequestSchema = z.object({
  recallRequestId: z.string().min(1),
  runId: z.string().min(1),
  sessionId: z.string().min(1),
  projectId: z.string().min(1).nullable().optional(),
  queryText: z.string().min(1),
  requestedScopes: z.array(MemoryScopeSchema).min(1),
  requestedKinds: z.array(MemoryKindSchema).optional(),
  maxResults: z.number().int().positive(),
  createdAt: IsoDateTimeSchema,
  metadata: JsonObjectSchema.default({}),
});
export type MemoryRecallRequest = z.infer<typeof MemoryRecallRequestSchema>;

export const MemoryRecallResultSchema = z.object({
  recallResultId: z.string().min(1),
  recallRequestId: z.string().min(1),
  memoryId: z.string().min(1),
  score: z.number().min(0).max(1),
  rank: z.number().int().positive(),
  selectedForContext: z.boolean(),
  reason: z.string().min(1).nullable().optional(),
  createdAt: IsoDateTimeSchema,
  metadata: JsonObjectSchema.default({}),
});
export type MemoryRecallResult = z.infer<typeof MemoryRecallResultSchema>;

export const MemoryRecallSnapshotItemSchema = z.object({
  memoryId: z.string().min(1),
  scope: MemoryScopeSchema,
  kind: MemoryKindSchema,
  content: z.string().min(1),
  reason: z.string().min(1).nullable().optional(),
  score: z.number().min(0).max(1),
  tokenEstimate: z.number().int().nonnegative().optional(),
});
export type MemoryRecallSnapshotItem = z.infer<typeof MemoryRecallSnapshotItemSchema>;

export const MemoryRecallDiagnosticSeveritySchema = z.enum(['info', 'warning', 'error']);
export type MemoryRecallDiagnosticSeverity = z.infer<typeof MemoryRecallDiagnosticSeveritySchema>;

export const MemoryRecallDiagnosticSchema = z.object({
  code: z.string().min(1),
  severity: MemoryRecallDiagnosticSeveritySchema,
  reason: z.string().min(1),
  memoryId: z.string().min(1).nullable().optional(),
  metadata: JsonObjectSchema.default({}),
});
export type MemoryRecallDiagnostic = z.infer<typeof MemoryRecallDiagnosticSchema>;

export const MemoryRecallSnapshotBudgetSchema = z.object({
  maxTokens: z.number().int().positive(),
  estimatedTokens: z.number().int().nonnegative(),
  truncated: z.boolean(),
});
export type MemoryRecallSnapshotBudget = z.infer<typeof MemoryRecallSnapshotBudgetSchema>;

export const MemoryRecallSnapshotSchema = z.object({
  snapshotId: z.string().min(1),
  recallRequestId: z.string().min(1),
  sessionId: z.string().min(1),
  runId: z.string().min(1),
  projectId: z.string().min(1).nullable().optional(),
  query: z.string(),
  selected: z.array(MemoryRecallSnapshotItemSchema),
  diagnostics: z.array(MemoryRecallDiagnosticSchema).default([]),
  budget: MemoryRecallSnapshotBudgetSchema,
  createdAt: IsoDateTimeSchema,
});
export type MemoryRecallSnapshot = z.infer<typeof MemoryRecallSnapshotSchema>;

export const MemoryPolicySchema = z
  .object({
    allowedScopes: z.array(MemoryScopeSchema).min(1),
    allowedKinds: z.array(MemoryKindSchema).min(1),
    blockedSourceKinds: z.array(MemorySourceKindSchema),
    requiresReviewRiskLevels: z.array(MemoryRiskLevelSchema),
    blockedPatterns: z.array(z.string().min(1)),
    redactionPolicyRef: z.string().min(1).optional(),
    autoCaptureEnabled: z.boolean(),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
    metadata: OptionalJsonObjectSchema,
  })
  .strict();

export type MemoryPolicy = z.infer<typeof MemoryPolicySchema>;

export const MemoryAccessLogSchema = z
  .object({
    accessLogId: IdSchema,
    memoryId: IdSchema,
    sessionId: IdSchema.optional(),
    runId: IdSchema.optional(),
    recallRequestId: IdSchema.optional(),
    accessKind: MemoryAccessKindSchema,
    accessedAt: IsoDateTimeSchema,
    selectedForContext: z.boolean(),
    metadata: OptionalJsonObjectSchema,
  })
  .strict();

export type MemoryAccessLog = z.infer<typeof MemoryAccessLogSchema>;

export const MemoryAuditStateSchema = JsonObjectSchema.refine(
  (state) => !containsForbiddenAuditStateKey(state),
  { message: 'memory audit state must not include raw content fields' },
);

export const MemoryAuditLogSchema = z.object({
  auditId: z.string().min(1),
  operation: MemoryAuditOperationSchema,
  targetKind: MemoryAuditTargetKindSchema,
  targetId: z.string().min(1).nullable().optional(),
  runId: z.string().min(1).nullable().optional(),
  sessionId: z.string().min(1).nullable().optional(),
  projectId: z.string().min(1).nullable().optional(),
  actorKind: MemoryAuditActorSchema,
  reason: z.string().min(1).nullable().optional(),
  beforeState: MemoryAuditStateSchema.nullable().optional(),
  afterState: MemoryAuditStateSchema.nullable().optional(),
  createdAt: IsoDateTimeSchema,
  metadata: JsonObjectSchema.default({}),
});
export type MemoryAuditLog = z.infer<typeof MemoryAuditLogSchema>;

export interface MemoryStatusChange {
  from: MemoryRecordStatus;
  to: MemoryRecordStatus;
  changedAt: IsoDateTime;
}

export interface MemorySafePreview {
  memoryId: string;
  scope: MemoryScope;
  kind: MemoryKind;
  summary?: string | null;
  contentPreview: string;
  sourceRefs?: MemorySourceRef[];
  metadata?: JsonObject;
}

function containsForbiddenAuditStateKey(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some((item) => containsForbiddenAuditStateKey(item));
  }
  return Object.entries(value).some(([key, child]) => {
    const normalizedKey = key.toLowerCase();
    return normalizedKey === 'content'
      || normalizedKey === 'rawcontent'
      || normalizedKey === 'rawprompt'
      || normalizedKey === 'rawtooloutput'
      || normalizedKey === 'transcript'
      || containsForbiddenAuditStateKey(child);
  });
}
