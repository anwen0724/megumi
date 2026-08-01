/*
 * Stable runtime event envelope and protocol value sets.
 * Payload definitions remain vertically owned by their event-family modules.
 */
import type { ActionEventPayloads } from './action-events';
import type { ApprovalEventPayloads } from './approval-events';
import type { CheckpointEventPayloads } from './checkpoint-events';
import type { ContextEventPayloads } from './context-events';
import type { ErrorEventPayloads } from './error-events';
import type { MessageEventPayloads } from './message-events';
import type { ModelEventPayloads } from './model-events';
import type { ObservationEventPayloads } from './observation-events';
import type { RetryEventPayloads } from './retry-events';
import type { RunEventPayloads } from './run-events';
import type { SessionEventPayloads } from './session-events';
import type { ToolEventPayloads } from './tool-events';
import type { WorkspaceEventPayloads } from './workspace-events';
import type { RuntimeContext } from './runtime-error';

export const RUNTIME_EVENT_SCHEMA_VERSION = 1 as const;

export const RUNTIME_EVENT_TYPES = [
  'session.created',
  'session.updated',
  'session.active_leaf.changed',
  'session.branch_marker.created',
  'session.branch_draft.cancelled',
  'run.created',
  'run.started',
  'run.status.changed',
  'run.completed',
  'run.failed',
  'run.cancelled',
  'run.interrupted',
  'run.waiting',
  'observation.received',
  'context.patch.requested',
  'context.patch.applied',
  'context.patch.rejected',
  'context.effective.updated',
  'context.compaction.started',
  'context.compaction.completed',
  'context.compaction.failed',
  'message.delta',
  'message.completed',
  'error.raised',
  'assistant.output.delta',
  'assistant.output.completed',
  'model_call.started',
  'model_call.text_delta',
  'model_call.projection_reset',
  'model_call.completed',
  'model_call.tool_call',
  'model.thinking.started',
  'model.thinking.delta',
  'model.thinking.completed',
  'model.tool_call.detected',
  'tool_call.requested',
  'tool_call.started',
  'tool_call.completed',
  'tool_call.failed',
  'tool.call.created',
  'tool.call.resolved',
  'tool.call.resolution_failed',
  'tool.input.validation_failed',
  'tool_result.created',
  'tool.result.created',
  'tool.registry.sources.ensured',
  'tool.registry.snapshot.created',
  'tool.registry.entry.resolved',
  'tool.registry.model_visible_tools.derived',
  'tool.execution.requested',
  'tool.execution.validated',
  'tool.execution.decided',
  'tool.execution.queued',
  'tool.execution.rejected',
  'tool.execution.cancelled',
  'tool.execution.policy_decided',
  'permission.decision.created',
  'tool.execution.approval_requested',
  'tool.execution.started',
  'tool.execution.routed',
  'tool.execution.completed',
  'tool.execution.failed',
  'tool.execution.denied',
  'tool.observation.ready',
  'tool.continuation.ready',
  'tool.continuation.emitted',
  'approval.requested',
  'approval.resolved',
  'approval.expired',
  'checkpoint.created',
  'checkpoint.restored',
  'checkpoint.invalidated',
  'checkpoint.discarded',
  'run.resume.requested',
  'run.resumed',
  'run.resume.failed',
  'run.cancel.requested',
  'run.cancelling',
  'action.cancelled',
  'run.retry.requested',
  'action.retry.requested',
  'retry.started',
  'retry.completed',
  'retry.failed',
  'workspace.restore.requested',
  'workspace.restore.completed',
] as const;

export type RuntimeEventType = (typeof RUNTIME_EVENT_TYPES)[number];

export const HOST_MAINTENANCE_RUNTIME_EVENT_TYPES = ['action.requested'] as const;
export type HostMaintenanceRuntimeEventType = (typeof HOST_MAINTENANCE_RUNTIME_EVENT_TYPES)[number];

export const RUNTIME_EVENT_ENVELOPE_TYPES = [
  ...RUNTIME_EVENT_TYPES,
  ...HOST_MAINTENANCE_RUNTIME_EVENT_TYPES,
] as const;
export type RuntimeEventEnvelopeType = (typeof RUNTIME_EVENT_ENVELOPE_TYPES)[number];

export const TERMINAL_RUNTIME_EVENT_TYPES = ['run.completed', 'run.failed', 'run.cancelled'] as const;
export type TerminalRuntimeEventType = (typeof TERMINAL_RUNTIME_EVENT_TYPES)[number];

export const RUNTIME_EVENT_SOURCES = [
  'main',
  'core',
  'provider',
  'tool',
  'approval',
  'workspace',
  'database',
  'security',
  'unknown',
] as const;
export type RuntimeEventSource = (typeof RUNTIME_EVENT_SOURCES)[number];

export const RUNTIME_EVENT_VISIBILITIES = ['user', 'system', 'debug'] as const;
export type RuntimeEventVisibility = (typeof RUNTIME_EVENT_VISIBILITIES)[number];

export const RUNTIME_EVENT_PERSIST_MODES = ['required', 'optional', 'transient'] as const;
export type RuntimeEventPersistMode = (typeof RUNTIME_EVENT_PERSIST_MODES)[number];

export interface RuntimeEvent<TPayload extends object = object> {
  eventId: string;
  schemaVersion: typeof RUNTIME_EVENT_SCHEMA_VERSION;
  eventType: RuntimeEventEnvelopeType;
  runId?: string;
  sessionId?: string;
  actionId?: string;
  observationId?: string;
  messageId?: string;
  requestId?: string;
  context?: RuntimeContext;
  sequence: number;
  createdAt: string;
  source: RuntimeEventSource;
  visibility: RuntimeEventVisibility;
  persist: RuntimeEventPersistMode;
  payload: TPayload;
}

export type RuntimeEventPayloadByType = SessionEventPayloads
  & RunEventPayloads
  & ActionEventPayloads
  & ObservationEventPayloads
  & ContextEventPayloads
  & MessageEventPayloads
  & ErrorEventPayloads
  & ModelEventPayloads
  & ToolEventPayloads
  & ApprovalEventPayloads
  & CheckpointEventPayloads
  & RetryEventPayloads
  & WorkspaceEventPayloads;

type MissingPayloadMappings = Exclude<RuntimeEventEnvelopeType, keyof RuntimeEventPayloadByType>;
type ExtraPayloadMappings = Exclude<keyof RuntimeEventPayloadByType, RuntimeEventEnvelopeType>;
const _runtimeEventPayloadMappingsAreComplete: MissingPayloadMappings extends never
  ? ExtraPayloadMappings extends never ? true : never
  : never = true;
void _runtimeEventPayloadMappingsAreComplete;

export type TypedRuntimeEvent<TType extends RuntimeEventEnvelopeType> = RuntimeEvent<
  RuntimeEventPayloadByType[TType]
> & { eventType: TType };

export function isTerminalRuntimeEvent(
  value: RuntimeEventEnvelopeType,
): value is TerminalRuntimeEventType {
  return (TERMINAL_RUNTIME_EVENT_TYPES as readonly string[]).includes(value);
}
