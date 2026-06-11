import { z } from 'zod';
import type { IsoDateTime } from '../primitives/ids';
import { JsonObjectSchema, type JsonObject } from '../primitives/json';
import { IsoDateTimeSchema } from '../runtime/validation';

const IdSchema = z.string().min(1).max(128);
const OptionalJsonObjectSchema = JsonObjectSchema.optional();

export const MEMORY_SCOPES = ['user', 'workspace', 'project', 'session'] as const;
export type MemoryScope = (typeof MEMORY_SCOPES)[number];

export const MEMORY_KINDS = ['preference', 'project_fact', 'workflow', 'constraint', 'decision'] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

export const MEMORY_CANDIDATE_STATUSES = ['proposed', 'accepted', 'rejected', 'archived'] as const;
export type MemoryCandidateStatus = (typeof MEMORY_CANDIDATE_STATUSES)[number];

export const MEMORY_RECORD_STATUSES = ['active', 'archived', 'disabled', 'deleted'] as const;
export type MemoryRecordStatus = (typeof MEMORY_RECORD_STATUSES)[number];

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
export type MemorySourceKind = (typeof MEMORY_SOURCE_KINDS)[number];

export const MEMORY_OWNER_KINDS = ['candidate', 'memory'] as const;
export type MemoryOwnerKind = (typeof MEMORY_OWNER_KINDS)[number];

export const MEMORY_PROPOSED_BY = ['agent', 'host', 'user', 'system'] as const;
export type MemoryProposedBy = (typeof MEMORY_PROPOSED_BY)[number];

export const MEMORY_RISK_LEVELS = ['low', 'medium', 'high', 'blocked'] as const;
export type MemoryRiskLevel = (typeof MEMORY_RISK_LEVELS)[number];

export const MEMORY_REVIEW_MODES = ['manual'] as const;
export type MemoryReviewMode = (typeof MEMORY_REVIEW_MODES)[number];

export const MEMORY_ACCESS_KINDS = ['recalled', 'selected_for_context', 'viewed', 'exported'] as const;
export type MemoryAccessKind = (typeof MEMORY_ACCESS_KINDS)[number];

export const MEMORY_AUDIT_TARGET_KINDS = ['candidate', 'memory', 'settings', 'recall'] as const;
export type MemoryAuditTargetKind = (typeof MEMORY_AUDIT_TARGET_KINDS)[number];

export const MEMORY_AUDIT_ACTORS = ['agent', 'host', 'user', 'system'] as const;
export type MemoryAuditActor = (typeof MEMORY_AUDIT_ACTORS)[number];

export const MEMORY_AUDIT_OPERATIONS = [
  'candidate_proposed',
  'candidate_accepted',
  'candidate_rejected',
  'candidate_archived',
  'memory_created',
  'memory_updated',
  'memory_archived',
  'memory_disabled',
  'memory_enabled',
  'memory_deleted',
  'memory_recalled',
] as const;
export type MemoryAuditOperation = (typeof MEMORY_AUDIT_OPERATIONS)[number];

export const MemoryScopeSchema = z.enum(MEMORY_SCOPES);
export const MemoryKindSchema = z.enum(MEMORY_KINDS);
export const MemoryCandidateStatusSchema = z.enum(MEMORY_CANDIDATE_STATUSES);
export const MemoryRecordStatusSchema = z.enum(MEMORY_RECORD_STATUSES);
export const MemorySourceKindSchema = z.enum(MEMORY_SOURCE_KINDS);
export const MemoryOwnerKindSchema = z.enum(MEMORY_OWNER_KINDS);
export const MemoryProposedBySchema = z.enum(MEMORY_PROPOSED_BY);
export const MemoryRiskLevelSchema = z.enum(MEMORY_RISK_LEVELS);
export const MemoryReviewModeSchema = z.enum(MEMORY_REVIEW_MODES);
export const MemoryAccessKindSchema = z.enum(MEMORY_ACCESS_KINDS);
export const MemoryAuditTargetKindSchema = z.enum(MEMORY_AUDIT_TARGET_KINDS);
export const MemoryAuditActorSchema = z.enum(MEMORY_AUDIT_ACTORS);
export const MemoryAuditOperationSchema = z.enum(MEMORY_AUDIT_OPERATIONS);

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

