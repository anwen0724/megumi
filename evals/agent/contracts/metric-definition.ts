/*
 * Defines stable Metric meaning and quantification without any scoring behavior.
 */
import { z } from 'zod';
import { StableEvaluationIdSchema } from './evaluation-dataset';

export const MetricScopeSchema = z.enum([
  'common',
  'conversation',
  'interest_understanding',
  'candidate_supply',
  'recommendation',
  'preference_learning',
]);
export type MetricScope = z.infer<typeof MetricScopeSchema>;

export const MetricDefinitionSchema = z.object({
  metricId: StableEvaluationIdSchema,
  name: z.string().trim().min(1),
  scope: MetricScopeSchema,
  definition: z.string().trim().min(1),
  quantification: z.string().trim().min(1),
}).strict();
export type MetricDefinition = z.infer<typeof MetricDefinitionSchema>;
