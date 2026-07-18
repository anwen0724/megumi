/*
 * Implements ArtifactHost over the Agent Artifact module.
 */
import type { ArtifactServicePort } from '../../agent/artifacts';
import type { JsonObject } from '../../agent/artifacts/legacy-contracts/artifact-json';
import { z } from 'zod';

const JsonValueSchema: z.ZodType<unknown> = z.lazy(() => z.union([
  z.string(), z.number(), z.boolean(), z.null(), z.array(JsonValueSchema), z.record(z.string(), JsonValueSchema),
]));
const JsonObjectSchema = z.record(z.string(), JsonValueSchema);
export const ArtifactListByRunPayloadSchema = z.object({ runId: z.string().min(1) }).strict();
export const ArtifactListBySessionPayloadSchema = z.object({ sessionId: z.string().min(1) }).strict();
export const ArtifactGetPayloadSchema = z.object({ artifactId: z.string().min(1) }).strict();
export const ArtifactVersionGetPayloadSchema = z.object({ artifactVersionId: z.string().min(1) }).strict();
export const ArtifactVersionCreatePayloadSchema = z.object({
  artifactId: z.string().min(1),
  contentType: z.enum(['text', 'markdown', 'json', 'code', 'document', 'summary', 'other']),
  contentFormat: z.string().min(1), text: z.string(), textPreview: z.string(), changeSummary: z.string().min(1).optional(),
  createdByRunId: z.string().min(1), createdByStepId: z.string().min(1).optional(),
  metadata: JsonObjectSchema.optional(),
}).strict();
export const ArtifactStatusUpdatePayloadSchema = z.object({
  artifactId: z.string().min(1), status: z.enum(['draft', 'active', 'superseded', 'archived', 'failed', 'deleted']),
}).strict();
export const ArtifactReferencePayloadSchema = z.object({
  artifactId: z.string().min(1), artifactVersionId: z.string().min(1).optional(),
  referencedByKind: z.enum(['run', 'step', 'artifact', 'message']), referencedById: z.string().min(1),
  metadata: JsonObjectSchema.optional(),
}).strict();
const ArtifactRecordSchema = z.object({
  artifactId: z.string().min(1),
  kind: z.enum(['implementation_plan', 'review_findings', 'file_change_summary', 'patch_summary', 'research_result', 'report', 'generated_document', 'code_snippet', 'other']),
  title: z.string(),
  status: z.enum(['draft', 'active', 'superseded', 'archived', 'failed', 'deleted']),
  producingRunId: z.string().min(1), producingStepId: z.string().min(1).optional(),
  currentVersionId: z.string().min(1).optional(), pinnedVersionIds: z.array(z.string().min(1)).optional(),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(), deletedAt: z.string().datetime().optional(),
  metadata: JsonObjectSchema.optional(),
}).strict();
const ArtifactContentRefSchema = z.object({
  storage: z.enum(['inline', 'megumi_home', 'external_ref']), contentKey: z.string().optional(), inlineText: z.string().optional(),
  mimeType: z.string(), sizeBytes: z.number().int().nonnegative(), sha256: z.string(), textPreview: z.string(),
  redactionState: z.enum(['safe', 'redacted', 'contains_refs']), createdAt: z.string().datetime(), metadata: JsonObjectSchema.optional(),
}).strict();
const ArtifactVersionRecordSchema = z.object({
  artifactVersionId: z.string().min(1), artifactId: z.string().min(1), versionNumber: z.number().int().positive(),
  contentType: z.enum(['text', 'markdown', 'json', 'code', 'document', 'summary', 'other']), contentFormat: z.string(),
  contentRef: ArtifactContentRefSchema, textPreview: z.string(), changeSummary: z.string().optional(),
  createdByRunId: z.string().min(1), createdByStepId: z.string().min(1).optional(), createdAt: z.string().datetime(),
  metadata: JsonObjectSchema.optional(),
}).strict();
const ArtifactSourceRefRecordSchema = z.object({
  sourceRefId: z.string().min(1), artifactId: z.string().min(1), artifactVersionId: z.string().min(1).optional(),
  kind: z.enum(['message', 'run', 'step', 'runtime_event', 'tool_call', 'workspace_file', 'diff', 'artifact']),
  refId: z.string().min(1), label: z.string().optional(), metadata: JsonObjectSchema.optional(), createdAt: z.string().datetime(),
}).strict();

