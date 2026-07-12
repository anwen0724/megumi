/*
 * Projects provider-neutral model transcript items from persisted Agent Run events.
 * Runtime Event interpretation remains owned by Agent Run and is never leaked to Context.
 */
import type { JsonValue } from '@megumi/ai';
import type {
  ModelCallCompletedPayload,
  ModelCallToolCallPayload,
  RuntimeEvent,
  ToolResultCreatedPayload,
} from '../../events';
import type {
  GetRunTranscriptResult,
  RunModelTranscriptItem,
} from '../contracts/agent-run-query-contracts';
import {
  RuntimeEventIntegrityError,
  type AgentRunRepository,
} from '../repositories/agent-run-repository';

type TranscriptRepository = Pick<AgentRunRepository, 'getRun' | 'listRuntimeEventsByRunStrict'>;

type ModelCallGroup = {
  completion?: ModelCallCompletedPayload;
  toolCalls: Array<{ payload: ModelCallToolCallPayload; order: number }>;
};

type ToolResultEvent = {
  payload: ToolResultCreatedPayload;
  order: number;
};

export function getRunTranscript(
  repository: TranscriptRepository,
  runId: string,
): GetRunTranscriptResult {
  try {
    if (!repository.getRun(runId)) {
      return { status: 'not_found', runId };
    }

    const events = [...repository.listRuntimeEventsByRunStrict(runId)].sort(compareRuntimeEvents);
    return projectTranscript(runId, events);
  } catch (error) {
    if (error instanceof RuntimeEventIntegrityError) {
      return runtimeProtocolFailure(error.message);
    }
    return {
      status: 'failed',
      failure: {
        code: 'internal_error',
        message: `Failed to project transcript for run ${runId}: ${errorMessage(error)}`,
      },
    };
  }
}

function projectTranscript(runId: string, events: RuntimeEvent[]): GetRunTranscriptResult {
  const modelCalls = new Map<string, ModelCallGroup>();
  const toolResults: ToolResultEvent[] = [];
  const modelCallIdByToolCallId = new Map<string, string>();
  let protocolFailure: GetRunTranscriptResult | undefined;

  events.forEach((event, order) => {
    if (protocolFailure) return;
    if (event.eventType === 'model_call.completed') {
      const payload = event.payload as ModelCallCompletedPayload;
      const group = getOrCreateModelCall(modelCalls, payload.modelCallId);
      if (group.completion) {
        protocolFailure = runtimeProtocolFailure(
          `Duplicate model_call.completed fact for modelCallId ${payload.modelCallId}.`,
        );
        return;
      }
      group.completion = payload;
      return;
    }
    if (event.eventType === 'model_call.tool_call') {
      const payload = event.payload as ModelCallToolCallPayload;
      const existingModelCallId = modelCallIdByToolCallId.get(payload.toolCallId);
      if (existingModelCallId) {
        protocolFailure = runtimeProtocolFailure(existingModelCallId === payload.modelCallId
          ? `Duplicate model_call.tool_call fact for toolCallId ${payload.toolCallId}.`
          : `Duplicate model_call.tool_call fact for toolCallId ${payload.toolCallId} across model calls.`);
        return;
      }
      modelCallIdByToolCallId.set(payload.toolCallId, payload.modelCallId);
      const group = getOrCreateModelCall(modelCalls, payload.modelCallId);
      group.toolCalls.push({ payload, order });
      return;
    }
    if (event.eventType === 'tool_result.created') {
      toolResults.push({ payload: event.payload as ToolResultCreatedPayload, order });
    }
  });

  if (protocolFailure) return protocolFailure;

  if (modelCalls.size === 0 || [...modelCalls.values()].some((group) => !group.completion)) {
    return { status: 'incomplete', runId, reason: 'missing_model_call_completion' };
  }

  const toolCalls = [...modelCalls.values()].flatMap((group) => group.toolCalls);
  const toolCallIds = new Set(toolCalls.map(({ payload }) => payload.toolCallId));
  const orphan = toolResults.find(({ payload }) => !toolCallIds.has(payload.toolCallId));
  if (orphan) return incomplete(runId, 'orphan_tool_result', orphan.payload.toolCallId);

  const resultsByToolCallId = new Map<string, ToolResultEvent[]>();
  for (const result of toolResults) {
    const matches = resultsByToolCallId.get(result.payload.toolCallId) ?? [];
    matches.push(result);
    resultsByToolCallId.set(result.payload.toolCallId, matches);
  }
  for (const toolCall of toolCalls) {
    const results = resultsByToolCallId.get(toolCall.payload.toolCallId) ?? [];
    if (results.length > 1) {
      return incomplete(runId, 'duplicate_tool_result', toolCall.payload.toolCallId);
    }
    if (results.length === 0) {
      return incomplete(runId, 'missing_tool_result', toolCall.payload.toolCallId);
    }
  }

  const items: RunModelTranscriptItem[] = [];
  for (const group of modelCalls.values()) {
    const completion = group.completion!;
    if (completion.finishReason !== 'tool_calls') continue;
    if (completion.content?.length) {
      items.push({ type: 'assistant_message', content: completion.content });
    }
    const orderedToolCalls = [...group.toolCalls].sort((left, right) => left.order - right.order);
    for (const { payload } of orderedToolCalls) {
      items.push({
        type: 'tool_call',
        toolCallId: payload.toolCallId,
        toolName: payload.toolName,
        arguments: payload.input as JsonValue,
      });
    }
    const groupToolCallIds = new Set(orderedToolCalls.map(({ payload }) => payload.toolCallId));
    const orderedResults = toolResults
      .filter(({ payload }) => groupToolCallIds.has(payload.toolCallId))
      .sort((left, right) => left.order - right.order);
    for (const { payload } of orderedResults) {
      items.push({
        type: 'tool_result',
        toolCallId: payload.toolCallId,
        toolName: payload.toolName,
        status: payload.kind === 'success' ? 'success' : 'failure',
        content: payload.content,
      });
    }
  }

  return { status: 'found', transcript: { runId, items } };
}

function getOrCreateModelCall(
  modelCalls: Map<string, ModelCallGroup>,
  modelCallId: string,
): ModelCallGroup {
  const existing = modelCalls.get(modelCallId);
  if (existing) return existing;
  const created: ModelCallGroup = { toolCalls: [] };
  modelCalls.set(modelCallId, created);
  return created;
}

function incomplete(
  runId: string,
  reason: 'missing_tool_result' | 'orphan_tool_result' | 'duplicate_tool_result',
  toolCallId: string,
): GetRunTranscriptResult {
  return { status: 'incomplete', runId, reason, toolCallId };
}

function runtimeProtocolFailure(message: string): GetRunTranscriptResult {
  return {
    status: 'failed',
    failure: { code: 'runtime_protocol_violation', message },
  };
}

function compareRuntimeEvents(left: RuntimeEvent, right: RuntimeEvent): number {
  return left.sequence - right.sequence
    || left.createdAt.localeCompare(right.createdAt)
    || left.eventId.localeCompare(right.eventId);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
