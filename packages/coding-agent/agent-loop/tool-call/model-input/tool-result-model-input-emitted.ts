// Marks tool results as submitted to the next model input and emits the legacy runtime event.
import type { ModelStepRuntimeRequest } from '@megumi/shared/model';
import {
  createToolContinuationEmittedEvent,
  type RuntimeEvent,
} from '@megumi/shared/runtime';
import type { RunStep } from '@megumi/shared/session';
import type { ToolResult } from '@megumi/shared/tool';
import { withRequestMetadata } from '../../../events';

export interface ToolResultModelInputEmissionRepositoryPort {
  markToolResultsSubmittedToModelInput(input: {
    toolExecutionIds: string[];
    emittedAt: string;
  }): void;
}

export interface ToolResultModelInputEmissionIds {
  eventId(): string;
}

export function markToolResultsSubmittedToModelInput(input: {
  request: ModelStepRuntimeRequest;
  stepId: RunStep['stepId'];
  toolResults: readonly ToolResult[];
  emittedAt: string;
  sequence: number;
  repository?: ToolResultModelInputEmissionRepositoryPort;
  ids: ToolResultModelInputEmissionIds;
}): RuntimeEvent | undefined {
  const toolExecutionIds = [
    ...new Set(input.toolResults
      .map((result) => result.toolExecutionId)
      .filter((id): id is string => typeof id === 'string' && id.length > 0)),
  ];
  if (toolExecutionIds.length === 0) {
    return undefined;
  }

  input.repository?.markToolResultsSubmittedToModelInput({
    toolExecutionIds,
    emittedAt: input.emittedAt,
  });

  const assistantMessageId = input.toolResults
    .map((result) => result.metadata?.assistantMessageId)
    .find((value): value is string => typeof value === 'string' && value.length > 0)
    ?? String(input.request.modelStepId ?? input.request.stepId);

  return withRequestMetadata(createToolContinuationEmittedEvent({
    eventId: input.ids.eventId(),
    eventType: 'tool.continuation.emitted',
    runId: input.request.runId,
    sessionId: input.request.sessionId,
    stepId: String(input.stepId),
    requestId: input.request.requestId,
    runtimeContext: input.request.runtimeContext,
    sequence: input.sequence,
    createdAt: input.emittedAt,
    source: 'tool',
    visibility: 'system',
    persist: 'required',
    payload: {
      assistantMessageId,
      toolExecutionIds,
      emittedAt: input.emittedAt,
    },
  }), input.request);
}
