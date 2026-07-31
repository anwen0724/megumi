/*
 * Approval lifecycle event payloads, schemas, and creation functions.
 */
import { z } from 'zod';
import {
  APPROVAL_SCOPES,
  ApprovalRequestSchema,
  type ApprovalRequest,
  type ApprovalScope,
  type ApprovalStatus,
} from './internal/runtime-event-dependencies';
import { eventSchema, RuntimeEventIsoDateTimeSchema } from './internal/event-schema-helpers';
import { createRuntimeEvent, type RunRuntimeEventFactoryInput } from './runtime-event-factory';
import type { TypedRuntimeEvent } from './runtime-event';

export interface ApprovalRequestedPayload { approvalRequest: ApprovalRequest }
export interface ApprovalResolvedPayload {
  approvalRequestId: string;
  toolCallId: string;
  decision: Exclude<ApprovalStatus, 'pending'>;
  optionId?: string;
  scope?: ApprovalScope;
  decidedAt: string;
}
export interface ApprovalExpiredPayload { approvalRequestId: string; toolCallId?: string; expiredAt: string }
export interface ApprovalEventPayloads {
  'approval.requested': ApprovalRequestedPayload;
  'approval.resolved': ApprovalResolvedPayload;
  'approval.expired': ApprovalExpiredPayload;
}
export type ApprovalEventType = keyof ApprovalEventPayloads;

const ApprovalRequestedPayloadSchema = z.object({ approvalRequest: ApprovalRequestSchema }).strict();
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
