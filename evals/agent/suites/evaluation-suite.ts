/* Defines explicit, versioned suite membership and aggregation policy. */
import { z } from 'zod';

export const EvaluationPolicySchema = z.object({
  repetitions: z.number().int().positive(),
  requiredCaseIds: z.array(z.string().min(1)),
  minimumPassRate: z.number().min(0).max(1),
  maximumInvalidExecutionRate: z.number().min(0).max(1),
  needsReview: z.enum(['blocks', 'allowed']),
}).strict();

export const EvaluationSuiteSchema = z.object({
  schemaVersion: z.literal(1),
  suiteId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  caseIds: z.array(z.string().min(1)).min(1),
  executionProfileId: z.string().min(1),
  policy: EvaluationPolicySchema,
}).strict();

export type EvaluationPolicy = z.infer<typeof EvaluationPolicySchema>;
export type EvaluationSuite = z.infer<typeof EvaluationSuiteSchema>;
