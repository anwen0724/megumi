/*
 * Builds one tolerant historical Run view from persisted Agent Run facts.
 * Local model/tool outcomes never redefine the outer Run lifecycle.
 */
import type { JsonValue } from '@megumi/ai';
import type {
  ModelCallCompletedPayload,
  ModelCallToolCallPayload,
  RunCancelledPayload,
  RunFailedPayload,
  RuntimeEvent,
  ToolResultCreatedPayload,
} from '../../events';
import type {
  GetHistoricalRunResult,
  HistoricalRun,
  HistoricalRunDiagnostic,
} from '../contracts/agent-run-query-contracts';
import type { AgentRunRepository } from '../repositories/agent-run-repository';

type HistoricalRepository = Pick<AgentRunRepository, 'getRun' | 'readRuntimeEventsByRun'>;

type ModelStep = HistoricalRun['modelSteps'][number] & { order: number };

export function getHistoricalRun(
  repository: HistoricalRepository,
  runId: string,
): GetHistoricalRunResult {
  try {
    const run = repository.getRun(runId);
    if (!run) return { status: 'not_found', runId };

    const read = repository.readRuntimeEventsByRun(runId);
    const events = [...read.events].sort(compareRuntimeEvents);
    const diagnostics: HistoricalRunDiagnostic[] = [...read.diagnostics];
    const steps = new Map<string, ModelStep>();
    const toolCallStep = new Map<string, ModelStep>();
    const completedModelCallIds = new Set<string>();

    events.forEach((event, order) => {
      if (event.eventType === 'model_call.completed') {
        const payload = event.payload as ModelCallCompletedPayload;
        const step = getOrCreateStep(steps, payload.modelCallId, order);
        if (completedModelCallIds.has(payload.modelCallId)) {
          diagnostics.push({
            code: 'duplicate_model_completion',
            eventId: event.eventId,
            message: `Multiple model completion facts were recorded for ${payload.modelCallId}.`,
          });
          return;
        }
        completedModelCallIds.add(payload.modelCallId);
        step.assistantContent = payload.content ?? [];
        return;
      }

      if (event.eventType === 'model_call.tool_call') {
        const payload = event.payload as ModelCallToolCallPayload;
        const step = getOrCreateStep(steps, payload.modelCallId, order);
        if (toolCallStep.has(payload.toolCallId)) {
          diagnostics.push({
            code: 'duplicate_tool_call',
            eventId: event.eventId,
            toolCallId: payload.toolCallId,
            message: `Multiple Tool Call facts were recorded for ${payload.toolCallId}.`,
          });
          return;
        }
        step.toolCalls.push({
          toolCallId: payload.toolCallId,
          toolName: payload.toolName,
          arguments: payload.input as JsonValue,
        });
        toolCallStep.set(payload.toolCallId, step);
        return;
      }

      if (event.eventType === 'tool_result.created') {
        const payload = event.payload as ToolResultCreatedPayload;
        const step = toolCallStep.get(payload.toolCallId);
        const toolCall = step?.toolCalls.find((item) => item.toolCallId === payload.toolCallId);
        if (!toolCall) {
          diagnostics.push({
            code: 'orphan_tool_result',
            eventId: event.eventId,
            toolCallId: payload.toolCallId,
            message: `Tool Result ${payload.toolCallId} has no recorded Tool Call.`,
          });
          return;
        }
        if (toolCall.result) {
          diagnostics.push({
            code: 'duplicate_tool_result',
            eventId: event.eventId,
            toolCallId: payload.toolCallId,
            message: `Multiple Tool Result facts were recorded for ${payload.toolCallId}.`,
          });
          return;
        }
        toolCall.result = {
          status: payload.kind === 'success' ? 'success' : 'failure',
          content: payload.content,
        };
      }
    });

    const outcome = finalOutcome(run, events);
    return {
      status: 'found',
      historicalRun: {
        runId,
        runStatus: run.status,
        modelSteps: [...steps.values()]
          .sort((left, right) => left.order - right.order)
          .map(({ order: _order, ...step }) => step),
        ...(outcome ? { finalOutcome: outcome } : {}),
        diagnostics,
      },
    };
  } catch (error) {
    return {
      status: 'failed',
      failure: {
        code: 'internal_error',
        message: `Failed to read historical run ${runId}: ${error instanceof Error ? error.message : String(error)}`,
      },
    };
  }
}

function getOrCreateStep(steps: Map<string, ModelStep>, modelCallId: string, order: number): ModelStep {
  const existing = steps.get(modelCallId);
  if (existing) return existing;
  const created: ModelStep = { modelCallId, assistantContent: [], toolCalls: [], order };
  steps.set(modelCallId, created);
  return created;
}

function finalOutcome(run: NonNullable<ReturnType<HistoricalRepository['getRun']>>, events: RuntimeEvent[]): HistoricalRun['finalOutcome'] {
  const terminal = [...events].reverse().find((event) => event.eventType === 'run.failed' || event.eventType === 'run.cancelled');
  if (terminal?.eventType === 'run.failed') {
    const error = (terminal.payload as RunFailedPayload).error;
    return { code: error.code, message: error.message };
  }
  if (terminal?.eventType === 'run.cancelled') {
    const payload = terminal.payload as RunCancelledPayload;
    return {
      ...(payload.reason ? { reason: payload.reason } : {}),
      ...(payload.error?.code ? { code: payload.error.code } : {}),
      ...(payload.error?.message ? { message: payload.error.message } : {}),
    };
  }
  if (!run.failure) return undefined;
  return { code: run.failure.code, message: run.failure.message };
}

function compareRuntimeEvents(left: RuntimeEvent, right: RuntimeEvent): number {
  return left.sequence - right.sequence
    || left.createdAt.localeCompare(right.createdAt)
    || left.eventId.localeCompare(right.eventId);
}
