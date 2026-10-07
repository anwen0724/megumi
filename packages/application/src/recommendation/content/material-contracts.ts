/* Defines immutable material and evidence contracts used by Content and Candidate. */
import { z } from 'zod';

export const ANALYSIS_CONTRACT_VERSION = 2;

export const MATCHING_CONTRACT_VERSION = 2;

/** A single external attempt, owned by its persisted discovery run. */
export interface DiscoveryAttempt {
  readonly runId: string;
  readonly token: string;
  readonly startedAt: number;
  readonly deadlineAt: number;
}

export const PublicationEvidenceSchema = z.object({
  kind: z.enum(['published', 'modified', 'indexed', 'unknown']),
  value: z.union([z.string(), z.number().int().nonnegative()]).nullable(),
  precision: z.enum(['instant', 'date', 'unknown']),
  timezone: z.string().nullable(),
  location: z.string().min(1),
  rawValue: z.string().nullable(),
  status: z.enum(['verified', 'unverified', 'conflicting']),
}).strict();
export type PublicationEvidence = z.infer<typeof PublicationEvidenceSchema>;

export const EvidenceSchema = z.object({ materialId: z.string().min(1), quote: z.string().min(1) }).strict();
export type Evidence = z.infer<typeof EvidenceSchema>;

export const MaterialInputSchema = z.object({
  platform: z.string().trim().min(1),
  externalId: z.string().trim().min(1).optional(),
  canonicalUrl: z.string().url(),
  title: z.string().optional(),
  author: z.string().optional(),
  authorId: z.string().optional(),
  language: z.string().trim().min(1).optional(),
  text: z.string().min(1),
  kind: z.enum(['full_text', 'excerpt', 'description', 'transcript']),
  truncated: z.boolean(),
  rangeStart: z.number().int().nonnegative().default(0),
  rangeEnd: z.number().int().positive(),
  method: z.string().trim().min(1),
  acquiredAt: z.number().int().nonnegative(),
  publicationEvidence: z.array(PublicationEvidenceSchema),
}).strict().superRefine((material, context) => {
  if (material.rangeEnd - material.rangeStart !== [...material.text].length) {
    context.addIssue({
      code: 'custom',
      path: ['rangeEnd'],
      message: 'The range must describe the acquired text in Unicode code points.'
    });
  }
});
export type MaterialInput = z.input<typeof MaterialInputSchema>;
export type ContentMaterial = z.output<typeof MaterialInputSchema> & { id: string; contentId: string; revision: number };

export const MaterialAnalysisSchema = z.object({
  summary: z.string().min(1),
  keyPoints: z.array(z.object({ text: z.string().min(1), evidence: z.array(EvidenceSchema).min(1) }).strict()),
  topics: z.array(z.string().min(1)),
  contentType: z.enum(['news', 'article', 'discussion', 'video', 'paper', 'project', 'tutorial', 'opinion']),
  qualityScore: z.number().min(0).max(1),
  spamScore: z.number().min(0).max(1),
  timeScope: z.object({
    kind: z.enum(['current', 'durable', 'unknown']),
    deadline: z.number().int().nonnegative().optional(),
    evidence: z.array(EvidenceSchema)
  }).strict(),
}).strict();
export type MaterialAnalysis = z.infer<typeof MaterialAnalysisSchema>;