export const ArtifactListDataSchema = z.object({ artifacts: z.array(ArtifactRecordSchema) }).strict();
export const ArtifactGetDataSchema = z.object({
  artifact: ArtifactRecordSchema.optional(), currentVersion: ArtifactVersionRecordSchema.optional(),
  sourceRefs: z.array(ArtifactSourceRefRecordSchema),
}).strict();
export const ArtifactVersionGetDataSchema = z.object({ version: ArtifactVersionRecordSchema.optional() }).strict();
export const ArtifactVersionCreateDataSchema = z.object({ version: ArtifactVersionRecordSchema }).strict();
export const ArtifactStatusUpdateDataSchema = z.object({ artifact: ArtifactRecordSchema }).strict();
export const ArtifactReferenceDataSchema = z.object({ sourceRef: ArtifactSourceRefRecordSchema }).strict();

export type ArtifactRecord = z.infer<typeof ArtifactRecordSchema>;
type ArtifactContentRefRecord = z.infer<typeof ArtifactContentRefSchema>;
export type ArtifactVersionRecord = z.infer<typeof ArtifactVersionRecordSchema>;
export type ArtifactSourceRefRecord = z.infer<typeof ArtifactSourceRefRecordSchema>;

export interface ArtifactCreateVersionPayload {
  artifactId: string;
  contentType: ArtifactVersionRecord['contentType'];
  contentFormat: string;
  text: string;
  textPreview: string;
  changeSummary?: string;
  createdByRunId: string;
  createdByStepId?: string;
  metadata?: JsonObject;
}

export interface ArtifactStatusUpdatePayload {
  artifactId: string;
  status: ArtifactRecord['status'];
}

export interface ArtifactReferencePayload {
  artifactId: string;
  artifactVersionId?: string;
  referencedByKind: 'run' | 'step' | 'artifact' | 'message';
  referencedById: string;
  metadata?: JsonObject;
}

export interface ArtifactListData {
  artifacts: ArtifactRecord[];
}

export interface ArtifactGetData {
  artifact: ArtifactRecord | undefined;
  currentVersion: ArtifactVersionRecord | undefined;
  sourceRefs: ArtifactSourceRefRecord[];
}

export interface ArtifactVersionGetData {
  version: ArtifactVersionRecord | undefined;
}

export interface ArtifactVersionCreateData {
  version: ArtifactVersionRecord;
}

export interface ArtifactStatusUpdateData {
  artifact: ArtifactRecord;
}

export interface ArtifactReferenceData {
  sourceRef: ArtifactSourceRefRecord;
}

export interface ArtifactHost {
  listByRun(runId: string): ArtifactListData;
  listBySession(sessionId: string): ArtifactListData;
  get(artifactId: string): ArtifactGetData;
  getVersion(artifactVersionId: string): ArtifactVersionGetData;
  createVersion(payload: ArtifactCreateVersionPayload): Promise<ArtifactVersionCreateData>;
  updateStatus(payload: ArtifactStatusUpdatePayload): ArtifactStatusUpdateData;
  reference(payload: ArtifactReferencePayload): ArtifactReferenceData;
}

