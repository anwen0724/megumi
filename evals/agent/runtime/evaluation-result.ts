/* Defines machine-readable Case and Run results without embedding product state. */
import { z } from 'zod';
import { EvaluationCapabilitySchema, EvaluationProfileSchema } from '../catalog/evaluation-case';
import { EvidenceIssueSchema, EvaluationMeasurementsSchema } from './evidence';
import { GraderResultSchema } from './grading';

export const CaseEvaluationResultSchema = z.object({
  caseRunId: z.string().min(1),
  caseId: z.string().min(1),
  revision: z.number().int().positive(),
  capability: EvaluationCapabilitySchema,
  profile: EvaluationProfileSchema,
  status: z.enum(['passed', 'failed', 'not_gradable', 'evaluation_error', 'budget_blocked']),
  startedAt: z.string().datetime({ offset: true }),
  endedAt: z.string().datetime({ offset: true }),
  evidencePath: z.string().min(1).optional(),
  grades: z.array(GraderResultSchema),
  requiredDimensions: z.array(z.string().min(1)).default([]),
  measurementLimits: z.record(z.string(), z.number().nonnegative()).default({}),
  measurements: EvaluationMeasurementsSchema,
  evidenceIssues: z.array(EvidenceIssueSchema).default([]),
  error: z.object({ code: z.string().min(1), message: z.string() }).strict().optional(),
}).strict();
export type CaseEvaluationResult = z.infer<typeof CaseEvaluationResultSchema>;

export const EvaluationRunResultSchema = z.object({
  runId: z.string().min(1),
  profile: EvaluationProfileSchema,
  startedAt: z.string().datetime({ offset: true }),
  endedAt: z.string().datetime({ offset: true }),
  candidateModel: z.string().min(1),
  graderModelAndRuleVersion: z.string().min(1),
  environment: z.object({
    productVersion: z.string().min(1),
    nodeVersion: z.string().min(1),
    platform: z.string().min(1),
    architecture: z.string().min(1),
    suiteIds: z.array(z.string().min(1)),
    repetitions: z.number().int().positive(),
    concurrency: z.number().int().positive(),
  }).strict(),
  caseResults: z.array(CaseEvaluationResultSchema),
  totals: z.object({
    passed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    notGradable: z.number().int().nonnegative(),
    evaluationErrors: z.number().int().nonnegative(),
    budgetBlocked: z.number().int().nonnegative(),
  }).strict(),
}).strict();
export type EvaluationRunResult = z.infer<typeof EvaluationRunResultSchema>;
