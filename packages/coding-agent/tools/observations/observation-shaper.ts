// Shapes raw executor output into bounded, provider-neutral model-visible observations.
import type {
  RawToolResult,
  ToolExecutionDecision,
  ToolExecutionRecord,
  ToolObservation,
  ToolObservationBudgetProfile,
} from '@megumi/shared/tool';

export interface ObservationShaperIds {
  observationId(): string;
}

export interface CreateObservationInput {
  rawResult: RawToolResult;
  profile: ToolObservationBudgetProfile;
  record: ToolExecutionRecord;
  ids: ObservationShaperIds;
  now: () => string;
}

const PROFILE_BYTE_LIMITS: Record<ToolObservationBudgetProfile, number> = {
  smallText: 8_000,
  largeText: 20_000,
  commandOutput: 20_000,
  fileRead: 40_000,
  error: 4_000,
};

export function createObservationFromRawToolResult(input: CreateObservationInput): ToolObservation {
  const text = stringifyRawContent(input.rawResult.content);
  const byteLength = Buffer.byteLength(text, 'utf8');
  const limit = PROFILE_BYTE_LIMITS[input.profile];
  const truncated = byteLength > limit;
  const content = truncated
    ? truncateForProfile(text, limit, input.profile)
    : text;

  return {
    observationId: input.ids.observationId(),
    toolExecutionId: input.record.toolExecutionId,
    toolCallId: input.record.toolCallId,
    runId: input.record.runId,
    stepId: input.record.stepId,
    kind: 'text',
    isError: input.rawResult.isError,
    content: truncated
      ? `${content}\n\n[Observation notice] Output was truncated by Megumi before provider model input.`
      : content,
    truncated,
    ...(truncated ? { truncationReason: 'byteLimit' as const } : {}),
    ...(truncated ? { rawResultRef: input.rawResult.rawToolResultId } : {}),
    ...(truncated ? { continuationHint: continuationHintForProfile(input.profile) } : {}),
    byteLength,
    tokenEstimate: estimateTokens(content),
    createdAt: input.now(),
    metadata: {
      budgetProfile: input.profile,
      rawOutputKind: input.rawResult.outputKind,
    },
  };
}

export function createRejectionObservation(input: {
  record: ToolExecutionRecord;
  decision: ToolExecutionDecision;
  ids: ObservationShaperIds;
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
    tokenEstimate: estimateTokens(content),
    createdAt: input.now(),
    metadata: {
      decisionReasonCode: input.decision.reasonCode,
    },
  };
}

export function createInterruptedExecutionObservation(input: {
  record: ToolExecutionRecord;
  ids: ObservationShaperIds;
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
    tokenEstimate: estimateTokens(content),
    createdAt: input.now(),
    metadata: {
      recoveryReason: 'runtime_interrupted',
    },
  };
}

function stringifyRawContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  return JSON.stringify(content, null, 2);
}

function truncateForProfile(
  content: string,
  limit: number,
  profile: ToolObservationBudgetProfile,
): string {
  if (profile === 'commandOutput') {
    return trimToUtf8Tail(content, limit);
  }
  return trimToUtf8Head(content, limit);
}

function trimToUtf8Head(content: string, limit: number): string {
  let output = content;
  while (Buffer.byteLength(output, 'utf8') > limit) {
    output = output.slice(0, Math.max(0, output.length - 256));
  }
  return output;
}

function trimToUtf8Tail(content: string, limit: number): string {
  let output = content;
  while (Buffer.byteLength(output, 'utf8') > limit) {
    output = output.slice(Math.min(output.length, 256));
  }
  return output;
}

function continuationHintForProfile(profile: ToolObservationBudgetProfile): string {
  if (profile === 'fileRead') {
    return 'Use a narrower file range to inspect omitted content.';
  }
  if (profile === 'commandOutput') {
    return 'Use the raw result reference or rerun with narrower output to inspect omitted command output.';
  }
  return 'Use a narrower query or range to inspect omitted content.';
}

function estimateTokens(content: string): number {
  return Math.ceil(content.length / 4);
}
