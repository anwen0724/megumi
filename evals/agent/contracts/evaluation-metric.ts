/*
 * Defines the task-authored Metric contract consumed by Evaluation metric evaluators.
 */
import { z } from 'zod';

export const StableEvaluationIdSchema = z.string().regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/);

const MetricBaseShape = {
  metricId: StableEvaluationIdSchema,
  title: z.string().trim().min(1),
  required: z.boolean().default(true),
};

const ParameterlessRuleMetricSchema = z.object({
  ...MetricBaseShape,
  evaluator: z.literal('rule'),
  rule: z.enum([
    'business_completion_present',
    'trace_correlated',
    'no_evidence_conflict',
    'no_scope_escape',
  ]),
}).strict();

const WorkspaceFilesExistMetricSchema = z.object({
  ...MetricBaseShape,
  evaluator: z.literal('rule'),
  rule: z.literal('workspace_files_exist'),
  paths: z.array(z.string().min(1)).min(1),
}).strict();

const WorkspaceFileContainsMetricSchema = z.object({
  ...MetricBaseShape,
  evaluator: z.literal('rule'),
  rule: z.literal('workspace_file_contains'),
  path: z.string().min(1),
  contains: z.array(z.string().min(1)).min(1),
}).strict();

export const RuleMetricSchema = z.union([
  ParameterlessRuleMetricSchema,
  WorkspaceFilesExistMetricSchema,
  WorkspaceFileContainsMetricSchema,
]);

export const ModelMetricSchema = z.object({
  ...MetricBaseShape,
  evaluator: z.literal('model'),
  rubric: z.string().trim().min(1),
  minScore: z.number().int().min(0).max(4).default(3),
}).strict();

export const EvaluationMeasurementNameSchema = z.enum([
  'durationMs',
  'inputTokens',
  'outputTokens',
  'modelCalls',
  'toolCalls',
  'sourceCalls',
  'retries',
  'candidatesProduced',
  'recommendationsPublished',
  'preferenceRevisions',
  'estimatedCostUsd',
]);

export const MeasurementMetricSchema = z.object({
  ...MetricBaseShape,
  evaluator: z.literal('measurement'),
  measurement: EvaluationMeasurementNameSchema,
  operator: z.enum(['min', 'max']),
  threshold: z.number().nonnegative(),
}).strict();

export const EvaluationMetricSchema = z.union([
  RuleMetricSchema,
  ModelMetricSchema,
  MeasurementMetricSchema,
]);

export type EvaluationMetric = z.infer<typeof EvaluationMetricSchema>;
export type RuleMetric = z.infer<typeof RuleMetricSchema>;
export type ModelMetric = z.infer<typeof ModelMetricSchema>;
export type MeasurementMetric = z.infer<typeof MeasurementMetricSchema>;
