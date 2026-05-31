import { z } from 'zod';
import type {
  ContextPatchId,
  ContextRedactionRecordId,
  ContextSelectionRecordId,
  ContextSourceId,
  ContextTruncationRecordId,
  IsoDateTime,
  RunContextBuildId,
  RunContextId,
  RunId,
  RunObservationId,
  RunStepId,
  WorkspaceId,
} from './ids';
import { ContextBudgetPolicySchema, type ContextBudgetPolicy } from './context-budget-contracts';
import { JsonObjectSchema, type JsonObject } from './json';
import { IsoDateTimeSchema } from './runtime-validation';

export type {
  ContextPatchId,
  ContextRedactionRecordId,
  ContextSelectionRecordId,
  ContextSourceId,
  ContextTruncationRecordId,
  RunContextBuildId,
  RunContextId,
} from './ids';

const IdSchema = z.string().min(1).max(128);
const OptionalJsonObjectSchema = JsonObjectSchema.optional();

export const WORKSPACE_SYMLINK_POLICIES = ['deny_outside_workspace', 'allow_within_workspace'] as const;
export type WorkspaceSymlinkPolicy = (typeof WORKSPACE_SYMLINK_POLICIES)[number];

export const OUTSIDE_WORKSPACE_POLICIES = ['deny', 'allow_if_user_provided', 'allow_if_approved'] as const;
export type OutsideWorkspacePolicy = (typeof OUTSIDE_WORKSPACE_POLICIES)[number];

export const CONTEXT_SOURCE_KINDS = [
  'workspace_file',
  'workspace_directory',
  'message',
  'tool_observation',
  'artifact',
  'memory_recall',
  'host_context',
  'external_resource',
] as const;
export type ContextSourceKind = (typeof CONTEXT_SOURCE_KINDS)[number];

export const CONTEXT_FRESHNESS_STATES = ['fresh', 'stale', 'unknown'] as const;
export type ContextFreshness = (typeof CONTEXT_FRESHNESS_STATES)[number];

export const CONTEXT_REDACTION_STATES = ['none', 'redacted', 'blocked'] as const;
export type ContextRedactionState = (typeof CONTEXT_REDACTION_STATES)[number];

export const CONTEXT_SELECTION_REASONS = [
  'user_selected',
  'user_pinned',
  'agent_requested',
  'context_policy',
  'recently_modified',
  'search_result',
  'tool_observation',
  'memory_recall',
  'session_summary',
] as const;
export type ContextSelectionReason = (typeof CONTEXT_SELECTION_REASONS)[number];

export const CONTEXT_PATCH_REQUESTERS = ['agent', 'user', 'host', 'context_layer', 'system'] as const;
export type ContextPatchRequester = (typeof CONTEXT_PATCH_REQUESTERS)[number];

export const CONTEXT_PATCH_OPERATIONS = [
  'add',
  'replace',
  'remove_from_effective_context',
  'mark_stale',
  'reprioritize',
  'pin',
  'unpin',
  'redact',
] as const;
export type ContextPatchOperation = (typeof CONTEXT_PATCH_OPERATIONS)[number];

export const CONTEXT_PATCH_STATUSES = ['requested', 'applied', 'rejected', 'superseded'] as const;
export type ContextPatchStatus = (typeof CONTEXT_PATCH_STATUSES)[number];

export const CONTEXT_INLINE_CONTENT_KINDS = ['snippet', 'summary', 'instruction', 'observation'] as const;
export type ContextInlineContentKind = (typeof CONTEXT_INLINE_CONTENT_KINDS)[number];

export const CONTEXT_SNAPSHOT_POLICIES = ['metadata_only', 'redacted_snapshot', 'disabled'] as const;
export type ContextSnapshotPolicy = (typeof CONTEXT_SNAPSHOT_POLICIES)[number];

export const WorkspaceBoundarySchema = z
  .object({
    workspaceId: IdSchema,
    rootPath: z.string().min(1),
    displayName: z.string().min(1).optional(),
    allowedRoots: z.array(z.string().min(1)).optional(),
    deniedGlobs: z.array(z.string().min(1)).optional(),
    protectedPaths: z.array(z.string().min(1)).optional(),
    ignoreSources: z.array(z.string().min(1)).optional(),
    symlinkPolicy: z.enum(WORKSPACE_SYMLINK_POLICIES),
    outsideWorkspacePolicy: z.enum(OUTSIDE_WORKSPACE_POLICIES),
    secretPolicySummary: z.string().min(1),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema.optional(),
  })
  .strict();

