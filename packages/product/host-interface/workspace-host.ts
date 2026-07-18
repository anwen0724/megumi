import type {
  Workspace,
  WorkspaceFilesService,
  WorkspaceService,
} from '../../agent/workspace';
import { z } from 'zod';

/*
 * Implements WorkspaceHost over the Agent Workspace module and host ports.
 */

export interface DirectoryPickerResult {
  canceled: boolean;
  filePaths: string[];
}

export interface DirectoryPickerPort {
  chooseDirectory(): Promise<DirectoryPickerResult>;
}

export type FileOpenResult =
  | { status: 'opened' }
  | { status: 'failed'; message: string };

export interface FileOpenPort {
  openPath(absolutePath: string): Promise<FileOpenResult>;
}

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

export function createWorkspaceHost(input: {
  workspaceService: WorkspaceService;
  directoryPicker?: DirectoryPickerPort;
  workspaceFilesService: WorkspaceFilesService;
  fileOpen?: FileOpenPort;
}): WorkspaceHost {
  return {
    async listProjects() {
      const result = await input.workspaceService.listWorkspaces({ refresh_status: true });
      return { projects: result.workspaces.map(toWorkspaceProjectUiDto) };
    },

    async useExistingProject() {
      const picked = await input.directoryPicker?.chooseDirectory();
      if (!picked || picked.canceled || picked.filePaths.length === 0) {
        return { status: 'cancelled', project: null };
      }

      const opened = await input.workspaceService.openWorkspace({
        root_path: picked.filePaths[0],
      });
      if (opened.status === 'failed') {
        return { status: 'failed', failure: toWorkspaceFailure(opened.failure) };
      }
      return { status: 'opened', project: toWorkspaceProjectUiDto(opened.workspace) };
    },

    async openProject(request) {
      const found = await input.workspaceService.activateWorkspace({ workspace_id: request.projectId });
      if (found.status === 'not_found') {
        return { status: 'not_found', projectId: found.workspace_id };
      }
      if (found.status === 'failed') {
        return { status: 'failed', failure: toWorkspaceFailure(found.failure) };
      }
      return { status: 'activated', project: toWorkspaceProjectUiDto(found.workspace) };
    },

    removeProject(request) {
      const result = input.workspaceService.removeWorkspace({ workspace_id: request.projectId });
      if (result.status === 'removed') {
        return { status: 'removed', projectId: result.workspace_id };
      }
      if (result.status === 'not_found') {
        return { status: 'not_found', projectId: result.workspace_id };
      }
      return { status: 'blocked', projectId: result.workspace_id, reason: result.reason };
    },

    async listFiles(request) {
      const result = await input.workspaceFilesService.listDirectory({
        workspace_id: request.projectId,
        directory_path: request.directoryPath,
      });
      if (result.status === 'workspace_not_found') {
        return { status: 'workspace_not_found', projectId: result.workspace_id };
      }
      if (result.status === 'path_rejected') {
        return { status: 'path_rejected', reason: result.reason };
      }
      return {
        status: 'ok',
        projectId: result.workspace_id,
        workspaceRoot: result.workspace_root,
        directoryPath: result.directory_path,
        entries: result.entries.map((entry) => ({
          name: entry.name,
          relativePath: entry.relative_path,
          type: entry.type,
          depth: entry.depth,
          hidden: entry.hidden,
          ...(entry.size_bytes === undefined ? {} : { sizeBytes: entry.size_bytes }),
          mtime: entry.modified_at,
        })),
      };
    },

    async openFile(request) {
      const result = input.workspaceFilesService.resolveFile({
        workspace_id: request.projectId,
        file_path: request.filePath,
      });
      if (result.status === 'workspace_not_found') {
        return { status: 'workspace_not_found', projectId: result.workspace_id };
      }
      if (result.status === 'path_rejected') {
        return { status: 'path_rejected', reason: result.reason };
      }
      if (!input.fileOpen) throw new Error('File open adapter is not configured.');
      const opened = await input.fileOpen.openPath(result.absolute_path);
      if (opened.status === 'failed') {
        return {
          status: 'failed',
          projectId: result.workspace_id,
          filePath: result.file_path,
          failure: { code: 'file_open_failed', message: opened.message },
        };
      }
      return {
        status: 'opened',
        projectId: result.workspace_id,
        workspaceRoot: result.workspace_root,
        filePath: result.file_path,
      };
    },
  };
}

function toWorkspaceFailure(failure: { code: string; message: string }): { code: string; message: string } {
  return {
    code: failure.code,
    message: failure.message,
  };
}

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

/*
 * Maps Workspace module facts into host-facing workspace UI DTOs.
 */


export function toWorkspaceProjectUiDto(workspace: Workspace): WorkspaceProjectUiDto {
  return {
    projectId: workspace.workspace_id,
    name: workspace.name,
    rootPath: workspace.root_path,
    status: workspace.status,
    createdAt: workspace.created_at,
    lastOpenedAt: workspace.last_opened_at,
  };
}
