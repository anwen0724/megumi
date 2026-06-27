// Converts tool execution records into runtime events consumed by the run loop.
import { createRuntimeEvent, type RuntimeEvent } from '@megumi/shared/runtime';
import type { ToolExecutionRecord } from '@megumi/shared/tool';
import type { ResolvedToolCallRunnerOptions } from '../tool-call-runner';
import { isContinuationTerminal } from '../execution/tool-execution-window';
import {
  recordEventPayload,
  runtimeErrorFromFailedRecord,
} from '../execution/tool-execution-record';
import { continuationReady } from './tool-result-continuation';

export function runtimeEventsFromRecords(
  options: ResolvedToolCallRunnerOptions,
  assistantMessageId: string,
  allRecords: readonly ToolExecutionRecord[],
  eventRecords: readonly ToolExecutionRecord[],
  createdAt: string,
): RuntimeEvent[] {
  const events: RuntimeEvent[] = [];

  for (const record of eventRecords) {
    events.push(createRuntimeEvent({
      eventId: options.ids.eventId?.() ?? `event:${crypto.randomUUID()}`,
      eventType: 'tool.execution.requested',
      runId: String(record.runId),
      stepId: String(record.stepId),
      sequence: 0,
      createdAt: record.requestedAt,
      source: 'tool',
      visibility: 'system',
      persist: 'required',
      payload: {
        toolExecution: record,
      },
    }));
    if (record.decision) {
      events.push(createRuntimeEvent({
        eventId: options.ids.eventId?.() ?? `event:${crypto.randomUUID()}`,
        eventType: 'tool.execution.decided',
        runId: String(record.runId),
        stepId: String(record.stepId),
        sequence: 0,
        createdAt,
        source: 'tool',
        visibility: 'system',
        persist: 'required',
        payload: {
          ...recordEventPayload(record),
          decision: {
            outcome: record.decision.outcome,
            reasonCode: record.decision.reasonCode,
            executionClass: record.decision.executionClass,
            executionMode: record.decision.executionMode,
          },
        },
      }));
    }
    if (record.decision?.outcome === 'allow') {
      events.push(createRuntimeEvent({
        eventId: options.ids.eventId?.() ?? `event:${crypto.randomUUID()}`,
        eventType: 'tool.execution.queued',
        runId: String(record.runId),
        stepId: String(record.stepId),
        sequence: 0,
        createdAt,
        source: 'tool',
        visibility: 'system',
        persist: 'required',
        payload: {
          ...recordEventPayload(record),
          status: 'queued',
        },
      }));
    }
    if (record.startedAt) {
      events.push(createRuntimeEvent({
        eventId: options.ids.eventId?.() ?? `event:${crypto.randomUUID()}`,
        eventType: 'tool.execution.started',
        runId: String(record.runId),
        stepId: String(record.stepId),
        sequence: 0,
        createdAt: record.startedAt,
        source: 'tool',
        visibility: 'system',
        persist: 'required',
        payload: {
          toolExecutionId: String(record.toolExecutionId),
          startedAt: record.startedAt,
        },
      }));
    }
    if (record.status === 'awaitingApproval' && record.approvalRequestId) {
      const approvalRequest = options.repository.getApprovalRequest(String(record.approvalRequestId));
      if (approvalRequest) {
        events.push(createRuntimeEvent({
          eventId: options.ids.eventId?.() ?? `event:${crypto.randomUUID()}`,
          eventType: 'tool.execution.approval_requested',
          runId: String(record.runId),
          stepId: String(record.stepId),
          sequence: 0,
          createdAt: approvalRequest.createdAt,
          source: 'tool',
          visibility: 'system',
          persist: 'required',
          payload: {
            toolExecutionId: String(record.toolExecutionId),
            toolName: record.toolName,
            approvalRequest,
          },
        }));
        events.push(createRuntimeEvent({
          eventId: options.ids.eventId?.() ?? `event:${crypto.randomUUID()}`,
          eventType: 'approval.requested',
          runId: String(record.runId),
          stepId: String(record.stepId),
          sequence: 0,
          createdAt: approvalRequest.createdAt,
          source: 'approval',
          visibility: 'system',
          persist: 'required',
          payload: {
            approvalRequest,
          },
        }));
      }
    }
    if (record.status === 'rejected' && record.decision) {
      events.push(createRuntimeEvent({
        eventId: options.ids.eventId?.() ?? `event:${crypto.randomUUID()}`,
        eventType: 'tool.execution.rejected',
        runId: String(record.runId),
        stepId: String(record.stepId),
        sequence: 0,
        createdAt,
        source: 'tool',
        visibility: 'system',
        persist: 'required',
        payload: {
          ...recordEventPayload(record),
          decision: {
            outcome: record.decision.outcome,
            reasonCode: record.decision.reasonCode,
            executionClass: record.decision.executionClass,
            executionMode: record.decision.executionMode,
          },
        },
      }));
      events.push(createRuntimeEvent({
        eventId: options.ids.eventId?.() ?? `event:${crypto.randomUUID()}`,
        eventType: 'tool.execution.denied',
        runId: String(record.runId),
        stepId: String(record.stepId),
        sequence: 0,
        createdAt: record.completedAt ?? createdAt,
        source: 'tool',
        visibility: 'user',
        persist: 'required',
        payload: {
          toolExecutionId: String(record.toolExecutionId),
          reason: record.decision.reason,
        },
      }));
    }
    if (record.status === 'cancelled') {
      events.push(createRuntimeEvent({
        eventId: options.ids.eventId?.() ?? `event:${crypto.randomUUID()}`,
        eventType: 'tool.execution.cancelled',
        runId: String(record.runId),
        stepId: String(record.stepId),
        sequence: 0,
        createdAt,
        source: 'tool',
        visibility: 'system',
        persist: 'required',
        payload: recordEventPayload(record),
      }));
    }
    if (record.status === 'succeeded') {
      events.push(createRuntimeEvent({
        eventId: options.ids.eventId?.() ?? `event:${crypto.randomUUID()}`,
        eventType: 'tool.execution.completed',
        runId: String(record.runId),
        stepId: String(record.stepId),
        sequence: 0,
        createdAt: record.completedAt ?? createdAt,
        source: 'tool',
        visibility: 'system',
        persist: 'required',
        payload: {
          toolExecutionId: String(record.toolExecutionId),
          ...(record.completedAt ? { completedAt: record.completedAt } : {}),
        },
      }));
    }
    if (record.status === 'failed') {
      events.push(createRuntimeEvent({
        eventId: options.ids.eventId?.() ?? `event:${crypto.randomUUID()}`,
        eventType: 'tool.execution.failed',
        runId: String(record.runId),
        stepId: String(record.stepId),
        sequence: 0,
        createdAt: record.completedAt ?? createdAt,
        source: 'tool',
        visibility: 'user',
        persist: 'required',
        payload: {
          toolExecutionId: String(record.toolExecutionId),
          error: runtimeErrorFromFailedRecord(record),
          ...(record.completedAt ? { completedAt: record.completedAt } : {}),
        },
      }));
    }
    if (record.observation) {
      events.push(createRuntimeEvent({
        eventId: options.ids.eventId?.() ?? `event:${crypto.randomUUID()}`,
        eventType: 'tool.observation.ready',
        runId: String(record.runId),
        stepId: String(record.stepId),
        sequence: 0,
        createdAt: record.observation.createdAt,
        source: 'tool',
        visibility: 'system',
        persist: 'required',
        payload: {
          ...recordEventPayload(record),
          observationId: String(record.observation.observationId),
          isError: record.observation.isError,
          truncated: record.observation.truncated,
        },
      }));
    }
  }

  if (continuationReady(allRecords)) {
    events.push(createRuntimeEvent({
      eventId: options.ids.eventId?.() ?? `event:${crypto.randomUUID()}`,
      eventType: 'tool.continuation.ready',
      runId: String(allRecords[0]?.runId ?? ''),
      stepId: String(allRecords[0]?.stepId ?? ''),
      sequence: 0,
      createdAt,
      source: 'tool',
      visibility: 'system',
      persist: 'required',
      payload: {
        assistantMessageId,
        toolExecutionIds: allRecords
          .filter((record) => isContinuationTerminal(record.status))
          .map((record) => String(record.toolExecutionId)),
      },
    }));
  }

  return events;
}
