/* Defines persisted and resolved settings for personalized discovery. */
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

const DiscoverySettingsRawShape = {
  conversation_recognition_enabled: z.boolean().optional(),
  recommendation_generation_time: LocalTimeSchema.optional(),
  recommendation_target_count: z.number().int().min(1).max(100).optional(),
  recommendation_working_set_count: z.number().int().min(1).max(200).optional(),
  enabled_sources: SourceIdsSchema.optional(),
  candidate_pool_minimum_count: z.number().int().positive().optional(),
  candidate_pool_maximum_count: z.number().int().positive().optional(),
  candidate_validity_days: z.number().int().positive().optional(),
  candidate_content_excerpt_max_characters: z.number().int().positive().optional(),
  candidate_supply_check_interval_minutes: z.number().int().positive().optional(),
  twitter_budget: TwitterAttemptBudgetRawSchema.optional(),
} as const;

export const DiscoverySettingsRawSchema = z.object(DiscoverySettingsRawShape).strict().superRefine((settings, context) => {
  if (settings.recommendation_target_count !== undefined
    && settings.recommendation_working_set_count !== undefined
    && settings.recommendation_target_count > settings.recommendation_working_set_count) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Recommendation target exceeds working set.' });
  }
  if (settings.recommendation_working_set_count !== undefined
    && settings.candidate_pool_maximum_count !== undefined
    && settings.recommendation_working_set_count > settings.candidate_pool_maximum_count) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'Recommendation working set exceeds Candidate Pool.' });
  }
});

const DiscoveryProviderCredentialFileSchema = z.object({
  credential: z.string().trim().min(1).optional(),
}).passthrough();

export const DiscoverySettingsFileRawSchema = z.object({
  ...DiscoverySettingsRawShape,
  zhihu: DiscoveryProviderCredentialFileSchema.optional(),
  twitter: DiscoveryProviderCredentialFileSchema.optional(),
}).passthrough();

export const DiscoverySettingsResolvedSchema = z.object({
  conversation_recognition_enabled: z.boolean(),
  recommendation_generation_time: LocalTimeSchema,
  recommendation_target_count: z.number().int().min(1).max(100),
  recommendation_working_set_count: z.number().int().min(1).max(200),
  enabled_sources: SourceIdsSchema,
  candidate_pool_minimum_count: z.number().int().positive(),
  candidate_pool_maximum_count: z.number().int().positive(),
  candidate_validity_days: z.number().int().positive(),
  candidate_content_excerpt_max_characters: z.number().int().positive(),
  candidate_supply_check_interval_minutes: z.number().int().positive(),
  twitter_budget: TwitterAttemptBudgetResolvedSchema,
}).strict().refine(
  (settings) => (
    settings.candidate_pool_minimum_count < Math.floor(settings.candidate_pool_maximum_count * 0.8)
      && settings.recommendation_target_count <= settings.recommendation_working_set_count
      && settings.recommendation_working_set_count <= settings.candidate_pool_maximum_count
  ),
  'Discovery count settings are inconsistent.',
);

export type DiscoverySourceId = z.infer<typeof DiscoverySourceIdSchema>;
export type DiscoverySettingsRaw = z.infer<typeof DiscoverySettingsRawSchema>;
export type DiscoverySettingsResolved = z.infer<typeof DiscoverySettingsResolvedSchema>;

export const DEFAULT_DISCOVERY_SETTINGS = DiscoverySettingsResolvedSchema.parse({
  conversation_recognition_enabled: false,
  recommendation_generation_time: '08:00',
  recommendation_target_count: 20,
  recommendation_working_set_count: 80,
  enabled_sources: ['bilibili', 'open_web'],
  candidate_pool_minimum_count: 100,
  candidate_pool_maximum_count: 200,
  candidate_validity_days: 30,
  candidate_content_excerpt_max_characters: 8_000,
  candidate_supply_check_interval_minutes: 360,
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
