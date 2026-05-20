import { z } from 'zod';
import { IsoDateTimeSchema } from './runtime-validation';

export const PROJECT_STATUSES = ['available', 'missing'] as const;
export const ProjectStatusSchema = z.enum(PROJECT_STATUSES);
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;

export const ProjectRecordSchema = z
  .object({
    projectId: z.string().min(1),
    name: z.string().min(1),
    repoPath: z.string().min(1),
    repoPathKey: z.string().min(1),
    status: ProjectStatusSchema,
    createdAt: IsoDateTimeSchema,
    lastOpenedAt: IsoDateTimeSchema,
  })
  .strict();

export const ProjectListPayloadSchema = z.object({}).strict();
export const ProjectListDataSchema = z
  .object({
    projects: z.array(ProjectRecordSchema),
  })
  .strict();

export const ProjectUseExistingPayloadSchema = z.object({}).strict();
export const ProjectUseExistingDataSchema = z
  .discriminatedUnion('cancelled', [
    z.object({ cancelled: z.literal(true) }).strict(),
    z.object({ cancelled: z.literal(false), project: ProjectRecordSchema }).strict(),
  ]);

export const ProjectOpenPayloadSchema = z
  .object({
    projectId: z.string().min(1),
  })
  .strict();
export const ProjectOpenDataSchema = z
  .object({
    project: ProjectRecordSchema,
  })
  .strict();

export const ProjectRemovePayloadSchema = z
  .object({
    projectId: z.string().min(1),
  })
  .strict();
export const ProjectRemoveDataSchema = z
  .object({
    projectId: z.string().min(1),
    removed: z.boolean(),
  })
  .strict();

export type ProjectRecord = z.infer<typeof ProjectRecordSchema>;
export type ProjectListPayload = z.infer<typeof ProjectListPayloadSchema>;
export type ProjectListData = z.infer<typeof ProjectListDataSchema>;
export type ProjectUseExistingPayload = z.infer<typeof ProjectUseExistingPayloadSchema>;
export type ProjectUseExistingData = z.infer<typeof ProjectUseExistingDataSchema>;
export type ProjectOpenPayload = z.infer<typeof ProjectOpenPayloadSchema>;
export type ProjectOpenData = z.infer<typeof ProjectOpenDataSchema>;
export type ProjectRemovePayload = z.infer<typeof ProjectRemovePayloadSchema>;
export type ProjectRemoveData = z.infer<typeof ProjectRemoveDataSchema>;
