/*
 * Defines the validated, capability-specific Case contract used by Agent Evaluation.
 */
import { z } from 'zod';

export const EvaluationCapabilitySchema = z.enum([
  'conversation',
  'interest_understanding',
  'candidate_supply',
  'daily_recommendation',
  'preference_learning',
]);
export type EvaluationCapability = z.infer<typeof EvaluationCapabilitySchema>;

export const EvaluationProfileSchema = z.enum(['controlled', 'live']);
export type EvaluationProfile = z.infer<typeof EvaluationProfileSchema>;

export function evaluationCapabilityDirectory(capability: EvaluationCapability): string {
  return capability.replaceAll('_', '-');
}

const StableIdSchema = z.string().regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/);
const EvidenceRequirementSchema = z.enum([
  'input',
  'before_facts',
  'completion',
  'after_facts',
  'trace',
  'runtime_events',
  'measurements',
]);
const GradingSchema = z.object({
  hardGates: z.array(StableIdSchema),
  dimensions: z.array(StableIdSchema),
  requiredDimensions: z.array(StableIdSchema).default([]),
  modelGradedDimensions: z.array(StableIdSchema).default([]),
  measurementLimits: z.record(z.string(), z.number().nonnegative()).default({}),
}).strict();
const CommonCaseShape = {
  caseId: StableIdSchema,
  revision: z.number().int().positive(),
  fixtureVersion: z.number().int().positive(),
  title: z.string().trim().min(1),
  objective: z.string().trim().min(1),
  profiles: z.array(EvaluationProfileSchema).min(1),
  tags: z.array(StableIdSchema).default([]),
  requiredEvidence: z.array(EvidenceRequirementSchema).min(1),
  grading: GradingSchema,
};
const SetupSchema = z.object({ fixtureId: StableIdSchema }).strict();

const ConversationCaseSchema = z.object({
  ...CommonCaseShape,
  capability: z.literal('conversation'),
  setup: SetupSchema,
  trigger: z.object({
    kind: z.literal('send_user_input'),
    text: z.string().min(1),
    permissionMode: z.enum(['ask', 'auto', 'full_access']).default('auto'),
  }).strict(),
  completion: z.object({ kind: z.literal('run_terminal'), timeoutMs: z.number().int().positive() }).strict(),
}).strict();

const InterestUnderstandingCaseSchema = z.object({
  ...CommonCaseShape,
  capability: z.literal('interest_understanding'),
  setup: SetupSchema,
  trigger: z.object({ kind: z.literal('completed_conversation_turn'), text: z.string().min(1) }).strict(),
  completion: z.object({ kind: z.literal('interest_understanding_terminal'), timeoutMs: z.number().int().positive() }).strict(),
}).strict();

const CandidateSupplyCaseSchema = z.object({
  ...CommonCaseShape,
  capability: z.literal('candidate_supply'),
  setup: SetupSchema,
  trigger: z.object({ kind: z.literal('request_candidate_supply') }).strict(),
  completion: z.object({ kind: z.literal('candidate_supply_terminal'), timeoutMs: z.number().int().positive() }).strict(),
}).strict();

const DailyRecommendationCaseSchema = z.object({
  ...CommonCaseShape,
  capability: z.literal('daily_recommendation'),
  setup: SetupSchema,
  trigger: z.object({ kind: z.literal('ensure_daily'), localDate: z.string().date().optional() }).strict(),
  completion: z.object({ kind: z.literal('daily_batch_terminal'), timeoutMs: z.number().int().positive() }).strict(),
}).strict();

const PreferenceLearningCaseSchema = z.object({
  ...CommonCaseShape,
  capability: z.literal('preference_learning'),
  setup: SetupSchema,
  trigger: z.object({
    kind: z.literal('update_recommendation_feedback'),
    recommendationId: z.string().min(1),
    reaction: z.enum(['liked', 'disliked', 'none']),
  }).strict(),
  completion: z.object({ kind: z.literal('preference_learning_settled'), timeoutMs: z.number().int().positive() }).strict(),
}).strict();

export const EvaluationCaseSchema = z.discriminatedUnion('capability', [
  ConversationCaseSchema,
  InterestUnderstandingCaseSchema,
  CandidateSupplyCaseSchema,
  DailyRecommendationCaseSchema,
  PreferenceLearningCaseSchema,
]);
export type EvaluationCase = z.infer<typeof EvaluationCaseSchema>;