export const MemoryRecordSchema = z
  .object({
    memoryId: IdSchema,
    workspaceId: IdSchema.optional(),
    projectId: IdSchema.optional(),
    sessionId: IdSchema.optional(),
    scope: MemoryScopeSchema,
    kind: MemoryKindSchema,
    content: z.string().min(1).max(4000),
    summary: z.string().min(1).max(500),
    sourceRefs: MemorySourceRefsSchema,
    confidence: z.number().min(0).max(1),
    status: MemoryRecordStatusSchema,
    createdFromCandidateId: IdSchema.optional(),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
    lastAccessedAt: IsoDateTimeSchema.optional(),
    accessCount: z.number().int().nonnegative().optional(),
    deletedAt: IsoDateTimeSchema.optional(),
    disabledAt: IsoDateTimeSchema.optional(),
    metadata: OptionalJsonObjectSchema,
  })
  .strict();

export type MemoryRecord = z.infer<typeof MemoryRecordSchema>;

export const MemoryRecallRequestSchema = z
  .object({
    recallRequestId: IdSchema,
    sessionId: IdSchema,
    runId: IdSchema.optional(),
    workspaceId: IdSchema.optional(),
    projectId: IdSchema.optional(),
    query: z.string().min(1).optional(),
    scopes: z.array(MemoryScopeSchema).min(1),
    kinds: z.array(MemoryKindSchema).optional(),
    limit: z.number().int().positive().max(50),
    budget: z.number().int().positive().optional(),
    createdAt: IsoDateTimeSchema,
    metadata: OptionalJsonObjectSchema,
  })
  .strict();

export type MemoryRecallRequest = z.infer<typeof MemoryRecallRequestSchema>;

export const MemoryRecallResultSchema = z
  .object({
    recallResultId: IdSchema,
    recallRequestId: IdSchema,
    memoryId: IdSchema,
    scope: MemoryScopeSchema,
    kind: MemoryKindSchema,
    summary: z.string().min(1).max(500),
    contentPreview: z.string().min(1).max(1000),
    relevanceScore: z.number().min(0).max(1),
    confidence: z.number().min(0).max(1),
    sourceRefs: MemorySourceRefsSchema,
    recallReason: z.string().min(1).max(500),
    tokenEstimate: z.number().int().nonnegative(),
    selectedForContext: z.boolean(),
    createdAt: IsoDateTimeSchema,
    metadata: OptionalJsonObjectSchema,
  })
  .strict();

export type MemoryRecallResult = z.infer<typeof MemoryRecallResultSchema>;

export const MemorySettingsSchema = z
  .object({
    workspaceId: IdSchema,
    autoCaptureEnabled: z.boolean(),
    defaultCandidateReviewMode: MemoryReviewModeSchema,
    updatedAt: IsoDateTimeSchema,
    metadata: OptionalJsonObjectSchema,
  })
  .strict();

export type MemorySettings = z.infer<typeof MemorySettingsSchema>;

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

export const MemoryAuditLogSchema = z
  .object({
    auditLogId: IdSchema,
    targetKind: MemoryAuditTargetKindSchema,
    targetId: IdSchema,
    operation: MemoryAuditOperationSchema,
    actor: MemoryAuditActorSchema,
    createdAt: IsoDateTimeSchema,
    summary: z.string().min(1).max(500),
    metadata: OptionalJsonObjectSchema,
  })
  .strict();

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
  summary: string;
  contentPreview: string;
  sourceRefs: MemorySourceRef[];
  metadata?: JsonObject;
}

