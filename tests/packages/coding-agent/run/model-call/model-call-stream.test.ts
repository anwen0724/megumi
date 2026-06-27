// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  createRuntimeEvent,
  type RuntimeEvent,
} from '@megumi/shared/runtime';
import type { ModelInputContext, ModelStepRuntimeRequest } from '@megumi/shared/model';
import type { ToolCallRunner } from '@megumi/coding-agent/run/tool-calls';
import {
  streamCodingAgentModelStep,
  type CodingAgentModelStepStreamPorts,
} from '@megumi/coding-agent/run';

describe('coding-agent model step stream', () => {
  it('calls the agent runtime through ports and builds continuation context in coding-agent', async () => {
    const requests: ModelStepRuntimeRequest[] = [];
    const continuationBuilds: unknown[] = [];
    const modelCallPort = {
      async *streamModelCall({ request }: { request: ModelStepRuntimeRequest }): AsyncIterable<RuntimeEvent> {
        requests.push(request);
        yield modelStepStarted(request, 1);
        if (requests.length === 1) {
          yield toolCallCreated(request, 2);
          yield modelStepCompleted(request, 3, 'tool_calls');
          return;
        }
        yield modelOutputDelta(request, 1, 'Done');
        yield assistantOutputCompleted(request, 2, 'Done');
        yield modelStepCompleted(request, 3, 'stop');
      },
    };
    const toolCallHandler = {
      async handleToolCalls() {
        return {
          toolResults: [{
            toolResultId: 'tool-result-1',
            toolCallId: 'tool-call-1',
            runId: 'run-1',
            kind: 'success' as const,
            textContent: 'file content',
            redactionState: 'none' as const,
            createdAt: '2026-06-21T00:00:01.000Z',
          }],
        };
      },
      async resumeToolApproval() {
        return undefined;
      },
    };
    const ports: CodingAgentModelStepStreamPorts = {
      modelCallPort,
      toolCallHandler: toolCallHandler as CodingAgentModelStepStreamPorts['toolCallHandler'],
      modelStepInputBuildService: {
        async buildModelStepInput(input) {
          continuationBuilds.push(input);
          return {
            buildRequest: {} as never,
            inputContext: modelInputContext('continuation-context'),
            toolDefinitions: input.toolDefinitions ?? [],
            instructionSources: [],
            availableCapabilitySummary: 'Available tools: read_file.',
          };
        },
      },
      sourceOverrideProvider: {
        resolveModelInputSourceOverrides() {
          return {};
        },
      },
      toolContinuationRecorder: {
        markToolContinuationEmitted(input) {
          return [toolContinuationEmitted(input.request, input.emittedAt)];
        },
      },
      ids: {
        nextEventId: () => `event-${Math.random()}`,
        nextStepId: () => 'step-2',
        nextModelStepId: () => 'model-step-2',
      },
    };

    const events = await collect(streamCodingAgentModelStep({
      request: runtimeRequest(),
      ports,
      permissionMode: 'default',
      projectRoot: 'C:/repo',
      memoryRecall: {
        memoryRecallSources: [],
      },
    }));

    expect(requests).toHaveLength(2);
    expect(requests[1]?.inputContext.contextId).toBe('continuation-context');
    expect(continuationBuilds).toHaveLength(1);
    expect(events.map((event) => event.eventType)).toEqual([
      'model.step.started',
      'tool.call.created',
      'model.step.completed',
      'tool.result.created',
      'tool.continuation.emitted',
      'model.step.started',
      'model.output.delta',
      'assistant.output.completed',
      'model.step.completed',
    ]);
  });
});

async function collect<T>(events: AsyncIterable<T>): Promise<T[]> {
  const output: T[] = [];
  for await (const event of events) {
    output.push(event);
  }
  return output;
}

function runtimeRequest(): ModelStepRuntimeRequest {
  return {
    requestId: 'request-1',
    sessionId: 'session-1',
    runId: 'run-1',
    stepId: 'step-1',
    modelStepId: 'model-step-1',
    providerId: 'openai',
    modelId: 'gpt-test',
    inputContext: modelInputContext('initial-context'),
    toolDefinitions: [{
      name: 'read_file',
      description: 'Read file',
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
      capabilities: ['project_read'],
      riskLevel: 'low' as const,
      sideEffect: 'none' as const,
      availability: { status: 'available' as const },
    }],
    createdAt: '2026-06-21T00:00:00.000Z',
  };
}

