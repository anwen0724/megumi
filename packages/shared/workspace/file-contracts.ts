import { z } from 'zod';

export const WORKSPACE_DIRECTORY_ENTRY_KINDS = ['file', 'directory'] as const;
export type WorkspaceDirectoryEntryKind = (typeof WORKSPACE_DIRECTORY_ENTRY_KINDS)[number];

export const WorkspaceDirectoryEntrySchema = z
  .object({
    name: z.string().min(1),
    relativePath: z.string(),
    kind: z.enum(WORKSPACE_DIRECTORY_ENTRY_KINDS),
    depth: z.number().int().nonnegative(),
    hidden: z.boolean().optional(),
    ignored: z.boolean().optional(),
    sizeBytes: z.number().int().nonnegative().optional(),
    mtime: z.string().datetime().optional(),
  })
  .strict();

export interface WorkspaceDirectoryEntry {
  name: string;
  relativePath: string;
  kind: WorkspaceDirectoryEntryKind;
  depth: number;
  hidden?: boolean;
  ignored?: boolean;
  sizeBytes?: number;
  mtime?: string;
}

export const WorkspaceFilesListPayloadSchema = z
  .object({
    workspaceRoot: z.string().min(1),
    directoryPath: z.string().default(''),
  })
  .strict();

export interface WorkspaceFilesListPayload {
  workspaceRoot: string;
  directoryPath: string;
}

export const WorkspaceFilesListDataSchema = z
  .object({
    workspaceRoot: z.string().min(1),
    directoryPath: z.string(),
    entries: z.array(WorkspaceDirectoryEntrySchema),
  })
  .strict();

export interface WorkspaceFilesListData {
  workspaceRoot: string;
  directoryPath: string;
  entries: WorkspaceDirectoryEntry[];
}

export const WorkspaceFileOpenPayloadSchema = z
  .object({
    workspaceRoot: z.string().min(1),
    filePath: z.string().min(1),
  })
  .strict();

export interface WorkspaceFileOpenPayload {
  workspaceRoot: string;
  filePath: string;
}

export const WorkspaceFileOpenDataSchema = z
  .object({
    workspaceRoot: z.string().min(1),
    filePath: z.string().min(1),
    opened: z.literal(true),
  })
  .strict();

export interface WorkspaceFileOpenData {
  workspaceRoot: string;
  filePath: string;
  opened: true;
}
