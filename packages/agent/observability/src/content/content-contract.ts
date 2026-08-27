/*
 * Defines the closed content checkpoints and safe persisted content representations.
 */
import { z } from 'zod';
import { DiagnosticJsonValueSchema, type DiagnosticJsonValue } from '../diagnostic-value';

export const CONTENT_KINDS = [
  'input.received',
  'input.processed',
  'session.message.committed',
  'context.resolved',
  'context.compaction.source',
  'context.compaction.summary',
  'prompt.final',
  'model.request',
  'model.provider_request',
  'model.provider_response',
  'model.response',
  'tool.request',
  'tool.arguments',
  'tool.handler_result',
  'tool.result',
  'source.request',
  'source.provider_response',
  'source.result',
  'discovery.material',
  'discovery.candidates',
  'discovery.selection',
  'discovery.recommendations',
  'candidate.pool.snapshot',
  'recommendation.published',
  'preference.learning.result',
  'preference.committed',
] as const;

export const ContentKindSchema = z.enum(CONTENT_KINDS);
export type ContentKind = z.infer<typeof ContentKindSchema>;

export const RedactionReasonSchema = z.enum([
  'credential',
  'authorization_header',
  'cookie',
  'password',
  'secret_field',
  'secret_pattern',
]);
export type RedactionReason = z.infer<typeof RedactionReasonSchema>;

export const UnavailableReasonSchema = z.enum([
  'unsupported_value',
  'circular_reference',
  'unsafe_property_access',
  'serialization_failed',
  'content_store_failed',
  'storage_limit',
]);
export type UnavailableReason = z.infer<typeof UnavailableReasonSchema>;

export const CaptureIssueSchema = z.discriminatedUnion('kind', [
  z.object({
    path: z.string(),
    kind: z.literal('redacted'),
    reason: RedactionReasonSchema,
  }).strict(),
  z.object({
    path: z.string(),
    kind: z.literal('unavailable'),
    reason: UnavailableReasonSchema,
  }).strict(),
]);
export type CaptureIssue = z.infer<typeof CaptureIssueSchema>;

export type CapturedContent =
  | {
      readonly mode: 'inline';
      readonly contentId: string;
      readonly mediaType: string;
      readonly value: DiagnosticJsonValue;
      readonly issues?: readonly CaptureIssue[];
    }
  | {
      readonly mode: 'stored';
      readonly contentId: string;
      readonly mediaType: string;
      readonly byteLength: number;
      readonly issues?: readonly CaptureIssue[];
    }
  | { readonly mode: 'redacted'; readonly reason: RedactionReason }
  | { readonly mode: 'unavailable'; readonly reason: UnavailableReason };

export const CapturedContentSchema: z.ZodType<CapturedContent> = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('inline'),
    contentId: z.string().regex(/^[a-f0-9]{64}$/),
    mediaType: z.string().min(1),
    value: DiagnosticJsonValueSchema,
    issues: z.array(CaptureIssueSchema).optional(),
  }).strict(),
  z.object({
    mode: z.literal('stored'),
    contentId: z.string().regex(/^[a-f0-9]{64}$/),
    mediaType: z.string().min(1),
    byteLength: z.number().int().nonnegative(),
    issues: z.array(CaptureIssueSchema).optional(),
  }).strict(),
  z.object({ mode: z.literal('redacted'), reason: RedactionReasonSchema }).strict(),
  z.object({ mode: z.literal('unavailable'), reason: UnavailableReasonSchema }).strict(),
]);

