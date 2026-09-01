/*
 * Separates real product outcomes, quality judgements, and Evaluation infrastructure validity.
 */
import { z } from 'zod';
import { EvaluationMeasurementsSchema, ObservationIssueSchema } from '../execution/observe-task';
import { EvaluationOperationSchema, EvaluationProfileSchema } from './evaluation-task';

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

const ExecutionOutcomeSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('completed') }).strict(),
  z.object({ status: z.literal('failed'), message: z.string().min(1) }).strict(),
  z.object({ status: z.literal('timed_out'), message: z.string().min(1) }).strict(),
  z.object({ status: z.literal('not_started'), reason: z.enum(['budget_blocked', 'infrastructure_error']) }).strict(),
]);

export const TaskEvaluationResultSchema = z.object({
  taskRunId: z.string().min(1),
  taskId: z.string().min(1),
  revision: z.number().int().positive(),
  operation: EvaluationOperationSchema,
  difficulty: z.enum(['simple', 'medium', 'complex']),
  profile: EvaluationProfileSchema,
  executionOutcome: ExecutionOutcomeSchema,
  judgement: z.enum(['passed', 'failed', 'not_gradable', 'not_evaluated']),
  infrastructureStatus: z.enum(['valid', 'invalid']),
  startedAt: z.string().datetime({ offset: true }),
  endedAt: z.string().datetime({ offset: true }),
  observationPath: z.string().min(1).optional(),
  metricResults: z.array(TaskMetricResultSchema),
  measurements: EvaluationMeasurementsSchema,
  observationIssues: z.array(ObservationIssueSchema).default([]),
  infrastructureError: z.object({ code: z.string().min(1), message: z.string() }).strict().optional(),
}).strict();
export type TaskEvaluationResult = z.infer<typeof TaskEvaluationResultSchema>;

export const EvaluationRunResultSchema = z.object({
  runId: z.string().min(1),
  profile: EvaluationProfileSchema,
  infrastructureStatus: z.enum(['valid', 'invalid']),
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
    invalid: z.number().int().nonnegative(),
    budgetBlocked: z.number().int().nonnegative(),
  }).strict(),
}).strict();
export type EvaluationRunResult = z.infer<typeof EvaluationRunResultSchema>;
