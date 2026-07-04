/*
 * Owns settings IPC payload/result schemas because settings contracts belong
 * to the Coding Agent settings module, not packages/shared.
 */
import { z } from 'zod';
import {
  createRuntimeIpcRequestSchema,
  createRuntimeIpcResultSchema,
  IPC_CHANNELS,
} from '@megumi/shared/ipc';
import {
  AppSettingsRawSchema,
  AppSettingsResolvedSchema,
} from './app-settings-contracts';

export const SettingsGetPayloadSchema = z.object({}).strict();
export const SettingsUpdatePayloadSchema = AppSettingsRawSchema;
export const SettingsDataSchema = z.object({
  settings: AppSettingsResolvedSchema,
}).strict();

export const SettingsGetRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.settings.get,
  SettingsGetPayloadSchema,
);

export const SettingsUpdateRequestSchema = createRuntimeIpcRequestSchema(
  IPC_CHANNELS.settings.update,
  SettingsUpdatePayloadSchema,
);

export const SettingsGetResultSchema = createRuntimeIpcResultSchema(
  SettingsDataSchema,
  IPC_CHANNELS.settings.get,
);

export const SettingsUpdateResultSchema = createRuntimeIpcResultSchema(
  SettingsDataSchema,
  IPC_CHANNELS.settings.update,
);

export type SettingsGetPayload = z.infer<typeof SettingsGetPayloadSchema>;
export type SettingsUpdatePayload = z.infer<typeof SettingsUpdatePayloadSchema>;
export type SettingsData = z.infer<typeof SettingsDataSchema>;
