/* Defines per-run task selection, models, concurrency, budgets, and Baseline settings. */
import { z } from 'zod';
import { StableEvaluationIdSchema } from './evaluation-metric';
import { EvaluationProfileSchema } from './evaluation-task';

export const EvaluationModelConfigSchema = z.object({
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  api: z.enum([
    'openai-completions',
    'openai-responses',
    'openai-codex-responses',
    'anthropic-messages',
    'google-generative-ai',
  ]),
  apiKeyEnv: z.string().min(1),
  baseUrl: z.string().url().optional(),
  contextWindowTokens: z.number().int().positive().default(128_000),
  maxOutputTokens: z.number().int().positive().default(8_192),
}).strict();
export type EvaluationModelConfig = z.infer<typeof EvaluationModelConfigSchema>;

export const EvaluationRunConfigSchema = z.object({
  profile: EvaluationProfileSchema,
  taskIds: z.array(StableEvaluationIdSchema).default([]),
  suiteIds: z.array(StableEvaluationIdSchema).default([]),
  candidateModel: EvaluationModelConfigSchema,
  graderModel: EvaluationModelConfigSchema,
  repetitions: z.number().int().min(1).max(20).default(1),
  concurrency: z.number().int().min(1).max(8).default(1),
  budget: z.object({
    maxTasks: z.number().int().positive(),
    maxInputTokens: z.number().int().positive().optional(),
    maxOutputTokens: z.number().int().positive().optional(),
    maxEstimatedCostUsd: z.number().positive().optional(),
  }).strict(),
  baseline: z.object({ baselineId: z.string().min(1) }).strict().optional(),
  runRoot: z.string().min(1),
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
