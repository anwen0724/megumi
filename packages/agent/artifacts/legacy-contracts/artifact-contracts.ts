/*
 * Legacy artifact contracts kept inside the artifacts module until artifacts is refactored.
 * No other module may import this file.
 */
import { z } from 'zod';
import type { JsonObject } from './artifact-json';
type IsoDateTime = string;
type RunId = string;
import { JsonObjectSchema } from './artifact-json';
import { IsoDateTimeSchema } from './artifact-json';

const IdSchema = z.string().min(1).max(128);
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/i, 'sha256 must be a 64 character hex string.');
const ContentKeySchema = z
  .string()
  .min(1)
  .max(512)
  .refine((value) => !/^[A-Za-z]:[\\/]/.test(value), 'contentKey must not be a Windows absolute path.')
  .refine((value) => !value.startsWith('/') && !value.startsWith('\\'), 'contentKey must not be an absolute path.')
  .refine((value) => !value.includes('..'), 'contentKey must not contain parent directory traversal.');
const OptionalJsonObjectSchema = JsonObjectSchema.optional();

export const ARTIFACT_KINDS = [
  'implementation_plan',
  'review_findings',
  'file_change_summary',
  'patch_summary',
  'research_result',
  'report',
  'generated_document',
  'code_snippet',
  'other',
] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

export const ARTIFACT_STATUSES = [
  'draft',
  'active',
  'superseded',
  'archived',
  'failed',
  'deleted',
] as const;
export type ArtifactStatus = (typeof ARTIFACT_STATUSES)[number];

export const ARTIFACT_CONTENT_STORAGES = ['inline', 'megumi_home', 'external_ref'] as const;
export type ArtifactContentStorage = (typeof ARTIFACT_CONTENT_STORAGES)[number];

export const ARTIFACT_CONTENT_TYPES = [
  'text',
  'markdown',
  'json',
  'code',
  'document',
  'summary',
  'other',
] as const;
export type ArtifactContentType = (typeof ARTIFACT_CONTENT_TYPES)[number];

export const ARTIFACT_REDACTION_STATES = ['safe', 'redacted', 'contains_refs'] as const;
export type ArtifactRedactionState = (typeof ARTIFACT_REDACTION_STATES)[number];

export const ARTIFACT_SOURCE_KINDS = [
  'message',
  'run',
  'step',
  'runtime_event',
  'tool_call',
  'workspace_file',
  'diff',
  'artifact',
] as const;
export type ArtifactSourceKind = (typeof ARTIFACT_SOURCE_KINDS)[number];

export const ARTIFACT_RELATION_KINDS = [
  'derived_from',
  'supersedes',
  'superseded_by',
  'references',
  'created_from',
] as const;
export type ArtifactRelationKind = (typeof ARTIFACT_RELATION_KINDS)[number];

export interface ArtifactContentRef {
  storage: ArtifactContentStorage;
  contentKey?: string;
  inlineText?: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  textPreview: string;
  redactionState: ArtifactRedactionState;
  createdAt: IsoDateTime;
  metadata?: JsonObject;
}

export interface Artifact {
  artifactId: string;
  kind: ArtifactKind;
  title: string;
  status: ArtifactStatus;
  producingRunId: RunId | string;
  producingStepId?: string;
  currentVersionId?: string;
  pinnedVersionIds?: string[];
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  deletedAt?: IsoDateTime;
  metadata?: JsonObject;
}

export interface ArtifactVersion {
  artifactVersionId: string;
  artifactId: string;
  versionNumber: number;
  contentType: ArtifactContentType;
  contentFormat: string;
  contentRef: ArtifactContentRef;
  textPreview: string;
  changeSummary?: string;
  createdByRunId: RunId | string;
  createdByStepId?: string;
  createdAt: IsoDateTime;
  metadata?: JsonObject;
}

export interface ArtifactSourceRef {
  sourceRefId: string;
  artifactId: string;
  artifactVersionId?: string;
  kind: ArtifactSourceKind;
  refId: string;
  label?: string;
  metadata?: JsonObject;
  createdAt: IsoDateTime;
}

