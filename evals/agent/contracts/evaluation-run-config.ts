/* Defines per-run task selection, models, concurrency, budgets, and Baseline settings. */
import { z } from 'zod';
import { StableEvaluationIdSchema } from './evaluation-metric';
import { EvaluationProfileSchema } from './evaluation-task';

const EvaluationProviderApiSchema = z.enum([
    'openai-completions',
    'openai-responses',
    'openai-codex-responses',
    'anthropic-messages',
    'google-generative-ai',
]);

const CurrentEvaluationModelSourceSchema = z.object({
  source: z.literal('current'),
}).strict();

const ConfiguredEvaluationModelSourceSchema = z.object({
  source: z.literal('configured'),
  providerId: z.string().min(1),
  modelId: z.string().min(1),
}).strict();

const EvaluationCredentialSourceSchema = z.discriminatedUnion('source', [
  z.object({
    source: z.literal('settings'),
    providerId: z.string().min(1),
  }).strict(),
  z.object({
    source: z.literal('environment'),
    environmentVariable: z.string().min(1),
  }).strict(),
]);

const CustomEvaluationModelSourceSchema = z.object({
  source: z.literal('custom'),
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  api: EvaluationProviderApiSchema,
  baseUrl: z.string().url(),
  contextWindowTokens: z.number().int().positive(),
  maxOutputTokens: z.number().int().positive(),
  credential: EvaluationCredentialSourceSchema,
}).strict();

export const EvaluationModelSourceSchema = z.discriminatedUnion('source', [
  CurrentEvaluationModelSourceSchema,
  ConfiguredEvaluationModelSourceSchema,
  CustomEvaluationModelSourceSchema,
]);
export type EvaluationModelSource = z.infer<typeof EvaluationModelSourceSchema>;

export const EvaluationRunConfigSchema = z.object({
  profile: EvaluationProfileSchema,
  taskIds: z.array(StableEvaluationIdSchema).default([]),
  suiteIds: z.array(StableEvaluationIdSchema).default([]),
  candidateModel: EvaluationModelSourceSchema,
  graderModel: EvaluationModelSourceSchema,
  repetitions: z.number().int().min(1).max(20).default(1),
  concurrency: z.number().int().min(1).max(8).default(1),
  safetyWallClockLimitMs: z.number().int().positive().default(900_000),
  budget: z.object({
    maxTasks: z.number().int().positive(),
    maxInputTokens: z.number().int().positive().optional(),
    maxOutputTokens: z.number().int().positive().optional(),
    maxEstimatedCostUsd: z.number().positive().optional(),
  }).strict(),
  baseline: z.object({ baselineId: z.string().min(1) }).strict().optional(),
}).strict().superRefine((config, context) => {
  if (config.taskIds.length === 0 && config.suiteIds.length === 0) {
    context.addIssue({
      code: 'custom',
      path: ['taskIds'],
      message: 'Run Config requires at least one Task or Suite.',
    });
  }
});

export type EvaluationRunConfig = z.infer<typeof EvaluationRunConfigSchema>;
