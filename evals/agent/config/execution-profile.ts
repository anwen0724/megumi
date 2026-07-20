/* Describes permissions, tools, network access, isolation, and run limits. */
import { z } from 'zod';

export const EvaluationIsolationSchema = z.enum(['workspace_only', 'os_sandbox', 'container', 'vm']);

export const ExecutionProfileSchema = z.object({
  profileId: z.string().min(1),
  name: z.string().min(1),
  environmentKind: z.enum(['controlled', 'live']),
  permissionMode: z.enum(['ask', 'auto', 'full_access']),
  enabledTools: z.array(z.string().min(1)).optional(),
  networkAccess: z.enum(['disabled', 'controlled', 'live']),
  isolation: EvaluationIsolationSchema,
  limits: z.object({
    wallClockMs: z.number().int().positive(),
    maxModelCalls: z.number().int().positive().optional(),
    maxToolCalls: z.number().int().positive().optional(),
  }).strict(),
}).strict();

export type ExecutionProfile = z.infer<typeof ExecutionProfileSchema>;
export type EvaluationIsolation = z.infer<typeof EvaluationIsolationSchema>;
