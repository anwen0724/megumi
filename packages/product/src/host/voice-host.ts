/* Defines the stable, host-neutral Voice operations exposed by Product. */

import { z } from 'zod';

export const VoiceEmptyPayloadSchema = z.object({}).strict();
export const VoiceProfileImportPayloadSchema = z.object({ name: z.string().trim().min(1) }).strict();
export const VoiceProfileRenamePayloadSchema = z.object({
  profileId: z.string().min(1),
  name: z.string().trim().min(1),
}).strict();
export const VoiceProfileIdPayloadSchema = z.object({ profileId: z.string().min(1) }).strict();
export const VoiceProfilePreviewPayloadSchema = VoiceProfileIdPayloadSchema;
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
  source: z.enum(['built_in', 'custom']),
  language: z.enum(['zh', 'en']).optional(),
  gender: z.enum(['female', 'male']).optional(),
  selected: z.boolean(),
}).strict();

export const VoiceSnapshotSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('idle') }).strict(),
  z.object({
    status: z.enum(['preparing', 'listening', 'recognizing', 'submitting', 'thinking', 'speaking', 'error']),
    boundSessionId: z.string().min(1),
    voiceProfileId: z.string().min(1),
    muted: z.boolean(),
  }).strict(),
]);

export const VoiceModelStatusResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('not_prepared'),
    bundleVersion: z.string().min(1),
    downloadedBytes: z.number().int().nonnegative(),
    totalBytes: z.number().int().nonnegative(),
  }).strict(),
  z.object({
    status: z.literal('preparing'),
    phase: z.enum(['downloading', 'verifying', 'installing']),
    bundleVersion: z.string().min(1),
    downloadedBytes: z.number().int().nonnegative(),
    totalBytes: z.number().int().nonnegative(),
    progress: z.number().min(0).max(1),
    bytesPerSecond: z.number().nonnegative().optional(),
  }).strict(),
  z.object({
    status: z.literal('ready'),
    bundleVersion: z.string().min(1),
    availableBundleVersion: z.string().min(1).optional(),
  }).strict(),
  z.object({
    status: z.literal('failed'),
    bundleVersion: z.string().min(1),
    downloadedBytes: z.number().int().nonnegative(),
    totalBytes: z.number().int().nonnegative(),
    failure: VoiceFailureSchema,
  }).strict(),
]);

export const VoiceModelUpdateResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('checked'), bundleVersion: z.string().min(1) }).strict(),
  z.object({ status: z.literal('unavailable') }).strict(),
]);

export const VoiceProfilesListResultSchema = z.object({
  status: z.literal('ok'),
  profiles: z.array(VoiceProfileDtoSchema),
}).strict();

export const VoiceHostMutationResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok') }).strict(),
  z.object({ status: z.literal('cancelled') }).strict(),
  z.object({ status: z.literal('not_found') }).strict(),
  z.object({ status: z.literal('blocked'), reason: z.string().min(1) }).strict(),
  z.object({ status: z.literal('failed'), failure: VoiceFailureSchema }).strict(),
]);

export const VoiceProfilePreviewResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ok'),
    chunks: z.array(z.object({
      samples: z.instanceof(ArrayBuffer),
      sampleRate: z.number().positive(),
      final: z.boolean(),
    }).strict()).min(1),
  }).strict(),
  z.object({ status: z.literal('not_found') }).strict(),
  z.object({ status: z.literal('failed'), failure: VoiceFailureSchema }).strict(),
]);

export type VoiceProfileImportPayload = z.infer<typeof VoiceProfileImportPayloadSchema>;
export type VoiceProfileRenamePayload = z.infer<typeof VoiceProfileRenamePayloadSchema>;
export type VoiceProfileIdPayload = z.infer<typeof VoiceProfileIdPayloadSchema>;
export type VoiceProfilePreviewPayload = z.infer<typeof VoiceProfilePreviewPayloadSchema>;
export type VoiceProfilePreviewResult = z.infer<typeof VoiceProfilePreviewResultSchema>;
export type VoiceSessionStartPayload = z.infer<typeof VoiceSessionStartPayloadSchema>;
export type VoiceSessionMutedPayload = z.infer<typeof VoiceSessionMutedPayloadSchema>;
export type VoiceHostSnapshot = z.infer<typeof VoiceSnapshotSchema>;
export type VoiceHostModelStatus = z.infer<typeof VoiceModelStatusResultSchema>;
export type VoiceHostModelUpdateResult = z.infer<typeof VoiceModelUpdateResultSchema>;
export type VoiceHostProfile = z.infer<typeof VoiceProfileDtoSchema>;
export type VoiceHostProfilesResult = z.infer<typeof VoiceProfilesListResultSchema>;

export type VoiceHostMutationResult = z.infer<typeof VoiceHostMutationResultSchema>;

export interface VoiceHost {
  getSnapshot(request?: Record<string, never>): Promise<VoiceHostSnapshot>;
  getModelStatus(request?: Record<string, never>): Promise<VoiceHostModelStatus>;
  checkModelUpdates(request?: Record<string, never>): Promise<VoiceHostModelUpdateResult>;
  prepareModels(request?: { readonly repair?: boolean }): Promise<VoiceHostMutationResult>;
  cancelModelPreparation(request?: Record<string, never>): Promise<VoiceHostMutationResult>;
  listProfiles(request?: Record<string, never>): Promise<VoiceHostProfilesResult>;
  importProfile(request: VoiceProfileImportPayload): Promise<VoiceHostMutationResult>;
  renameProfile(request: VoiceProfileRenamePayload): Promise<VoiceHostMutationResult>;
  removeProfile(request: VoiceProfileIdPayload): Promise<VoiceHostMutationResult>;
  selectProfile(request: VoiceProfileIdPayload): Promise<VoiceHostMutationResult>;
  previewProfile(request: VoiceProfilePreviewPayload): Promise<VoiceProfilePreviewResult>;
  startSession(request: VoiceSessionStartPayload): Promise<VoiceHostMutationResult>;
  setMuted(request: VoiceSessionMutedPayload): Promise<VoiceHostMutationResult>;
  interrupt(request?: Record<string, never>): Promise<VoiceHostMutationResult>;
  endSession(request?: Record<string, never>): Promise<VoiceHostMutationResult>;
}
