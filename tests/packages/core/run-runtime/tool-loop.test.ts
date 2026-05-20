// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { ModelStepRuntimeRequest } from '@megumi/shared/model-step-contracts';
import type { RuntimeEvent } from '@megumi/shared/runtime-events';
import type { ToolResult } from '@megumi/shared/tool-contracts';
import { runModelToolLoop } from '@megumi/core/run-runtime/tool-loop';

async function collect<T>(events: AsyncIterable<T>): Promise<T[]> {
  const output: T[] = [];
  for await (const event of events) {
    output.push(event);
  }
  return output;
}

function createRequest(overrides: Partial<ModelStepRuntimeRequest> = {}): ModelStepRuntimeRequest {
  return {
    requestId: 'request-1',
    sessionId: 'session-1',
    runId: 'run-1',
    stepId: 'step-1',
    modelStepId: 'model-step-1',
    providerId: 'openai',
    modelId: 'gpt-4.1',
    messages: [
      {
        messageId: 'message-1',
        sessionId: 'session-1',
        role: 'user',
        content: 'Read package.json',
        status: 'completed',
        createdAt: '2026-05-17T00:00:00.000Z',
      },
    ],
    createdAt: '2026-05-17T00:00:00.000Z',
    ...overrides,
  };
}

function toolUseCreatedEvent(input: {
  eventId: string;
  sequence: number;
  stepId: string;
  modelStepId: string;
}): RuntimeEvent {
  return {
    eventId: input.eventId,
    schemaVersion: 1,
    eventType: 'tool.use.created',
    sessionId: 'session-1',
    runId: 'run-1',
    stepId: input.stepId,
    sequence: input.sequence,
    createdAt: '2026-05-17T00:00:01.000Z',
    source: 'provider',
    visibility: 'system',
    persist: 'required',
    payload: {
      toolUseId: 'call-read',
      modelStepId: input.modelStepId,
      providerToolUseId: 'call-read',
      toolName: 'read_file',
      input: { path: 'package.json' },
    },
  };
}

function modelStepCompletedEvent(input: {
  eventId: string;
  sequence: number;
  stepId: string;
  modelStepId: string;
}): RuntimeEvent {
  return {
    eventId: input.eventId,
    schemaVersion: 1,
    eventType: 'model.step.completed',
    sessionId: 'session-1',
    runId: 'run-1',
    stepId: input.stepId,
    sequence: input.sequence,
    createdAt: '2026-05-17T00:00:02.000Z',
    source: 'provider',
    visibility: 'system',
    persist: 'required',
    payload: {
      modelStepId: input.modelStepId,
      finishReason: 'tool_calls',
    },
  };
}

function assistantCompletedEvent(input: {
  eventId: string;
  sequence: number;
  stepId: string;
}): RuntimeEvent {
  return {
    eventId: input.eventId,
    schemaVersion: 1,
    eventType: 'assistant.output.completed',
    sessionId: 'session-1',
    runId: 'run-1',
    stepId: input.stepId,
    sequence: input.sequence,
    createdAt: '2026-05-17T00:00:03.000Z',
    source: 'provider',
    visibility: 'user',
    persist: 'required',
    payload: {
      content: 'Done',
    },
  };
}

function createToolResult(overrides: Partial<ToolResult> = {}): ToolResult {
  return {
    toolResultId: 'tool-result-1',
    toolUseId: 'call-read',
    runId: 'run-1',
    kind: 'success',
    structuredContent: { text: '{}' },
    textContent: '{}',
    redactionState: 'none',
    createdAt: '2026-05-17T00:00:02.500Z',
    ...overrides,
  };
}

describe('run model tool loop', () => {
  it('feeds tool results into the next model step after handling tool uses', async () => {
    const requests: ModelStepRuntimeRequest[] = [];

    const events = await collect(runModelToolLoop({
      initialRequest: createRequest(),
      aiPort: {
        async *streamModelStep(input) {
          requests.push(input.request);

          if (requests.length === 1) {
            yield toolUseCreatedEvent({
              eventId: input.eventIdFactory(),
              sequence: input.nextSequence(),
              stepId: input.request.stepId,
              modelStepId: String(input.request.modelStepId),
            });
            yield modelStepCompletedEvent({
              eventId: input.eventIdFactory(),
              sequence: input.nextSequence(),
              stepId: input.request.stepId,
              modelStepId: String(input.request.modelStepId),
            });
            return;
          }

          expect(input.request.toolResults).toHaveLength(1);
          yield assistantCompletedEvent({
            eventId: input.eventIdFactory(),
            sequence: input.nextSequence(),
            stepId: input.request.stepId,
          });
        },
      },
      toolUseHandler: {
        async handleToolUses(input) {
          expect(input.toolUses).toEqual([
            expect.objectContaining({
              toolUseId: 'call-read',
              modelStepId: 'model-step-1',
              providerToolUseId: 'call-read',
              toolName: 'read_file',
              input: { path: 'package.json' },
              inputPreview: {
                summary: 'read_file',
                targets: [],
                redactionState: 'none',
              },
              status: 'created',
            }),
          ]);

          return {
            toolResults: [createToolResult()],
          };
        },
      },
      ids: {
        nextEventId: (() => {
          let next = 1;
          return () => {
            next += 1;
            return `core-event-${next}`;
          };
        })(),
        nextStepId: () => 'step-2',
        nextModelStepId: () => 'model-step-2',
      },
    }));

    expect(requests).toHaveLength(2);
    expect(requests[1]).toMatchObject({
      stepId: 'step-2',
      modelStepId: 'model-step-2',
      toolResults: [expect.objectContaining({ toolResultId: 'tool-result-1' })],
    });
    expect(events.map((event) => event.eventType)).toEqual([
      'tool.use.created',
      'model.step.completed',
      'tool.result.created',
      'assistant.output.completed',
    ]);
    expect(events.find((event) => event.eventType === 'tool.result.created')).toMatchObject({
      eventId: 'core-event-4',
      sequence: 3,
      payload: {
        toolResultId: 'tool-result-1',
        toolUseId: 'call-read',
        kind: 'success',
        summary: '{}',
      },
    });
    expect(events.at(-1)?.eventType).toBe('assistant.output.completed');
  });

  it('stops before requesting another model step when tool handling returns pending approvals', async () => {
    const requests: ModelStepRuntimeRequest[] = [];

    const events = await collect(runModelToolLoop({
      initialRequest: createRequest(),
      aiPort: {
        async *streamModelStep(input) {
          requests.push(input.request);
          yield toolUseCreatedEvent({
            eventId: input.eventIdFactory(),
            sequence: input.nextSequence(),
            stepId: input.request.stepId,
            modelStepId: String(input.request.modelStepId),
          });
          yield modelStepCompletedEvent({
            eventId: input.eventIdFactory(),
            sequence: input.nextSequence(),
            stepId: input.request.stepId,
            modelStepId: String(input.request.modelStepId),
          });
        },
      },
      toolUseHandler: {
        async handleToolUses(input) {
          return {
            pendingApprovals: [
              {
                approvalRequestId: 'approval-1',
                toolUseId: input.toolUses[0].toolUseId,
                reason: 'User approval is required.',
              },
            ],
            toolResults: [],
          };
        },
      },
      ids: {
        nextEventId: () => 'core-event-approval',
        nextStepId: () => 'step-2',
        nextModelStepId: () => 'model-step-2',
      },
    }));

    expect(requests).toHaveLength(1);
    expect(events.map((event) => event.eventType)).toEqual([
      'tool.use.created',
      'model.step.completed',
    ]);
  });
});
