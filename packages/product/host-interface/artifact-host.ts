/*
 * Implements ArtifactHost over the Coding Agent Artifact module.
 */
import type { ArtifactServicePort } from '../../coding-agent/artifacts';
import type {
  Artifact,
  ArtifactSourceRef,
  ArtifactStatus,
  ArtifactVersion,
} from '../../coding-agent/artifacts/legacy-contracts/artifact-contracts';
import type { JsonObject } from '../../coding-agent/artifacts/legacy-contracts/artifact-json';
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
  createdByRunId: z.string().min(1), createdByStepId: z.string().min(1).optional(), createdAt: z.string().datetime(),
  metadata: JsonObjectSchema.optional(),
}).strict();
export const ArtifactStatusUpdatePayloadSchema = z.object({
  artifactId: z.string().min(1), status: z.enum(['draft', 'active', 'superseded', 'archived', 'failed', 'deleted']),
  updatedAt: z.string().datetime(),
}).strict();
export const ArtifactReferencePayloadSchema = z.object({
  artifactId: z.string().min(1), artifactVersionId: z.string().min(1).optional(),
  referencedByKind: z.enum(['run', 'step', 'artifact', 'message']), referencedById: z.string().min(1),
  createdAt: z.string().datetime(), metadata: JsonObjectSchema.optional(),
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

export type ArtifactRecord = Artifact;
export type ArtifactVersionRecord = ArtifactVersion;
export type ArtifactSourceRefRecord = ArtifactSourceRef;

export interface ArtifactCreateVersionPayload {
  artifactId: string;
  contentType: ArtifactVersion['contentType'];
  contentFormat: string;
  text: string;
  textPreview: string;
  changeSummary?: string;
  createdByRunId: string;
  createdByStepId?: string;
  createdAt: string;
  metadata?: JsonObject;
}

export interface ArtifactStatusUpdatePayload {
  artifactId: string;
  status: ArtifactStatus;
  updatedAt: string;
}

export interface ArtifactReferencePayload {
  artifactId: string;
  artifactVersionId?: string;
  referencedByKind: 'run' | 'step' | 'artifact' | 'message';
  referencedById: string;
  createdAt: string;
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
    listByRun: (runId) => ({ artifacts: artifactService.listByRun(runId) }),
    listBySession: (sessionId) => ({ artifacts: artifactService.listBySession(sessionId) }),
    get: (artifactId) => artifactService.get(artifactId),
    getVersion: (artifactVersionId) => ({ version: artifactService.getVersion(artifactVersionId) }),
    createVersion: async (payload) => ({ version: await artifactService.createVersion(payload) }),
    updateStatus: (payload) => ({ artifact: artifactService.updateStatus(payload) }),
    reference: (payload) => ({ sourceRef: artifactService.reference(payload) }),
  };
}
