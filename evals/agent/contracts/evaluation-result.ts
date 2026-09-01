/* Defines metric-centric Task and Run results without embedding mutable product state. */
import { z } from 'zod';
import { EvidenceIssueSchema, EvaluationMeasurementsSchema } from '../runtime/evidence-collector';
import { EvaluationProfileSchema, EvaluationRunnerSchema } from './evaluation-task';

export const MetricJudgementSchema = z.enum(['pass', 'fail', 'not_gradable']);

export const TaskMetricResultSchema = z.object({
  metricId: z.string().min(1),
  title: z.string().min(1),
  evaluator: z.enum(['rule', 'model', 'measurement', 'human']),
  required: z.boolean(),
  judgement: MetricJudgementSchema,
  score: z.number().int().min(0).max(4).optional(),
  actual: z.number().nonnegative().optional(),
  threshold: z.number().nonnegative().optional(),
  operator: z.enum(['min', 'max']).optional(),
  rationale: z.string().min(1),
  evidenceRefs: z.array(z.string().min(1)),
  graderModel: z.string().min(1).optional(),
  promptVersion: z.string().min(1).optional(),
  ruleVersion: z.string().min(1).optional(),
  evaluatedAt: z.string().datetime({ offset: true }),
}).strict();
export type TaskMetricResult = z.infer<typeof TaskMetricResultSchema>;

export const TaskEvaluationResultSchema = z.object({
  taskRunId: z.string().min(1),
  taskId: z.string().min(1),
  revision: z.number().int().positive(),
  runner: EvaluationRunnerSchema,
  difficulty: z.enum(['simple', 'medium', 'complex']),
  profile: EvaluationProfileSchema,
  status: z.enum(['passed', 'failed', 'not_gradable', 'evaluation_error', 'budget_blocked']),
  startedAt: z.string().datetime({ offset: true }),
  endedAt: z.string().datetime({ offset: true }),
  evidencePath: z.string().min(1).optional(),
  metricResults: z.array(TaskMetricResultSchema),
  measurements: EvaluationMeasurementsSchema,
  evidenceIssues: z.array(EvidenceIssueSchema).default([]),
  error: z.object({ code: z.string().min(1), message: z.string() }).strict().optional(),
}).strict();
export type TaskEvaluationResult = z.infer<typeof TaskEvaluationResultSchema>;

export const EvaluationRunResultSchema = z.object({
  runId: z.string().min(1),
  profile: EvaluationProfileSchema,
  startedAt: z.string().datetime({ offset: true }),
  endedAt: z.string().datetime({ offset: true }),
  candidateModel: z.string().min(1),
  graderModelAndMetricVersion: z.string().min(1),
  environment: z.object({
    productVersion: z.string().min(1),
    nodeVersion: z.string().min(1),
    platform: z.string().min(1),
    architecture: z.string().min(1),
    suiteIds: z.array(z.string().min(1)),
    repetitions: z.number().int().positive(),
    concurrency: z.number().int().positive(),
  }).strict(),
  taskResults: z.array(TaskEvaluationResultSchema),
  totals: z.object({
    passed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    notGradable: z.number().int().nonnegative(),
    evaluationErrors: z.number().int().nonnegative(),
    budgetBlocked: z.number().int().nonnegative(),
  }).strict(),
}).strict();
export type EvaluationRunResult = z.infer<typeof EvaluationRunResultSchema>;
