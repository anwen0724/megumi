/* Defines renderer-safe Workspace Host DTOs, schemas, ports, and pure mappings. */
import { z } from 'zod';

export interface WorkspaceHost {
  listProjects(request?: WorkspaceListProjectsUiRequest): Promise<WorkspaceListProjectsUiResult>;
  useExistingProject(request?: WorkspaceUseExistingProjectUiRequest): Promise<WorkspaceUseExistingProjectUiResult>;
  openProject(request: WorkspaceOpenProjectUiRequest): Promise<WorkspaceOpenProjectUiResult>;
  removeProject(request: WorkspaceRemoveProjectUiRequest): WorkspaceRemoveProjectUiResult;
  listFiles(request: WorkspaceListFilesUiRequest): Promise<WorkspaceListFilesUiResult>;
  openFile(request: WorkspaceOpenFileUiRequest): Promise<WorkspaceOpenFileUiResult>;
}

export const WorkspaceListProjectsPayloadSchema = z.object({}).strict();
export const WorkspaceUseExistingProjectPayloadSchema = z.object({}).strict();
export const ProjectOpenPayloadSchema = z.object({ projectId: z.string().min(1) }).strict();
export const ProjectRemovePayloadSchema = ProjectOpenPayloadSchema;
export const WorkspaceFilesListPayloadSchema = z.object({
  projectId: z.string().min(1), directoryPath: z.string(),
}).strict();
export const WorkspaceFileOpenPayloadSchema = z.object({
  projectId: z.string().min(1), filePath: z.string().min(1),
}).strict();

const WorkspaceProjectUiDtoSchema = z.object({
  projectId: z.string().min(1),
  name: z.string(),
  rootPath: z.string().min(1),
  status: z.enum(['available', 'missing']),
  createdAt: z.string().datetime().optional(),
  lastOpenedAt: z.string().datetime().optional(),
}).strict();

export const WorkspaceListProjectsUiResultSchema = z.object({
  projects: z.array(WorkspaceProjectUiDtoSchema),
}).strict();
export const WorkspaceUseExistingProjectUiResultSchema = z.object({
  status: z.literal('cancelled'),
  project: z.null(),
}).strict().or(z.object({
  status: z.literal('opened'),
  project: WorkspaceProjectUiDtoSchema,
}).strict()).or(z.object({
  status: z.literal('failed'),
  failure: z.object({ code: z.string().min(1), message: z.string() }).strict(),
}).strict());
export const WorkspaceOpenProjectUiResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('activated'), project: WorkspaceProjectUiDtoSchema }).strict(),
  z.object({ status: z.literal('not_found'), projectId: z.string().min(1) }).strict(),
  z.object({
    status: z.literal('failed'),
    failure: z.object({ code: z.string().min(1), message: z.string() }).strict(),
  }).strict(),
]);
export const WorkspaceRemoveProjectUiResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('removed'), projectId: z.string().min(1) }).strict(),
  z.object({ status: z.literal('not_found'), projectId: z.string().min(1) }).strict(),
  z.object({
    status: z.literal('blocked'),
    projectId: z.string().min(1),
    reason: z.literal('workspace_has_business_facts'),
  }).strict(),
  z.object({
    status: z.literal('failed'),
    projectId: z.string().min(1),
    failure: z.object({ code: z.string().min(1), message: z.string() }).strict(),
  }).strict(),
]);
export const WorkspaceListFilesUiResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ok'),
    projectId: z.string().min(1),
    workspaceRoot: z.string().min(1),
    directoryPath: z.string(),
    entries: z.array(z.object({
      name: z.string(),
      relativePath: z.string(),
      type: z.enum(['file', 'directory']),
      depth: z.number().int().nonnegative(),
      hidden: z.boolean(),
      sizeBytes: z.number().int().nonnegative().optional(),
      mtime: z.string().datetime(),
    }).strict()),
  }).strict(),
  z.object({ status: z.literal('workspace_not_found'), projectId: z.string().min(1) }).strict(),
  z.object({ status: z.literal('path_rejected'), reason: z.enum(['absolute_path', 'outside_workspace']) }).strict(),
]);
export const WorkspaceOpenFileUiResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('opened'),
    projectId: z.string().min(1),
    workspaceRoot: z.string().min(1),
    filePath: z.string().min(1),
  }).strict(),
  z.object({
    status: z.literal('failed'),
    projectId: z.string().min(1),
    filePath: z.string().min(1),
    failure: z.object({ code: z.string().min(1), message: z.string() }).strict(),
  }).strict(),
  z.object({ status: z.literal('workspace_not_found'), projectId: z.string().min(1) }).strict(),
  z.object({ status: z.literal('path_rejected'), reason: z.enum(['absolute_path', 'outside_workspace']) }).strict(),
]);

/*
 * Workspace/project UI DTOs exposed by the host interface.
 */
export type WorkspaceProjectUiStatus = 'available' | 'missing';

export interface WorkspaceProjectUiDto {
  projectId: string;
  name: string;
  rootPath: string;
  status: WorkspaceProjectUiStatus;
  createdAt?: string;
  lastOpenedAt?: string;
}

export interface WorkspaceListProjectsUiRequest {}
export interface WorkspaceListProjectsUiResult {
  projects: WorkspaceProjectUiDto[];
}

export interface WorkspaceUseExistingProjectUiRequest {}
export type WorkspaceUseExistingProjectUiResult =
  | { status: 'cancelled'; project: null }
  | { status: 'opened'; project: WorkspaceProjectUiDto }
  | { status: 'failed'; failure: { code: string; message: string } };

export interface WorkspaceOpenProjectUiRequest {
  projectId: string;
}
export type WorkspaceOpenProjectUiResult =
  | { status: 'activated'; project: WorkspaceProjectUiDto }
  | { status: 'not_found'; projectId: string }
  | { status: 'failed'; failure: { code: string; message: string } };

export interface WorkspaceRemoveProjectUiRequest {
  projectId: string;
}
export type WorkspaceRemoveProjectUiResult =
  | { status: 'removed'; projectId: string }
  | { status: 'not_found'; projectId: string }
  | { status: 'blocked'; projectId: string; reason: 'workspace_has_business_facts' }
  | { status: 'failed'; projectId: string; failure: { code: string; message: string } };

export interface WorkspaceFileEntryUiDto {
  name: string;
  relativePath: string;
  type: 'file' | 'directory';
  depth: number;
  hidden: boolean;
  sizeBytes?: number;
  mtime: string;
}

export interface WorkspaceListFilesUiRequest {
  projectId: string;
  directoryPath: string;
}
export type WorkspaceListFilesUiResult =
  | {
      status: 'ok';
      projectId: string;
      workspaceRoot: string;
      directoryPath: string;
      entries: WorkspaceFileEntryUiDto[];
    }
  | { status: 'workspace_not_found'; projectId: string }
  | { status: 'path_rejected'; reason: 'absolute_path' | 'outside_workspace' };

export interface WorkspaceOpenFileUiRequest {
  projectId: string;
  filePath: string;
}
export type WorkspaceOpenFileUiResult =
  | { status: 'opened'; projectId: string; workspaceRoot: string; filePath: string }
  | { status: 'failed'; projectId: string; filePath: string; failure: { code: string; message: string } }
  | { status: 'workspace_not_found'; projectId: string }
  | { status: 'path_rejected'; reason: 'absolute_path' | 'outside_workspace' };
