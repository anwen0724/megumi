/* Defines the stable, host-neutral Voice operations exposed by Product. */

import { z } from 'zod';

export const VoiceEmptyPayloadSchema = z.object({}).strict();
export const VoiceProfileImportPayloadSchema = z.object({ name: z.string().trim().min(1) }).strict();
export const VoiceProfileRenamePayloadSchema = z.object({
  profileId: z.string().min(1),
  name: z.string().trim().min(1),
}).strict();
export const VoiceProfileIdPayloadSchema = z.object({ profileId: z.string().min(1) }).strict();
export const VoiceSessionStartPayloadSchema = z.object({ boundSessionId: z.string().min(1) }).strict();
export const VoiceSessionMutedPayloadSchema = z.object({ muted: z.boolean() }).strict();

const VoiceFailureSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  retryable: z.boolean().optional(),
}).strict();

const VoiceProfileDtoSchema = z.object({
  profileId: z.string().min(1),
  name: z.string().min(1),
  builtIn: z.boolean(),
  selected: z.boolean(),
}).strict();

export const VoiceSnapshotSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('idle') }).strict(),
  z.object({
    status: z.enum(['listening', 'recognizing', 'submitting', 'thinking', 'speaking', 'error']),
    boundSessionId: z.string().min(1),
    voiceProfileId: z.string().min(1),
    muted: z.boolean(),
  }).strict(),
]);

export const VoiceModelStatusResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('not_prepared') }).strict(),
  z.object({ status: z.literal('preparing'), progress: z.number().min(0).max(1) }).strict(),
  z.object({ status: z.literal('ready') }).strict(),
  z.object({ status: z.literal('failed'), failure: VoiceFailureSchema }).strict(),
]);

export const VoiceProfilesListResultSchema = z.object({
  status: z.literal('ok'),
  profiles: z.array(VoiceProfileDtoSchema),
}).strict();

export type VoiceProfileImportPayload = z.infer<typeof VoiceProfileImportPayloadSchema>;
export type VoiceProfileRenamePayload = z.infer<typeof VoiceProfileRenamePayloadSchema>;
export type VoiceProfileIdPayload = z.infer<typeof VoiceProfileIdPayloadSchema>;
export type VoiceSessionStartPayload = z.infer<typeof VoiceSessionStartPayloadSchema>;
export type VoiceSessionMutedPayload = z.infer<typeof VoiceSessionMutedPayloadSchema>;
export type VoiceHostSnapshot = z.infer<typeof VoiceSnapshotSchema>;
export type VoiceHostModelStatus = z.infer<typeof VoiceModelStatusResultSchema>;
export type VoiceHostProfile = z.infer<typeof VoiceProfileDtoSchema>;
export type VoiceHostProfilesResult = z.infer<typeof VoiceProfilesListResultSchema>;

export type VoiceHostMutationResult =
  | { readonly status: 'ok' }
  | { readonly status: 'cancelled' }
  | { readonly status: 'not_found' }
  | { readonly status: 'blocked'; readonly reason: string }
  | { readonly status: 'failed'; readonly failure: { readonly code: string; readonly message: string; readonly retryable?: boolean } };

export interface VoiceHost {
  getSnapshot(request?: Record<string, never>): Promise<VoiceHostSnapshot>;
  getModelStatus(request?: Record<string, never>): Promise<VoiceHostModelStatus>;
  prepareModels(request?: { readonly repair?: boolean }): Promise<VoiceHostMutationResult>;
  cancelModelPreparation(request?: Record<string, never>): Promise<VoiceHostMutationResult>;
  listProfiles(request?: Record<string, never>): Promise<VoiceHostProfilesResult>;
  importProfile(request: VoiceProfileImportPayload): Promise<VoiceHostMutationResult>;
  renameProfile(request: VoiceProfileRenamePayload): Promise<VoiceHostMutationResult>;
  removeProfile(request: VoiceProfileIdPayload): Promise<VoiceHostMutationResult>;
  selectProfile(request: VoiceProfileIdPayload): Promise<VoiceHostMutationResult>;
  startSession(request: VoiceSessionStartPayload): Promise<VoiceHostMutationResult>;
  setMuted(request: VoiceSessionMutedPayload): Promise<VoiceHostMutationResult>;
  interrupt(request?: Record<string, never>): Promise<VoiceHostMutationResult>;
  endSession(request?: Record<string, never>): Promise<VoiceHostMutationResult>;
}