export interface WorkspaceBoundary {
  workspaceId: WorkspaceId | string;
  rootPath: string;
  displayName?: string;
  allowedRoots?: string[];
  deniedGlobs?: string[];
  protectedPaths?: string[];
  ignoreSources?: string[];
  symlinkPolicy: WorkspaceSymlinkPolicy;
  outsideWorkspacePolicy: OutsideWorkspacePolicy;
  secretPolicySummary: string;
  createdAt: IsoDateTime;
  updatedAt?: IsoDateTime;
}

export const ContextRangeSchema = z
  .object({
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
  })
  .strict()
  .refine((range) => range.endLine >= range.startLine, {
    message: 'Context range endLine must be greater than or equal to startLine.',
  });

export interface ContextRange {
  startLine: number;
  endLine: number;
}

export const RunContextSourceSchema = z
  .object({
    sourceId: IdSchema,
    sourceKind: z.enum(CONTEXT_SOURCE_KINDS),
    sourceUri: z.string().min(1),
    workspaceId: IdSchema.optional(),
    workspacePath: z.string().min(1).optional(),
    relativePath: z.string().min(1).optional(),
    contentHash: z.string().min(1).optional(),
    mtime: IsoDateTimeSchema.optional(),
    range: ContextRangeSchema.optional(),
    loadedAt: IsoDateTimeSchema,
    freshness: z.enum(CONTEXT_FRESHNESS_STATES),
    redactionState: z.enum(CONTEXT_REDACTION_STATES),
    selectionReason: z.enum(CONTEXT_SELECTION_REASONS),
    metadata: OptionalJsonObjectSchema,
  })
  .strict();

export interface RunContextSource {
  sourceId: ContextSourceId | string;
  sourceKind: ContextSourceKind;
  sourceUri: string;
  workspaceId?: WorkspaceId | string;
  workspacePath?: string;
  relativePath?: string;
  contentHash?: string;
  mtime?: IsoDateTime;
  range?: ContextRange;
  loadedAt: IsoDateTime;
  freshness: ContextFreshness;
  redactionState: ContextRedactionState;
  selectionReason: ContextSelectionReason;
  metadata?: JsonObject;
}

export const ContextInlineContentSchema = z
  .object({
    contentId: IdSchema,
    sourceId: IdSchema.optional(),
    kind: z.enum(CONTEXT_INLINE_CONTENT_KINDS),
    text: z.string(),
    redactionState: z.enum(CONTEXT_REDACTION_STATES),
    tokenEstimate: z.number().int().nonnegative().optional(),
    metadata: OptionalJsonObjectSchema,
  })
  .strict();

export interface ContextInlineContent {
  contentId: string;
  sourceId?: ContextSourceId | string;
  kind: ContextInlineContentKind;
  text: string;
  redactionState: ContextRedactionState;
  tokenEstimate?: number;
  metadata?: JsonObject;
}

export const ContextPolicySummarySchema = z
  .object({
    workspaceAccess: z.string().min(1),
    restrictedResources: z.array(z.string().min(1)),
    approvalSummary: z.string().min(1),
    sandboxSummary: z.string().min(1),
  })
  .strict();

export interface ContextPolicySummary {
  workspaceAccess: string;
  restrictedResources: string[];
  approvalSummary: string;
  sandboxSummary: string;
}

export const ModelCapabilitySummarySchema = z
  .object({
    providerId: z.string().min(1),
    modelId: z.string().min(1),
    modelContextWindow: z.number().int().positive(),
    supportsToolCall: z.boolean().optional(),
    supportsStructuredOutput: z.boolean().optional(),
    supportsVision: z.boolean().optional(),
    supportsLongContext: z.boolean().optional(),
  })
  .strict();

export interface ModelCapabilitySummary {
  providerId: string;
  modelId: string;
  modelContextWindow: number;
  supportsToolCall?: boolean;
  supportsStructuredOutput?: boolean;
  supportsVision?: boolean;
  supportsLongContext?: boolean;
}

export const ContextBuildMetadataSchema = z
  .object({
    buildReason: z.string().min(1),
    builtAt: IsoDateTimeSchema,
    selectionRecordIds: z.array(IdSchema),
    redactionRecordIds: z.array(IdSchema),
    truncationRecordIds: z.array(IdSchema),
    metadata: OptionalJsonObjectSchema,
  })
  .strict();

export interface ContextBuildMetadata {
  buildReason: string;
  builtAt: IsoDateTime;
  selectionRecordIds: Array<ContextSelectionRecordId | string>;
  redactionRecordIds: Array<ContextRedactionRecordId | string>;
  truncationRecordIds: Array<ContextTruncationRecordId | string>;
  metadata?: JsonObject;
}

