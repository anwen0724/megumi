/* Defines persisted and resolved settings for personalized daily discovery. */
import { z } from 'zod';

export const DiscoverySourceIdSchema = z.string().trim().min(1);

const LocalTimeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u);
const SourceIdsSchema = z.array(DiscoverySourceIdSchema).transform((sourceIds) => [
  ...new Set(sourceIds),
]);

export const DiscoverySettingsRawSchema = z.object({
  conversation_recognition_enabled: z.boolean().optional(),
  daily_generation_time: LocalTimeSchema.optional(),
  daily_target_count: z.number().int().min(1).max(100).optional(),
  enabled_sources: SourceIdsSchema.optional(),
}).strict();

export const DiscoverySettingsFileRawSchema = DiscoverySettingsRawSchema.passthrough();

export const DiscoverySettingsResolvedSchema = z.object({
  conversation_recognition_enabled: z.boolean(),
  daily_generation_time: LocalTimeSchema,
  daily_target_count: z.number().int().min(1).max(100),
  enabled_sources: SourceIdsSchema,
}).strict();

export type DiscoverySourceId = z.infer<typeof DiscoverySourceIdSchema>;
export type DiscoverySettingsRaw = z.infer<typeof DiscoverySettingsRawSchema>;
export type DiscoverySettingsResolved = z.infer<typeof DiscoverySettingsResolvedSchema>;

export const DEFAULT_DISCOVERY_SETTINGS = DiscoverySettingsResolvedSchema.parse({
  conversation_recognition_enabled: false,
  daily_generation_time: '08:00',
  daily_target_count: 20,
  enabled_sources: ['bilibili', 'open_web'],
});

export function resolveDiscoverySettings(
  raw: DiscoverySettingsRaw | undefined,
): DiscoverySettingsResolved {
  return DiscoverySettingsResolvedSchema.parse({
    ...DEFAULT_DISCOVERY_SETTINGS,
    ...raw,
  });
}
