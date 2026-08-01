/*
 * Approval lifecycle event payloads, schemas, and creation functions.
 */
import { z } from 'zod';
import { JsonObjectSchema, JsonValueSchema, type JsonObject, type JsonValue } from '@megumi/ai';
import { APPROVAL_SCOPES } from './internal/runtime-event-dependencies';
import { eventSchema, RuntimeEventIsoDateTimeSchema } from './internal/event-schema-helpers';
import { createRuntimeEvent, type RunRuntimeEventFactoryInput } from './runtime-event-factory';
import type { TypedRuntimeEvent } from './runtime-event';

export interface ApprovalRequestedPayload {
  approvalRequest: {
    approvalRequestId: string;
    runId: string;
    toolCallId: string;
    toolName: string;
    toolIdentity: {
      sourceId: string;
      namespace: string;
      sourceToolName: string;
    };
    input: JsonValue;
    operations: JsonObject[];
    options: Array<{
      optionId: string;
      scope: 'once' | 'session';
      display: { label: string; description: string };
      effect: JsonObject;
    }>;
    defaultOptionId: string;
    status: 'pending' | 'approved' | 'denied' | 'cancelled';
    createdAt: string;
    summary?: string;
    preview?: {
      action: string;
      targets: Array<{ kind: string; label: string }>;
    };
  };
}
export interface ApprovalResolvedPayload {
  approvalRequestId: string;
  toolCallId: string;
  decision: 'approved' | 'denied' | 'expired' | 'cancelled';
  optionId?: string;
  scope?: 'once' | 'session';
  decidedAt: string;
}
export interface ApprovalExpiredPayload {
  approvalRequestId: string;
  toolCallId?: string;
  expiredAt: string;
}
export interface ApprovalEventPayloads {
  'approval.requested': ApprovalRequestedPayload;
  'approval.resolved': ApprovalResolvedPayload;
  'approval.expired': ApprovalExpiredPayload;
}
export type ApprovalEventType = keyof ApprovalEventPayloads;

const ApprovalRequestedPayloadSchema: z.ZodType<ApprovalRequestedPayload> = z.object({
  approvalRequest: z.object({
    approvalRequestId: z.string().min(1),
    runId: z.string().min(1),
    toolCallId: z.string().min(1),
    toolName: z.string().min(1),
    toolIdentity: z.object({
      sourceId: z.string().min(1),
      namespace: z.string().min(1),
      sourceToolName: z.string().min(1),
    }).strict(),
    input: JsonValueSchema,
    operations: z.array(JsonObjectSchema),
    options: z.array(z.object({
      optionId: z.string().min(1),
      scope: z.enum(APPROVAL_SCOPES),
      display: z.object({
        label: z.string().min(1),
        description: z.string().min(1),
      }).strict(),
      effect: JsonObjectSchema,
    }).strict()).min(1),
    defaultOptionId: z.string().min(1),
    status: z.enum(['pending', 'approved', 'denied', 'cancelled']),
    createdAt: RuntimeEventIsoDateTimeSchema,
    summary: z.string().min(1).optional(),
    preview: z.object({
      action: z.string().min(1),
      targets: z.array(z.object({
        kind: z.string().min(1),
        label: z.string().min(1),
      }).strict()),
    }).strict().optional(),
  }).strict(),
}).strict();
const ApprovalResolvedPayloadSchema = z.object({
  approvalRequestId: z.string().min(1),
  toolCallId: z.string().min(1),
  decision: z.enum(['approved', 'denied', 'expired', 'cancelled']),
  optionId: z.string().min(1).optional(),
  scope: z.enum(APPROVAL_SCOPES).optional(),
  decidedAt: RuntimeEventIsoDateTimeSchema,
}).strict();
const ApprovalExpiredPayloadSchema = z.object({
  approvalRequestId: z.string().min(1),
  toolCallId: z.string().min(1).optional(),
  expiredAt: RuntimeEventIsoDateTimeSchema,
}).strict();

export const ApprovalRequestedEventSchema = eventSchema('approval.requested', ApprovalRequestedPayloadSchema);
export const ApprovalResolvedEventSchema = eventSchema('approval.resolved', ApprovalResolvedPayloadSchema);
export const ApprovalExpiredEventSchema = eventSchema('approval.expired', ApprovalExpiredPayloadSchema);
export const APPROVAL_EVENT_SCHEMAS = {
  'approval.requested': ApprovalRequestedEventSchema,
  'approval.resolved': ApprovalResolvedEventSchema,
  'approval.expired': ApprovalExpiredEventSchema,
} as const;

export function createApprovalEvent<TType extends ApprovalEventType>(
  input: RunRuntimeEventFactoryInput<TType>,
): TypedRuntimeEvent<TType> { return createRuntimeEvent(input); }
export function createApprovalRequestedEvent(
  input: RunRuntimeEventFactoryInput<'approval.requested'>,
): TypedRuntimeEvent<'approval.requested'> { return createRuntimeEvent(input); }
