/* Defines per-run models, budgets, repetition, concurrency, and comparison settings. */
import { z } from 'zod';
import { EvaluationProfileSchema } from './evaluation-case';

export const EvaluationModelConfigSchema = z.object({
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  api: z.enum([
    'openai-completions', 'openai-responses', 'openai-codex-responses',
    'anthropic-messages', 'google-generative-ai',
  ]),
  apiKeyEnv: z.string().min(1),
  baseUrl: z.string().url().optional(),
  contextWindowTokens: z.number().int().positive().default(128_000),
  maxOutputTokens: z.number().int().positive().default(8_192),
}).strict();
export type EvaluationModelConfig = z.infer<typeof EvaluationModelConfigSchema>;

export const EvaluationRunConfigSchema = z.object({
  profile: EvaluationProfileSchema,
  suiteIds: z.array(z.string().min(1)).min(1),
  candidateModel: EvaluationModelConfigSchema,
  graderModel: EvaluationModelConfigSchema,
  repetitions: z.number().int().min(1).max(20).default(1),
  concurrency: z.number().int().min(1).max(8).default(1),
  budget: z.object({
    maxCases: z.number().int().positive(),
    maxInputTokens: z.number().int().positive().optional(),
    maxOutputTokens: z.number().int().positive().optional(),
    maxEstimatedCostUsd: z.number().positive().optional(),
  }).strict(),
  baseline: z.object({ baselineId: z.string().min(1) }).strict().optional(),
  runRoot: z.string().min(1),
}).strict();
export type EvaluationRunConfig = z.infer<typeof EvaluationRunConfigSchema>;
