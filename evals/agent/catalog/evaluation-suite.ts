/* Defines a validated collection of independently executable Evaluation Cases. */
import { z } from 'zod';
import { EvaluationProfileSchema } from './evaluation-case';

export const EvaluationSuiteSchema = z.object({
  suiteId: z.string().regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/),
  revision: z.number().int().positive(),
  title: z.string().trim().min(1),
  purpose: z.string().trim().min(1),
  profile: EvaluationProfileSchema,
  caseIds: z.array(z.string().min(1)).min(1),
  sharedEnvironment: z.boolean().default(false),
}).strict();
export type EvaluationSuite = z.infer<typeof EvaluationSuiteSchema>;

