/* Describes only the code and model target under evaluation. */
import { z } from 'zod';

export const EvaluationTargetSchema = z.object({
  targetId: z.string().min(1),
  name: z.string().min(1),
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  expectedProductRevision: z.string().min(1).optional(),
}).strict();

export type EvaluationTarget = z.infer<typeof EvaluationTargetSchema>;
