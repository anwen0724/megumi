/* Defines the stable, host-neutral Voice operations exposed by Product. */

import { z } from 'zod';

export const VoiceEmptyPayloadSchema = z.object({}).strict();
export const VoiceSessionStartPayloadSchema = z.object({
  boundSessionId: z.string().min(1),
  language: z.enum(['zh', 'en', 'auto']).optional(),
}).strict();
export const VoiceSessionMutedPayloadSchema = z.object({ muted: z.boolean() }).strict();

const VoiceFailureSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  retryable: z.boolean().optional(),
}).strict();

export const VoiceSnapshotSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('idle') }).strict(),
  z.object({
    status: z.enum(['preparing', 'listening', 'recognizing', 'error']),
    boundSessionId: z.string().min(1),
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

export const VoiceModelCapabilityPayloadSchema = z.object({
  capability: z.enum(['stt']),
}).strict();

export const VoiceModelCapabilityStatusSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ready') }).strict(),
  z.object({
    status: z.literal('not_ready'),
    reason: z.enum(['not_prepared', 'missing_files']),
    message: z.string().min(1),
  }).strict(),
]);

export const VoiceHostMutationResultSchema = z.discriminatedUnion('status', [
  // The Speech Input generation is returned for the host to tag ephemeral frames.
  z.object({ status: z.literal('ok'), generation: z.number().int().nonnegative().optional() }).strict(),
  z.object({ status: z.literal('cancelled') }).strict(),
  z.object({ status: z.literal('not_found') }).strict(),
  z.object({ status: z.literal('blocked'), reason: z.string().min(1) }).strict(),
  z.object({ status: z.literal('failed'), failure: VoiceFailureSchema }).strict(),
]);

export type VoiceSessionStartPayload = z.infer<typeof VoiceSessionStartPayloadSchema>;
export type VoiceSessionMutedPayload = z.infer<typeof VoiceSessionMutedPayloadSchema>;
export type VoiceHostSnapshot = z.infer<typeof VoiceSnapshotSchema>;
export type VoiceHostModelStatus = z.infer<typeof VoiceModelStatusResultSchema>;
export type VoiceHostModelUpdateResult = z.infer<typeof VoiceModelUpdateResultSchema>;
export type VoiceModelCapabilityPayload = z.infer<typeof VoiceModelCapabilityPayloadSchema>;
export type VoiceHostModelCapabilityStatus = z.infer<typeof VoiceModelCapabilityStatusSchema>;

export type VoiceHostMutationResult = z.infer<typeof VoiceHostMutationResultSchema>;

export interface VoiceHost {
  getSnapshot(request?: Record<string, never>): Promise<VoiceHostSnapshot>;
  getModelStatus(request?: Record<string, never>): Promise<VoiceHostModelStatus>;
  getModelCapabilityStatus(request: VoiceModelCapabilityPayload): Promise<VoiceHostModelCapabilityStatus>;
  checkModelUpdates(request?: Record<string, never>): Promise<VoiceHostModelUpdateResult>;
  prepareModels(request?: { readonly repair?: boolean }): Promise<VoiceHostMutationResult>;
  cancelModelPreparation(request?: Record<string, never>): Promise<VoiceHostMutationResult>;
  startSession(request: VoiceSessionStartPayload): Promise<VoiceHostMutationResult>;
  setMuted(request: VoiceSessionMutedPayload): Promise<VoiceHostMutationResult>;
  startManualUtterance(request?: Record<string, never>): Promise<VoiceHostMutationResult>;
  finishManualUtterance(request?: Record<string, never>): Promise<VoiceHostMutationResult>;
  endSession(request?: Record<string, never>): Promise<VoiceHostMutationResult>;
  stopSpeechOutput(request?: Record<string, never>): Promise<VoiceHostMutationResult>;
}