export function createArtifactHost(
  artifactService: ArtifactServicePort,
): ArtifactHost {
  return {
    listByRun: (runId) => ({ artifacts: artifactService.listByRun(runId).map(toArtifactRecord) }),
    listBySession: (sessionId) => ({ artifacts: artifactService.listBySession(sessionId).map(toArtifactRecord) }),
    get: (artifactId) => {
      const result = artifactService.get(artifactId);
      return {
        artifact: result.artifact ? toArtifactRecord(result.artifact) : undefined,
        currentVersion: result.currentVersion ? toArtifactVersionRecord(result.currentVersion) : undefined,
        sourceRefs: result.sourceRefs.map(toArtifactSourceRefRecord),
      };
    },
    getVersion: (artifactVersionId) => {
      const version = artifactService.getVersion(artifactVersionId);
      return { version: version ? toArtifactVersionRecord(version) : undefined };
    },
    createVersion: async (payload) => ({ version: toArtifactVersionRecord(await artifactService.createVersion(payload)) }),
    updateStatus: (payload) => ({ artifact: toArtifactRecord(artifactService.updateStatus(payload)) }),
    reference: (payload) => ({ sourceRef: toArtifactSourceRefRecord(artifactService.reference(payload)) }),
  };
}

type ArtifactOwnerRecordInput = ArtifactRecord;
type ArtifactOwnerContentRefInput = ArtifactContentRefRecord;
type ArtifactOwnerVersionInput = ArtifactVersionRecord;
type ArtifactOwnerSourceRefInput = ArtifactSourceRefRecord;

function toArtifactRecord(record: ArtifactOwnerRecordInput): ArtifactRecord {
  return {
    artifactId: record.artifactId,
    kind: record.kind,
    title: record.title,
    status: record.status,
    producingRunId: record.producingRunId,
    ...(record.producingStepId ? { producingStepId: record.producingStepId } : {}),
    ...(record.currentVersionId ? { currentVersionId: record.currentVersionId } : {}),
    ...(record.pinnedVersionIds ? { pinnedVersionIds: [...record.pinnedVersionIds] } : {}),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...(record.deletedAt ? { deletedAt: record.deletedAt } : {}),
    ...(record.metadata ? { metadata: record.metadata } : {}),
  };
}

function toArtifactContentRefRecord(record: ArtifactOwnerContentRefInput): ArtifactContentRefRecord {
  return {
    storage: record.storage,
    ...(record.contentKey ? { contentKey: record.contentKey } : {}),
    ...(record.inlineText ? { inlineText: record.inlineText } : {}),
    mimeType: record.mimeType,
    sizeBytes: record.sizeBytes,
    sha256: record.sha256,
    textPreview: record.textPreview,
    redactionState: record.redactionState,
    createdAt: record.createdAt,
    ...(record.metadata ? { metadata: record.metadata } : {}),
  };
}

function toArtifactVersionRecord(record: ArtifactOwnerVersionInput): ArtifactVersionRecord {
  return {
    artifactVersionId: record.artifactVersionId,
    artifactId: record.artifactId,
    versionNumber: record.versionNumber,
    contentType: record.contentType,
    contentFormat: record.contentFormat,
    contentRef: toArtifactContentRefRecord(record.contentRef),
    textPreview: record.textPreview,
    ...(record.changeSummary ? { changeSummary: record.changeSummary } : {}),
    createdByRunId: record.createdByRunId,
    ...(record.createdByStepId ? { createdByStepId: record.createdByStepId } : {}),
    createdAt: record.createdAt,
    ...(record.metadata ? { metadata: record.metadata } : {}),
  };
}

function toArtifactSourceRefRecord(record: ArtifactOwnerSourceRefInput): ArtifactSourceRefRecord {
  return {
    sourceRefId: record.sourceRefId,
    artifactId: record.artifactId,
    ...(record.artifactVersionId ? { artifactVersionId: record.artifactVersionId } : {}),
    kind: record.kind,
    refId: record.refId,
    ...(record.label ? { label: record.label } : {}),
    ...(record.metadata ? { metadata: record.metadata } : {}),
    createdAt: record.createdAt,
  };
}
