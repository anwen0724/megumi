/* Defines a named collection of independently executable Evaluation Tasks. */
import { z } from 'zod';
import { StableEvaluationIdSchema } from './evaluation-metric';
import { EvaluationProfileSchema } from './evaluation-task';

export const EvaluationSuiteSchema = z.object({
  suiteId: StableEvaluationIdSchema,
  revision: z.number().int().positive(),
  title: z.string().trim().min(1),
  purpose: z.string().trim().min(1),
  profile: EvaluationProfileSchema,
  taskIds: z.array(StableEvaluationIdSchema).min(1),
}).strict();

export type EvaluationSuite = z.infer<typeof EvaluationSuiteSchema>;