function modelInputContext(contextId: string): ModelInputContext {
  return {
    contextId,
    sessionId: 'session-1',
    runId: 'run-1',
    stepId: 'step-1',
    builtAt: '2026-06-21T00:00:00.000Z',
    parts: [],
    budget: {
      modelContextWindow: 8192,
      reservedOutputTokens: 1024,
      availableInputTokens: 7168,
      keepRecentTokens: 7168,
      inputTokenEstimate: 0,
      partBudgets: [],
    },
    trace: {
      buildReason: 'initial_model_step',
      selectedSources: [],
      excludedSources: [],
    },
  };
}

function modelStepStarted(request: ModelStepRuntimeRequest, sequence: number): RuntimeEvent {
  return createRuntimeEvent({
    eventId: `event-started-${sequence}`,
    eventType: 'model.step.started',
    runId: request.runId,
    sessionId: request.sessionId,
    stepId: request.stepId,
    requestId: request.requestId,
    sequence,
    createdAt: request.createdAt,
    source: 'provider',
    visibility: 'system',
    persist: 'required',
    payload: { modelStepId: request.modelStepId ?? request.stepId, providerId: request.providerId, modelId: request.modelId },
  });
}

function modelOutputDelta(request: ModelStepRuntimeRequest, sequence: number, delta: string): RuntimeEvent {
  return createRuntimeEvent({
    eventId: `event-delta-${sequence}`,
    eventType: 'model.output.delta',
    runId: request.runId,
    sessionId: request.sessionId,
    stepId: request.stepId,
    requestId: request.requestId,
    sequence,
    createdAt: request.createdAt,
    source: 'provider',
    visibility: 'user',
    persist: 'optional',
    payload: { modelStepId: request.modelStepId ?? request.stepId, delta },
  });
}

function assistantOutputCompleted(request: ModelStepRuntimeRequest, sequence: number, content: string): RuntimeEvent {
  return createRuntimeEvent({
    eventId: `event-assistant-completed-${sequence}`,
    eventType: 'assistant.output.completed',
    runId: request.runId,
    sessionId: request.sessionId,
    stepId: request.stepId,
    requestId: request.requestId,
    sequence,
    createdAt: request.createdAt,
    source: 'provider',
    visibility: 'user',
    persist: 'required',
    payload: { content },
  });
}

function modelStepCompleted(request: ModelStepRuntimeRequest, sequence: number, finishReason: string): RuntimeEvent {
  return createRuntimeEvent({
    eventId: `event-completed-${sequence}`,
    eventType: 'model.step.completed',
    runId: request.runId,
    sessionId: request.sessionId,
    stepId: request.stepId,
    requestId: request.requestId,
    sequence,
    createdAt: request.createdAt,
    source: 'provider',
    visibility: 'system',
    persist: 'required',
    payload: { modelStepId: request.modelStepId ?? request.stepId, finishReason },
  });
}

function toolCallCreated(request: ModelStepRuntimeRequest, sequence: number): RuntimeEvent {
  return createRuntimeEvent({
    eventId: `event-tool-call-${sequence}`,
    eventType: 'tool.call.created',
    runId: request.runId,
    sessionId: request.sessionId,
    stepId: request.stepId,
    requestId: request.requestId,
    sequence,
    createdAt: request.createdAt,
    source: 'provider',
    visibility: 'system',
    persist: 'required',
    payload: {
      toolCallId: 'tool-call-1',
      modelStepId: request.modelStepId ?? request.stepId,
      providerToolCallId: 'provider-tool-call-1',
      toolName: 'read_file',
      input: { path: 'package.json' },
    },
  });
}

function toolContinuationEmitted(request: ModelStepRuntimeRequest, createdAt: string): RuntimeEvent {
  return createRuntimeEvent({
    eventId: 'event-tool-continuation',
    eventType: 'tool.continuation.emitted',
    runId: request.runId,
    sessionId: request.sessionId,
    stepId: request.stepId,
    requestId: request.requestId,
    sequence: 0,
    createdAt,
    source: 'tool',
    visibility: 'system',
    persist: 'required',
    payload: {
      assistantMessageId: String(request.modelStepId ?? request.stepId),
      toolExecutionIds: ['tool-execution-1'],
      emittedAt: createdAt,
    },
  });
}