export interface ArtifactRelation {
  relationId: string;
  fromArtifactId: string;
  fromVersionId?: string;
  toArtifactId: string;
  toVersionId?: string;
  kind: ArtifactRelationKind;
  createdByRunId?: RunId | string;
  createdAt: IsoDateTime;
  metadata?: JsonObject;
}

export const ArtifactKindSchema = z.enum(ARTIFACT_KINDS);
export const ArtifactStatusSchema = z.enum(ARTIFACT_STATUSES);
export const ArtifactContentStorageSchema = z.enum(ARTIFACT_CONTENT_STORAGES);
export const ArtifactContentTypeSchema = z.enum(ARTIFACT_CONTENT_TYPES);
export const ArtifactRedactionStateSchema = z.enum(ARTIFACT_REDACTION_STATES);
export const ArtifactSourceKindSchema = z.enum(ARTIFACT_SOURCE_KINDS);
export const ArtifactRelationKindSchema = z.enum(ARTIFACT_RELATION_KINDS);

export const ArtifactContentRefSchema = z
  .object({
    storage: ArtifactContentStorageSchema,
    contentKey: ContentKeySchema.optional(),
    inlineText: z.string().optional(),
    mimeType: z.string().min(1),
    sizeBytes: z.number().int().nonnegative(),
    sha256: Sha256Schema,
    textPreview: z.string(),
    redactionState: ArtifactRedactionStateSchema,
    createdAt: IsoDateTimeSchema,
    metadata: OptionalJsonObjectSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.storage === 'inline' && value.inlineText === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'inline artifact content refs must include inlineText.',
        path: ['inlineText'],
      });
    }
    if (value.storage !== 'inline' && value.contentKey === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'non-inline artifact content refs must include contentKey.',
        path: ['contentKey'],
      });
    }
  }) satisfies z.ZodType<ArtifactContentRef>;

export const ArtifactSchema = z
  .object({
    artifactId: IdSchema,
    kind: ArtifactKindSchema,
    title: z.string().min(1).max(240),
    status: ArtifactStatusSchema,
    producingRunId: IdSchema,
    producingStepId: IdSchema.optional(),
    currentVersionId: IdSchema.optional(),
    pinnedVersionIds: z.array(IdSchema).optional(),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
    deletedAt: IsoDateTimeSchema.optional(),
    metadata: OptionalJsonObjectSchema,
  })
  .strict() satisfies z.ZodType<Artifact>;

export const ArtifactVersionSchema = z
  .object({
    artifactVersionId: IdSchema,
    artifactId: IdSchema,
    versionNumber: z.number().int().positive(),
    contentType: ArtifactContentTypeSchema,
    contentFormat: z.string().min(1),
    contentRef: ArtifactContentRefSchema,
    textPreview: z.string(),
    changeSummary: z.string().min(1).optional(),
    createdByRunId: IdSchema,
    createdByStepId: IdSchema.optional(),
    createdAt: IsoDateTimeSchema,
    metadata: OptionalJsonObjectSchema,
  })
  .strict() satisfies z.ZodType<ArtifactVersion>;

export const ArtifactSourceRefSchema = z
  .object({
    sourceRefId: IdSchema,
    artifactId: IdSchema,
    artifactVersionId: IdSchema.optional(),
    kind: ArtifactSourceKindSchema,
    refId: IdSchema,
    label: z.string().min(1).max(240).optional(),
    metadata: OptionalJsonObjectSchema,
    createdAt: IsoDateTimeSchema,
  })
  .strict() satisfies z.ZodType<ArtifactSourceRef>;

export const ArtifactRelationSchema = z
  .object({
    relationId: IdSchema,
    fromArtifactId: IdSchema,
    fromVersionId: IdSchema.optional(),
    toArtifactId: IdSchema,
    toVersionId: IdSchema.optional(),
    kind: ArtifactRelationKindSchema,
    createdByRunId: IdSchema.optional(),
    createdAt: IsoDateTimeSchema,
    metadata: OptionalJsonObjectSchema,
  })
  .strict() satisfies z.ZodType<ArtifactRelation>;

