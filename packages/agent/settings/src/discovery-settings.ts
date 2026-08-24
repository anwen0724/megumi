/* Defines persisted and resolved settings for personalized daily discovery. */
import { z } from 'zod';

export const DiscoverySourceIdSchema = z.string().trim().min(1);

const LocalTimeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u);
const SourceIdsSchema = z.array(DiscoverySourceIdSchema).transform((sourceIds) => [
  ...new Set(sourceIds),
]);

export const TwitterAttemptBudgetRawSchema = z.object({
  max_search_calls: z.number().int().min(1).max(12).optional(),
  max_results_per_search: z.number().int().min(1).max(20).optional(),
  max_results_per_attempt: z.number().int().min(1).max(200).optional(),
}).strict();

export const TwitterAttemptBudgetResolvedSchema = z.object({
  max_search_calls: z.number().int().min(1).max(12),
  max_results_per_search: z.number().int().min(1).max(20),
  max_results_per_attempt: z.number().int().min(1).max(200),
}).strict();

export const DiscoverySettingsRawSchema = z.object({
  conversation_recognition_enabled: z.boolean().optional(),
  daily_generation_time: LocalTimeSchema.optional(),
  daily_target_count: z.number().int().min(1).max(100).optional(),
  enabled_sources: SourceIdsSchema.optional(),
  twitter_budget: TwitterAttemptBudgetRawSchema.optional(),
}).strict();

const DiscoveryProviderCredentialFileSchema = z.object({
  credential: z.string().trim().min(1).optional(),
}).passthrough();

export const DiscoverySettingsFileRawSchema = DiscoverySettingsRawSchema.extend({
  zhihu: DiscoveryProviderCredentialFileSchema.optional(),
  twitter: DiscoveryProviderCredentialFileSchema.optional(),
}).passthrough();

export const DiscoverySettingsResolvedSchema = z.object({
  conversation_recognition_enabled: z.boolean(),
  daily_generation_time: LocalTimeSchema,
  daily_target_count: z.number().int().min(1).max(100),
  enabled_sources: SourceIdsSchema,
  twitter_budget: TwitterAttemptBudgetResolvedSchema,
}).strict();

export type DiscoverySourceId = z.infer<typeof DiscoverySourceIdSchema>;
export type DiscoverySettingsRaw = z.infer<typeof DiscoverySettingsRawSchema>;
export type DiscoverySettingsResolved = z.infer<typeof DiscoverySettingsResolvedSchema>;

export const DEFAULT_DISCOVERY_SETTINGS = DiscoverySettingsResolvedSchema.parse({
  conversation_recognition_enabled: false,
  daily_generation_time: '08:00',
  daily_target_count: 20,
  enabled_sources: ['bilibili', 'open_web'],
  twitter_budget: {
    max_search_calls: 3,
    max_results_per_search: 20,
    max_results_per_attempt: 40,
  },
});

export function resolveDiscoverySettings(
  raw: DiscoverySettingsRaw | undefined,
): DiscoverySettingsResolved {
  return DiscoverySettingsResolvedSchema.parse({
    ...DEFAULT_DISCOVERY_SETTINGS,
    ...raw,
    twitter_budget: {
      ...DEFAULT_DISCOVERY_SETTINGS.twitter_budget,
      ...(raw?.twitter_budget ?? {}),
    },
  });
}

export const DiscoveryProviderSourceIdSchema = z.enum(['zhihu', 'twitter']);
export const DiscoverySourceCredentialRequestSchema = z.object({
  source_id: DiscoveryProviderSourceIdSchema,
}).strict();
export const WriteDiscoverySourceCredentialRequestSchema = DiscoverySourceCredentialRequestSchema.extend({
  credential: z.string().trim().min(1),
}).strict();

export type DiscoveryProviderSourceId = z.infer<typeof DiscoveryProviderSourceIdSchema>;
export type DiscoverySourceCredentialRequest = z.infer<typeof DiscoverySourceCredentialRequestSchema>;
export type WriteDiscoverySourceCredentialRequest = z.infer<typeof WriteDiscoverySourceCredentialRequestSchema>;
