/* Defines durable discovery inputs, plans, yield accounting and attempt ownership. */
import { z } from 'zod';
import { InterestSnapshotEntrySchema } from '../interests/interest-contracts';
import { RecommendationLimitsSchema } from '../../settings/definitions/recommendation';

export const AttemptOwnershipSchema = z.union([
  z.object({
    ownerRunId: z.null(),
    attemptToken: z.null(),
    attemptStartedAt: z.null(),
    attemptDeadlineAt: z.null()
  }).strict(),
  z.object({
    ownerRunId: z.string().min(1),
    attemptToken: z.string().min(1),
    attemptStartedAt: z.number().int().nonnegative(),
    attemptDeadlineAt: z.number().int().nonnegative()
  }).strict().refine(
    (attempt) => attempt.attemptDeadlineAt > attempt.attemptStartedAt,
    'Attempt deadline must follow its start.'
  ),
]);
const CounterSchema = z.number().int().nonnegative();

export const DiscoveryPlanSchema = z.array(z.object({
  interestId: z.string().min(1),
  interestRevision: z.number().int().positive(),
  sourceId: z.string().min(1),
  query: z.string().min(1).max(200),
  direction: z.enum(['direct', 'exploratory']),
  basis: z.string().min(1)
}).strict());

export const YieldSummarySchema = z.array(z.object({
  interestId: z.string().min(1),
  interestRevision: z.number().int().positive(),
  queryId: z.string().min(1),
  discovered: CounterSchema,
  analyzed: CounterSchema,
  admitted: CounterSchema,
  reused: CounterSchema,
  rejected: CounterSchema,
  failed: CounterSchema,
  discoveryIds: z.array(z.string().min(1)),
  status: z.enum(['pending', 'completed', 'incomplete']),
  settledAt: z.number().int().nonnegative().nullable(),
}).strict());

export const DiscoveryBudgetSchema = z.object({
  limits: RecommendationLimitsSchema,
  used: z.object({
    searchCalls: CounterSchema,
    fetchCalls: CounterSchema,
    sourceRequests: CounterSchema,
    planningCalls: CounterSchema,
    analysisCalls: CounterSchema,
    matchingCalls: CounterSchema,
    judgmentCalls: CounterSchema,
    selectionCalls: CounterSchema,
    modelInputTokens: CounterSchema,
    modelOutputTokens: CounterSchema
  }).strict(),
}).strict();

export const RecommendationIssueSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  subjectId: z.string().optional()
}).strict();

export const DiscoveryRunRecordSchema = z.object({
  id: z.string().min(1),
  purpose: z.enum(['daily_feed', 'candidate_supply']),
  status: z.enum(['running', 'completed', 'partial', 'failed', 'cancelled', 'interrupted']),
  interestSnapshot: z.array(InterestSnapshotEntrySchema),
  configRevision: z.string().min(1),
  acceptedPlan: DiscoveryPlanSchema.nullable(),
  nextStep: z.string().nullable(),
  yieldSummary: YieldSummarySchema.nullable(),
  startedAt: z.number().int().nonnegative(),
  finishedAt: z.number().int().nonnegative().nullable(),
  budget: DiscoveryBudgetSchema,
  issues: z.array(RecommendationIssueSchema),
}).strict();
export type DiscoveryRunRecord = z.infer<typeof DiscoveryRunRecordSchema>;
