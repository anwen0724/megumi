/* Defines discovery configuration, including candidate and recommendation limits. */
import { z } from 'zod';
import { ModelReferenceSchema } from './providers';

export const DiscoveryConfigurationSchema = z
  .object({
    recommendationModel: ModelReferenceSchema.optional(),
    candidateSupplyModel: ModelReferenceSchema.optional(),

    candidateSupplyConfirmed: z.boolean().default(false),
    conversationRecognitionEnabled: z.boolean().default(false),
    recommendationGenerationTime: z
      .string()
      .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
      .default('08:00'),
    recommendationCandidateCheckIntervalSeconds: z.number().int().positive().default(60),
    recommendationTargetCount: z.number().int().min(1).max(100).default(20),
    recommendationWorkingSetCount: z.number().int().min(1).max(200).default(80),
    enabledSources: z
      .array(z.string().trim().min(1))
      .refine((values) => new Set(values).size === values.length, 'Source IDs must be unique.')
      .default(['bilibili', 'open_web']),
    candidatePoolMinimumCount: z.number().int().positive().default(100),
    candidatePoolMaximumCount: z.number().int().positive().default(200),
    candidateValidityDays: z.number().int().positive().default(30),
    candidateContentExcerptMaxCharacters: z.number().int().positive().default(8000),
    candidateSupplyCheckIntervalMinutes: z.number().int().positive().default(360),
    twitterBudget: z
      .object({
        maxSearchCalls: z.number().int().min(1).max(12).default(3),
        maxResultsPerSearch: z.number().int().min(1).max(20).default(20),
        maxResultsPerAttempt: z.number().int().min(1).max(200).default(40),
      })
      .default({}),
  })
  .superRefine((settings, context) => {
    if (settings.recommendationTargetCount > settings.recommendationWorkingSetCount) {
      context.addIssue({
        code: 'custom',
        path: ['recommendationTargetCount'],
        message: 'Recommendation target exceeds the working set.',
      });
    }
    if (settings.recommendationWorkingSetCount > settings.candidatePoolMaximumCount) {
      context.addIssue({
        code: 'custom',
        path: ['recommendationWorkingSetCount'],
        message: 'Working set exceeds the candidate pool maximum.',
      });
    }
    if (
      settings.candidatePoolMinimumCount >= Math.floor(settings.candidatePoolMaximumCount * 0.8)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['candidatePoolMinimumCount'],
        message: 'Minimum count must be below 80% of maximum count.',
      });
    }
  })
  .default({});
