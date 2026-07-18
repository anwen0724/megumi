/*
 * Legacy permission mode contracts kept inside the artifacts module until artifacts is refactored.
 * No other module may import this file.
 */
import { z } from 'zod';
import { IsoDateTimeSchema } from './artifact-json';

export const ACTIVE_PERMISSION_MODES = ['default', 'accept_edits', 'plan', 'auto'] as const;
export type PermissionMode = (typeof ACTIVE_PERMISSION_MODES)[number];

export const PERMISSION_MODE_SELECTION_SOURCES = [
  'user',
  'project',
  'local',
  'system',
  'intent_default',
] as const;
export type PermissionModeSelectionSource = (typeof PERMISSION_MODE_SELECTION_SOURCES)[number];

export interface PermissionModeSnapshot {
  permissionMode: PermissionMode;
  source: PermissionModeSelectionSource;
  createdAt: string;
}

export const PermissionModeSchema = z.enum(ACTIVE_PERMISSION_MODES);
export const PermissionModeSelectionSourceSchema = z.enum(PERMISSION_MODE_SELECTION_SOURCES);

export const PermissionModeSnapshotSchema = z
  .object({
    permissionMode: PermissionModeSchema,
    source: PermissionModeSelectionSourceSchema,
    createdAt: IsoDateTimeSchema,
  })
  .strict() satisfies z.ZodType<PermissionModeSnapshot>;

export function isPermissionMode(value: string): value is PermissionMode {
  return (ACTIVE_PERMISSION_MODES as readonly string[]).includes(value);
}

