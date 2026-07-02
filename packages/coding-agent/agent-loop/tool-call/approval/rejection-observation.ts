// Builds model-visible observations for tool calls rejected before execution.
import type {
  ToolExecutionDecision,
  ToolExecutionRecord,
  ToolObservation,
} from '@megumi/shared/tool';

export interface RejectionObservationIds {
  observationId(): string;
}

export function createRejectionObservation(input: {
  record: ToolExecutionRecord;
  decision: ToolExecutionDecision;
  ids: RejectionObservationIds;
  now: () => string;
}): ToolObservation {
  const content = [
    'Tool call was rejected by Megumi.',
    `Reason code: ${input.decision.reasonCode}`,
    `Reason: ${input.decision.reason}`,
  ].join('\n');

  return {
    observationId: input.ids.observationId(),
    toolExecutionId: input.record.toolExecutionId,
    toolCallId: input.record.toolCallId,
    runId: input.record.runId,
    stepId: input.record.stepId,
    kind: 'text',
    isError: true,
    content,
    truncated: false,
    byteLength: Buffer.byteLength(content, 'utf8'),
    tokenEstimate: Math.ceil(content.length / 4),
    createdAt: input.now(),
    metadata: {
      decisionReasonCode: input.decision.reasonCode,
    },
  };
}

export function createInterruptedExecutionObservation(input: {
  record: ToolExecutionRecord;
  ids: RejectionObservationIds;
  now: () => string;
}): ToolObservation {
  const content = [
    'Tool execution was interrupted before completion.',
    'Reason code: RUNTIME_INTERRUPTED',
    'Reason: The application restarted or the runtime stopped while the tool was running.',
  ].join('\n');

  return {
    observationId: input.ids.observationId(),
    toolExecutionId: input.record.toolExecutionId,
    toolCallId: input.record.toolCallId,
    runId: input.record.runId,
    stepId: input.record.stepId,
    kind: 'text',
    isError: true,
    content,
    truncated: false,
    byteLength: Buffer.byteLength(content, 'utf8'),
    tokenEstimate: Math.ceil(content.length / 4),
    createdAt: input.now(),
    metadata: {
      recoveryReason: 'runtime_interrupted',
    },
  };
}
