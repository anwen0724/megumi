/*
 * Defines the validated cross-process contract for Desktop application update state.
 */
import { z } from 'zod';

export const ApplicationUpdateReleaseSchema = z.object({
  version: z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/),
  title: z.string().min(1).max(160),
  notesSummary: z.string().max(1_200).optional(),
  releasePageUrl: z.string().url().startsWith('https://github.com/anwen0724/megumi/releases/'),
}).strict();

export type ApplicationUpdateRelease = z.infer<typeof ApplicationUpdateReleaseSchema>;

export const ApplicationUpdateErrorCodeSchema = z.enum([
  'installer_busy',
  'network_unavailable',
  'update_service_unavailable',
  'update_feed_not_ready',
  'release_metadata_invalid',
  'release_assets_incomplete',
  'update_download_failed',
  'update_not_ready',
  'restart_prepare_failed',
  'unsupported_environment',
  'unknown_update_error',
]);

export type ApplicationUpdateErrorCode = z.infer<typeof ApplicationUpdateErrorCodeSchema>;

const SnapshotBaseSchema = z.object({
  currentVersion: z.string(),
  platform: z.string(),
  arch: z.string(),
  automaticChecksEnabled: z.boolean(),
  automaticDownloadsEnabled: z.boolean(),
});

const ReleaseSnapshotFields = {
  targetVersion: ApplicationUpdateReleaseSchema.shape.version,
  releaseTitle: ApplicationUpdateReleaseSchema.shape.title,
  notesSummary: ApplicationUpdateReleaseSchema.shape.notesSummary,
  releasePageUrl: ApplicationUpdateReleaseSchema.shape.releasePageUrl,
};

export const ApplicationUpdateSnapshotSchema = z.discriminatedUnion('status', [
  SnapshotBaseSchema.extend({
    status: z.literal('unsupported'),
    reason: z.enum(['development', 'platform', 'not_installed']),
  }).strict(),
  SnapshotBaseSchema.extend({
    status: z.literal('idle'),
    lastCheckedAt: z.string().datetime().optional(),
  }).strict(),
  SnapshotBaseSchema.extend({
    status: z.literal('checking'),
    source: z.enum(['automatic', 'manual']),
    lastCheckedAt: z.string().datetime().optional(),
  }).strict(),
  SnapshotBaseSchema.extend({
    status: z.literal('up_to_date'),
    checkedAt: z.string().datetime(),
  }).strict(),
  SnapshotBaseSchema.extend({
    status: z.literal('available'),
    checkedAt: z.string().datetime(),
    ...ReleaseSnapshotFields,
  }).strict(),
  SnapshotBaseSchema.extend({
    status: z.literal('downloading'),
    ...ReleaseSnapshotFields,
  }).strict(),
  SnapshotBaseSchema.extend({
    status: z.literal('ready'),
    ...ReleaseSnapshotFields,
  }).strict(),
  SnapshotBaseSchema.extend({
    status: z.literal('installing'),
    targetVersion: ApplicationUpdateReleaseSchema.shape.version,
  }).strict(),
  SnapshotBaseSchema.extend({
    status: z.literal('error'),
    errorCode: ApplicationUpdateErrorCodeSchema,
    retryable: z.boolean(),
    operation: z.enum(['check', 'download', 'install']),
    lastCheckedAt: z.string().datetime().optional(),
    targetVersion: ApplicationUpdateReleaseSchema.shape.version.optional(),
    releasePageUrl: ApplicationUpdateReleaseSchema.shape.releasePageUrl.optional(),
  }).strict(),
]);

export type ApplicationUpdateSnapshot = z.infer<typeof ApplicationUpdateSnapshotSchema>;

export const ApplicationUpdatePreferencesSchema = z.object({
  automaticChecksEnabled: z.boolean(),
  automaticDownloadsEnabled: z.boolean(),
}).strict();

export type ApplicationUpdatePreferences = z.infer<typeof ApplicationUpdatePreferencesSchema>;
