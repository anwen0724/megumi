/* Defines the validated cross-process projection of Desktop-owned application updates. */
import { z } from 'zod';

export const ApplicationUpdateReleaseSchema = z.object({
  version: z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/),
  title: z.string().min(1).max(160),
  notesSummary: z.string().max(1_200).optional(),
  releasePageUrl: z.string().url().startsWith('https://github.com/anwen0724/megumi/releases/'),
}).strict();
export type ApplicationUpdateRelease = z.infer<typeof ApplicationUpdateReleaseSchema>;
export const ApplicationUpdateErrorCodeSchema = z.enum([
  'network_unavailable', 'update_service_unavailable', 'release_metadata_invalid',
  'release_assets_incomplete', 'update_download_failed', 'update_not_ready',
  'update_verification_failed', 'restart_prepare_failed', 'installer_launch_failed',
  'preferences_write_failed', 'update_state_write_failed', 'update_cache_missing', 'update_cache_unreadable', 'unknown_update_error',
]);
export type ApplicationUpdateErrorCode = z.infer<typeof ApplicationUpdateErrorCodeSchema>;
const BaseSchema = z.object({
  currentVersion: z.string(), platform: z.string(), arch: z.string(),
  automaticChecksEnabled: z.boolean(), checkedAt: z.string().datetime().optional(),
});
export const ApplicationUpdateProgressSchema = z.object({
  percent: z.number().finite().min(0).max(100),
  transferred: z.number().finite().nonnegative(), total: z.number().finite().nonnegative(),
}).strict();
export type ApplicationUpdateProgress = z.infer<typeof ApplicationUpdateProgressSchema>;
export const ApplicationUpdateSnapshotSchema = z.discriminatedUnion('status', [
  BaseSchema.extend({ status: z.literal('unsupported'),
    supportReason: z.enum(['development', 'platform', 'not_installed']) }).strict(),
  BaseSchema.extend({ status: z.literal('idle') }).strict(),
  BaseSchema.extend({ status: z.literal('checking'), release: ApplicationUpdateReleaseSchema.optional() }).strict(),
  BaseSchema.extend({ status: z.literal('up_to_date') }).strict(),
  BaseSchema.extend({ status: z.literal('available'), release: ApplicationUpdateReleaseSchema, lastKnown: z.boolean().optional() }).strict(),
  BaseSchema.extend({ status: z.literal('verifying'), release: ApplicationUpdateReleaseSchema }).strict(),
  BaseSchema.extend({ status: z.literal('downloading'), release: ApplicationUpdateReleaseSchema,
    progress: ApplicationUpdateProgressSchema.optional() }).strict(),
  BaseSchema.extend({ status: z.literal('ready'), release: ApplicationUpdateReleaseSchema }).strict(),
  BaseSchema.extend({ status: z.literal('preparing_install'), release: ApplicationUpdateReleaseSchema }).strict(),
  BaseSchema.extend({ status: z.literal('error'), release: ApplicationUpdateReleaseSchema.optional(), error: z.object({
    operation: z.enum(['check', 'download', 'install', 'preferences', 'restore']),
    code: ApplicationUpdateErrorCodeSchema, retryable: z.boolean(),
    targetVersion: ApplicationUpdateReleaseSchema.shape.version.optional(),
  }).strict() }).strict(),
]);
export type ApplicationUpdateSnapshot = z.infer<typeof ApplicationUpdateSnapshotSchema>;
export const ApplicationUpdatePreferencesSchema = z.object({ automaticChecksEnabled: z.boolean() }).strict();
export type ApplicationUpdatePreferences = z.infer<typeof ApplicationUpdatePreferencesSchema>;
