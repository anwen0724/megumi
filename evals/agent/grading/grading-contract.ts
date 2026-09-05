/*
 * Owns scoring profiles, reviewer judgments, and independently versioned score records.
 */
import { z } from 'zod';
import { CandidateModelRecordSchema } from '../contracts/evaluation-run';
import { getMetricDefinition } from '../metrics/metric-catalog';

export const MEASUREMENT_IDS = ['efficiency.duration_ms', 'efficiency.input_tokens', 'efficiency.output_tokens',
  'efficiency.model_calls', 'efficiency.tool_calls', 'efficiency.source_calls', 'efficiency.retries'] as const;
export const RULE_IDS = ['recommendation.novelty', 'recommendation.publication_integrity',
  'preference.retraction_correctness', 'preference.evidence_preservation'] as const;
const DigestSchema = z.string().regex(/^[a-f0-9]{64}$/u);
const IdentitySchema = z.string().min(1);
const MetricPolicySchema = z.object({
  metricId: IdentitySchema,
  method: z.enum(['measurement', 'rule', 'human']),
  direction: z.enum(['higher', 'lower']),
  threshold: z.number().finite().nonnegative().optional(),
  rubric: z.string().trim().min(1).optional(),
}).strict();

export const GradingProfileSchema = z.object({
  schemaVersion: z.literal(1),
  profileId: IdentitySchema,
  revision: z.number().int().positive(),
  metrics: z.array(MetricPolicySchema).min(1),
}).strict().superRefine((profile, context) => {
  const seen = new Set<string>();
  for (const [index, metric] of profile.metrics.entries()) {
    let message: string | undefined;
    if (!getMetricDefinition(metric.metricId)) message = 'Unknown Metric ID.';
    else if (seen.has(metric.metricId)) message = 'Duplicate Metric ID.';
    else if (metric.method === 'human' && !metric.rubric) message = 'Human metrics require a rubric.';
    else if (metric.method !== 'human' && metric.rubric) message = 'Only human metrics accept a rubric.';
    else if (metric.method === 'measurement' && !(MEASUREMENT_IDS as readonly string[]).includes(metric.metricId)) message = 'Unsupported measurement.';
    else if (metric.method === 'rule' && !(RULE_IDS as readonly string[]).includes(metric.metricId)) message = 'Unsupported rule.';
    if (message) context.addIssue({ code: 'custom', path: ['metrics', index], message });
    seen.add(metric.metricId);
  }
});
export type GradingProfile = z.infer<typeof GradingProfileSchema>;
export type MetricPolicy = z.infer<typeof MetricPolicySchema>;

const MetricResultBase = { metricId: IdentitySchema, reason: z.string().min(1) };
export const MetricResultSchema = z.discriminatedUnion('status', [
  z.object({ ...MetricResultBase, status: z.literal('scored'), value: z.number().finite().nonnegative(),
    numerator: z.number().finite().nonnegative().optional(), denominator: z.number().finite().positive().optional(),
    reviewer: z.string().min(1).optional() }).strict(),
  z.object({ ...MetricResultBase, status: z.literal('unavailable') }).strict(),
  z.object({ ...MetricResultBase, status: z.literal('needs_review') }).strict(),
  z.object({ ...MetricResultBase, status: z.literal('not_applicable'), reviewer: z.string().min(1).optional() }).strict(),
]);
export type MetricResult = z.infer<typeof MetricResultSchema>;
export const GradedCaseSchema = z.object({
  caseIdentity: IdentitySchema, caseDigest: DigestSchema, evidenceDigest: DigestSchema,
  environmentKind: z.enum(['controlled', 'live']),
  caseType: z.enum(['conversation', 'interest_understanding', 'candidate_supply', 'recommendation', 'preference_learning']),
  recordStatus: z.enum(['recorded', 'infrastructure_failed']),
  terminalState: z.enum(['settled', 'pending', 'interrupted']).optional(),
  status: z.enum(['passed', 'failed', 'incomplete']),
  metrics: z.array(MetricResultSchema),
}).strict();
export type GradedCase = z.infer<typeof GradedCaseSchema>;
export const ScoreReportSchema = z.object({
  schemaVersion: z.literal(1), createdAt: z.string().datetime({ offset: true }),
  runId: IdentitySchema, runDigest: DigestSchema, candidateModel: CandidateModelRecordSchema,
  profile: GradingProfileSchema, profileDigest: DigestSchema,
  status: z.enum(['passed', 'failed', 'incomplete']), cases: z.array(GradedCaseSchema).min(1),
}).strict();
export type ScoreReport = z.infer<typeof ScoreReportSchema>;

const ReviewIdentity = {
  caseIdentity: IdentitySchema, caseDigest: DigestSchema, evidenceDigest: DigestSchema, metricId: IdentitySchema,
};
export const ReviewSchema = z.object({
  schemaVersion: z.literal(1), runId: IdentitySchema, profileDigest: DigestSchema,
  entries: z.array(z.discriminatedUnion('decision', [
    z.object({ ...ReviewIdentity, decision: z.literal('pending') }).strict(),
    z.object({ ...ReviewIdentity, decision: z.literal('scored'), numerator: z.number().finite().nonnegative(),
      denominator: z.number().finite().positive(), reason: z.string().trim().min(1), reviewer: z.string().trim().min(1) }).strict(),
    z.object({ ...ReviewIdentity, decision: z.literal('not_applicable'),
      reason: z.string().trim().min(1), reviewer: z.string().trim().min(1) }).strict(),
  ])),
}).strict().superRefine((review, context) => {
  const seen = new Set<string>();
  for (const [index, entry] of review.entries.entries()) {
    const key = JSON.stringify([entry.caseIdentity, entry.metricId]);
    if (seen.has(key)) context.addIssue({ code: 'custom', path: ['entries', index], message: 'Duplicate review entry.' });
    if (entry.decision === 'scored' && entry.numerator > entry.denominator) {
      context.addIssue({ code: 'custom', path: ['entries', index], message: 'Numerator cannot exceed denominator.' });
    }
    seen.add(key);
  }
});
