/* Defines discovery configuration, including candidate supply and legacy recommendation limits. */
import { z } from 'zod';
import { ModelReferenceSchema } from './providers';

/**
 * Thresholds one candidate pool uses. The minimum triggers background top-up;
 * the target is what a round tries to reach with its remaining budget. Neither
 * is a storage or retrieval cap.
 */
const CandidatePoolThresholdsSchema = z
  .object({
    minimumCount: z.number().int().nonnegative(),
    targetCount: z.number().int().positive(),
    interestMinimumCount: z.number().int().nonnegative(),
    interestTargetCount: z.number().int().positive(),
  })
  .strict()
  .superRefine((pool, context) => {
    if (pool.targetCount <= pool.minimumCount) {
      context.addIssue({
        code: 'custom',
        path: ['targetCount'],
        message: 'Target count must exceed the minimum count.',
      });
    }
    if (pool.interestTargetCount <= pool.interestMinimumCount) {
      context.addIssue({
        code: 'custom',
        path: ['interestTargetCount'],
        message: 'Interest target must exceed the interest minimum.',
      });
    }
  });

/**
 * One round's execution budget. Each counter has a single owner, is reserved
 * before work is queued, and is charged again when work is retried. The
 * defaults are engineering starting points, not product promises: tuning them
 * must not change thresholds, freshness, triggers, or failure semantics.
 */
const CandidateSupplyLimitsSchema = z
  .object({
    maxSearchCalls: z.number().int().positive().default(20),
    /** The Zhihu Open Platform search endpoint accepts at most 10 results. */
    maxResultsPerSearch: z.number().int().positive().max(10).default(10),
    maxFetchCalls: z.number().int().positive().default(10),
    maxPlanningCalls: z.number().int().nonnegative().default(6),
    /** One call screens a whole batch of new discoveries before their analysis. */
    maxScreeningCalls: z.number().int().nonnegative().default(20),
    maxAnalysisCalls: z.number().int().nonnegative().default(60),
    maxMatchingCalls: z.number().int().nonnegative().default(20),
    /** Zero keeps this round from accepting embedding work; vectors are out of scope. */
    maxEmbeddingCalls: z.number().int().nonnegative().default(0),
    maxModelInputTokens: z.number().int().positive().default(200000),
    maxModelOutputTokens: z.number().int().positive().default(60000),
    maxRequestInputTokens: z.number().int().positive().default(12000),
    maxRequestOutputTokens: z.number().int().positive().default(2000),
    maxConcurrentRequests: z.number().int().positive().default(2),
    maxDurationMinutes: z.number().positive().default(20),
    requestTimeoutSeconds: z.number().positive().default(30),
    shutdownWaitSeconds: z.number().positive().default(15),
    maxRetryAttempts: z.number().int().nonnegative().default(3),
    retryIntervalSeconds: z.number().positive().default(60),
    sourceCooldownSeconds: z.number().positive().default(300),
  })
  .strict();

/**
 * Two-pool thresholds plus one round's budget. This schema is the only owner of
 * these defaults; supply code reads one snapshot per round and never invents a
 * fallback value of its own.
 */
export const CandidateSupplyConfigurationSchema = z
  .object({
    daily: CandidatePoolThresholdsSchema.default({
      minimumCount: 100,
      targetCount: 200,
      interestMinimumCount: 10,
      interestTargetCount: 30,
    }),
    longTerm: CandidatePoolThresholdsSchema.default({
      minimumCount: 100,
      targetCount: 300,
      interestMinimumCount: 10,
      interestTargetCount: 40,
    }),
    freshnessDays: z.number().positive().default(7),
    maintenanceIntervalMinutes: z.number().int().positive().default(60),
    /** Empty means no language restriction. */
    contentLanguages: z.array(z.string().trim().min(1)).default([]),
    searchHistoryDays: z.number().int().positive().default(30),
    searchReuseIntervalMinutes: z.number().int().positive().default(360),
    limits: CandidateSupplyLimitsSchema.default({}),
  })
  .strict();
export type CandidateSupplyConfiguration = z.output<typeof CandidateSupplyConfigurationSchema>;
export type CandidateSupplyLimits = CandidateSupplyConfiguration['limits'];
export type CandidatePoolThresholds = CandidateSupplyConfiguration['daily'];

export const DiscoveryConfigurationSchema = z
  .object({
    /** The model that plans searches, analyzes content and matches interests. */
    candidateSupplyModel: ModelReferenceSchema.optional(),
    /** False until the user accepts the first supply run; supply does no external work before that. */
    candidateSupplyConfirmed: z.boolean().default(false),
    /** Sources supply may search. The first version offers the Zhihu Open Platform only. */
    enabledSources: z
      .array(z.string().trim().min(1))
      .refine((values) => new Set(values).size === values.length, 'Source IDs must be unique.')
      .default(['zhihu']),
    candidateSupply: CandidateSupplyConfigurationSchema.default({}),
  })
  .strict()
  .default({});