export const RunContextSchema = z
  .object({
    contextId: IdSchema,
    runId: IdSchema,
    stepId: IdSchema.optional(),
    baselineContextId: IdSchema.optional(),
    workspaceBoundary: WorkspaceBoundarySchema,
    goal: z.string().min(1),
    constraints: z.array(z.string().min(1)),
    inlineContents: z.array(ContextInlineContentSchema),
    resourceRefs: z.array(RunContextSourceSchema),
    conversationRefs: z.array(IdSchema),
    messageSummaries: z.array(z.string()),
    workspaceSources: z.array(RunContextSourceSchema),
    toolObservationRefs: z.array(IdSchema),
    memoryRecallRefs: z.array(IdSchema),
    policySummary: ContextPolicySummarySchema,
    modelCapabilitySummary: ModelCapabilitySummarySchema,
    contextBudgetPolicy: ContextBudgetPolicySchema,
    buildMetadata: ContextBuildMetadataSchema,
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema.optional(),
  })
  .strict();

export interface RunContext {
  contextId: RunContextId | string;
  runId: RunId | string;
  stepId?: RunStepId | string;
  baselineContextId?: RunContextId | string;
  workspaceBoundary: WorkspaceBoundary;
  goal: string;
  constraints: string[];
  inlineContents: ContextInlineContent[];
  resourceRefs: RunContextSource[];
  conversationRefs: string[];
  messageSummaries: string[];
  workspaceSources: RunContextSource[];
  toolObservationRefs: Array<RunObservationId | string>;
  memoryRecallRefs: string[];
  policySummary: ContextPolicySummary;
  modelCapabilitySummary: ModelCapabilitySummary;
  contextBudgetPolicy: ContextBudgetPolicy;
  buildMetadata: ContextBuildMetadata;
  createdAt: IsoDateTime;
  updatedAt?: IsoDateTime;
}

export const ContextPatchSchema = z
  .object({
    patchId: IdSchema,
    runId: IdSchema,
    stepId: IdSchema.optional(),
    requestedBy: z.enum(CONTEXT_PATCH_REQUESTERS),
    operation: z.enum(CONTEXT_PATCH_OPERATIONS),
    targetRef: z.string().min(1).optional(),
    sourceRef: z.string().min(1).optional(),
    reason: z.string().min(1),
    priority: z.number().int().min(0).max(10).optional(),
    createdAt: IsoDateTimeSchema,
    appliedAt: IsoDateTimeSchema.optional(),
    status: z.enum(CONTEXT_PATCH_STATUSES),
    rejectionReason: z.string().min(1).optional(),
    metadata: OptionalJsonObjectSchema,
  })
  .strict();

export interface ContextPatch {
  patchId: ContextPatchId | string;
  runId: RunId | string;
  stepId?: RunStepId | string;
  requestedBy: ContextPatchRequester;
  operation: ContextPatchOperation;
  targetRef?: string;
  sourceRef?: string;
  reason: string;
  priority?: number;
  createdAt: IsoDateTime;
  appliedAt?: IsoDateTime;
  status: ContextPatchStatus;
  rejectionReason?: string;
  metadata?: JsonObject;
}

export const RunContextBuildSchema = z
  .object({
    buildId: IdSchema,
    contextId: IdSchema,
    runId: IdSchema,
    stepId: IdSchema.optional(),
    sourceIds: z.array(IdSchema),
    selectionRecordIds: z.array(IdSchema),
    redactionRecordIds: z.array(IdSchema),
    truncationRecordIds: z.array(IdSchema),
    builtAt: IsoDateTimeSchema,
    snapshotPolicy: z.enum(CONTEXT_SNAPSHOT_POLICIES),
    metadata: OptionalJsonObjectSchema,
  })
  .strict();

export interface RunContextBuild {
  buildId: RunContextBuildId | string;
  contextId: RunContextId | string;
  runId: RunId | string;
  stepId?: RunStepId | string;
  sourceIds: Array<ContextSourceId | string>;
  selectionRecordIds: Array<ContextSelectionRecordId | string>;
  redactionRecordIds: Array<ContextRedactionRecordId | string>;
  truncationRecordIds: Array<ContextTruncationRecordId | string>;
  builtAt: IsoDateTime;
  snapshotPolicy: ContextSnapshotPolicy;
  metadata?: JsonObject;
}

export interface ContextPatchRequestedPayload {
  patchId: ContextPatchId | string;
  operation: ContextPatchOperation;
  requestedBy: ContextPatchRequester;
  reason: string;
}

export interface ContextPatchAppliedPayload {
  patchId: ContextPatchId | string;
  operation: ContextPatchOperation;
  effectiveContextBuildId?: RunContextBuildId | string;
}

export interface ContextPatchRejectedPayload {
  patchId: ContextPatchId | string;
  operation: ContextPatchOperation;
  rejectionReason: string;
}

export interface ContextEffectiveUpdatedPayload {
  contextId: RunContextId | string;
  effectiveContextBuildId: RunContextBuildId | string;
  sourceCount: number;
  redactionCount: number;
  truncationCount: number;
}
