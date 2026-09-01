/* Defines isolated initial product facts and controlled external conditions. */
import { z } from 'zod';
import { EvaluationCapabilitySchema } from '../catalog/evaluation-case';

const StableIdSchema = z.string().regex(/^[a-z0-9]+(?:[._:-][a-z0-9]+)*$/);
const WorkspaceFixtureSchema = z.object({ rootPath: z.string().min(1) }).strict();
const SessionFixtureSchema = z.object({
  fixtureSessionId: StableIdSchema,
  title: z.string().min(1),
  turns: z.array(z.object({ user: z.string(), assistant: z.string() }).strict()).default([]),
}).strict();
const InterestFixtureSchema = z.object({
  fixtureInterestId: StableIdSchema,
  description: z.string().min(1).max(1_000),
  status: z.enum(['active', 'paused']).default('active'),
}).strict();
const CandidateFixtureSchema = z.object({
  fixtureCandidateId: StableIdSchema,
  sourceId: z.string().min(1),
  sourceName: z.string().min(1),
  canonicalUrl: z.string().url(),
  title: z.string().min(1),
  description: z.string().optional(),
  contentText: z.string().optional(),
  matchedInterestFixtureIds: z.array(StableIdSchema),
  relevance: z.enum(['direct', 'adjacent', 'exploration']),
}).strict();
const RecommendationFixtureSchema = z.object({
  fixtureRecommendationId: StableIdSchema,
  candidateFixtureId: StableIdSchema,
  reason: z.string().min(1),
  reaction: z.enum(['liked', 'disliked', 'none']).default('none'),
}).strict();
const PreferenceFixtureSchema = z.object({
  scopeKey: z.string().min(1),
  directionId: z.string().min(1),
  polarity: z.enum(['positive', 'negative']),
  dimension: z.enum(['topic', 'source', 'author', 'content_type', 'recency', 'expression_quality']),
  statement: z.string().min(1),
  supportingRecommendationFixtureIds: z.array(StableIdSchema).min(1),
}).strict();
const ControlledSearchResultSchema = z.object({
  sourceId: z.string().min(1),
  queryIncludes: z.string(),
  results: z.array(z.object({
    url: z.string().url(), title: z.string(), snippet: z.string().optional(), content: z.string().optional(),
  }).strict()),
}).strict();

export const EvaluationFixtureSchema = z.object({
  fixtureId: StableIdSchema,
  version: z.number().int().positive(),
  capability: EvaluationCapabilitySchema,
  clock: z.string().datetime({ offset: true }),
  dailyTargetCount: z.number().int().min(1).max(100).default(3),
  workspace: WorkspaceFixtureSchema,
  sessions: z.array(SessionFixtureSchema).default([]),
  interests: z.array(InterestFixtureSchema).default([]),
  candidates: z.array(CandidateFixtureSchema).default([]),
  recommendations: z.array(RecommendationFixtureSchema).default([]),
  preferences: z.array(PreferenceFixtureSchema).default([]),
  controlledSearch: z.array(ControlledSearchResultSchema).default([]),
  permissionDecision: z.enum(['allow', 'deny', 'ask']).default('allow'),
}).strict();
export type EvaluationFixture = z.infer<typeof EvaluationFixtureSchema>;
