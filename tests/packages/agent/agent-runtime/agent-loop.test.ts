// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildModelStepInputContextFromSources } from '@megumi/coding-agent/context/model-step-input-context';
import type { ModelStepRuntimeRequest } from '@megumi/shared/model';
import type { RuntimeEvent } from '@megumi/shared/runtime';
import type { ApprovalRequest, ToolCall, ToolExecution, ToolResult } from '@megumi/shared/tool';
import { runModelToolLoop } from '@megumi/agent';
import type {
  PendingToolApproval,
  PendingToolApprovalContinuation,
} from '@megumi/agent';

async function collect<T>(events: AsyncIterable<T>): Promise<T[]> {
  const output: T[] = [];
  for await (const event of events) {
    output.push(event);
  }
  return output;
}

function createRequest(overrides: Partial<ModelStepRuntimeRequest> = {}): ModelStepRuntimeRequest {
  const inputContext = buildModelStepInputContextFromSources({
    contextId: 'model-input-context:request-1',
    sessionId: 'session-1',
    runId: 'run-1',
    stepId: 'step-1',
    buildReason: 'initial_model_step',
    builtAt: '2026-05-17T00:00:00.000Z',
    currentMessage: {
      messageId: 'message-1',
      sessionId: 'session-1',
      role: 'user',
      content: 'Read package.json',
      status: 'completed',
      createdAt: '2026-05-17T00:00:00.000Z',
    },
  });

  return {
    requestId: 'request-1',
    sessionId: 'session-1',
    runId: 'run-1',
    stepId: 'step-1',
    modelStepId: 'model-step-1',
    providerId: 'openai',
    modelId: 'gpt-4.1',
    inputContext,
    createdAt: '2026-05-17T00:00:00.000Z',
    ...overrides,
  };
}

function toolCallCreatedEvent(input: {
  eventId: string;
  sequence: number;
  stepId: string;
  modelStepId: string;
}): RuntimeEvent {
  return {
    eventId: input.eventId,
    schemaVersion: 1,
    eventType: 'tool.call.created',
    sessionId: 'session-1',
    runId: 'run-1',
    stepId: input.stepId,
    sequence: input.sequence,
    createdAt: '2026-05-17T00:00:01.000Z',
    source: 'provider',
    visibility: 'system',
    persist: 'required',
      payload: {
      toolCallId: 'call-read',
      modelStepId: input.modelStepId,
      providerToolCallId: 'call-read',
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

function modelStepProviderStateRecordedEvent(input: {
  eventId: string;
  sequence: number;
  stepId: string;
  modelStepId: string;
}): RuntimeEvent {
  return {
    eventId: input.eventId,
    schemaVersion: 1,
    eventType: 'model.step.provider_state.recorded',
    sessionId: 'session-1',
    runId: 'run-1',
    stepId: input.stepId,
    sequence: input.sequence,
    createdAt: '2026-05-17T00:00:01.500Z',
    source: 'provider',
    visibility: 'system',
    persist: 'required',
    payload: {
      modelStepId: input.modelStepId,
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
      blocks: [
        {
          type: 'reasoning_content',
          text: 'I need to inspect docs.',
        },
      ],
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
    toolCallId: 'call-read',
    toolExecutionId: 'tool-execution-1',
    runId: 'run-1',
    kind: 'success',
    structuredContent: { text: '{}' },
    textContent: '{}',
    redactionState: 'none',
    createdAt: '2026-05-17T00:00:02.500Z',
    ...overrides,
  };
}

function createToolExecution(toolCall: ToolCall, overrides: Partial<ToolExecution> = {}): ToolExecution {
  return {
    toolExecutionId: 'tool-execution-1',
    toolCallId: toolCall.toolCallId,
    runId: toolCall.runId,
    stepId: 'step-1',
    toolName: toolCall.toolName,
    input: toolCall.input,
    inputPreview: toolCall.inputPreview,
    capabilities: ['project_read'],
    riskLevel: 'low',
    sideEffect: 'none',
    status: 'awaitingApproval',
    requestedAt: '2026-05-17T00:00:02.250Z',
    ...overrides,
  };
}

function createApprovalRequest(
  toolCall: ToolCall,
  toolExecution: ToolExecution,
  overrides: Partial<ApprovalRequest> = {},
): ApprovalRequest {
  return {
    approvalRequestId: 'approval-1',
    toolCallId: toolCall.toolCallId,
    toolExecutionId: toolExecution.toolExecutionId,
    runId: toolCall.runId,
    stepId: String(toolExecution.stepId),
    toolName: toolCall.toolName,
    capabilities: [...(toolExecution.capabilities ?? ['project_read'])],
    riskLevel: toolExecution.riskLevel ?? 'low',
    title: 'Approve read_file',
    summary: 'User approval is required.',
    preview: {
      action: 'read_file',
      targets: [],
    },
    requestedScope: 'once',
    status: 'pending',
    createdAt: '2026-05-17T00:00:02.300Z',
    ...overrides,
  };
}

describe('run model tool loop', () => {
  it('feeds tool results into the next model step after handling tool calls', async () => {
    const requests: ModelStepRuntimeRequest[] = [];

    const events = await collect(runModelToolLoop({
      request: createRequest(),
      modelStepPort: {
        async *streamModelStep(input) {
          requests.push(input.request);

          if (requests.length === 1) {
            yield toolCallCreatedEvent({
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

          expect(input.request.inputContext.parts).toEqual(expect.arrayContaining([
            expect.objectContaining({
              kind: 'tool_continuation',
              toolResultId: 'tool-result-1',
            }),
          ]));
          yield assistantCompletedEvent({
            eventId: input.eventIdFactory(),
            sequence: input.nextSequence(),
            stepId: input.request.stepId,
          });
        },
      },
      toolCallHandler: {
        async handleToolCalls(input) {
          expect(input.toolCalls).toEqual([
            expect.objectContaining({
              toolCallId: 'call-read',
              modelStepId: 'model-step-1',
              providerToolCallId: 'call-read',
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
    });
    expect(requests[1]?.inputContext.parts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'tool_continuation',
        toolCallId: 'call-read',
        providerToolCallId: 'call-read',
        toolName: 'read_file',
        text: expect.stringContaining('Tool call call-read requested read_file.'),
      }),
      expect.objectContaining({
        kind: 'tool_continuation',
        toolResultId: 'tool-result-1',
        text: expect.stringContaining('Tool result tool-result-1 for call-read'),
      }),
    ]));
    expect(events.map((event) => event.eventType)).toEqual([
      'tool.call.created',
      'model.step.completed',
      'tool.result.created',
      'assistant.output.completed',
    ]);
    expect(events.find((event) => event.eventType === 'tool.result.created')).toMatchObject({
      eventId: 'core-event-4',
      sequence: 3,
      payload: {
        toolResultId: 'tool-result-1',
        toolCallId: 'call-read',
        toolExecutionId: 'tool-execution-1',
        kind: 'success',
        summary: '{}',
      },
    });
    expect(events.at(-1)?.eventType).toBe('assistant.output.completed');
  });

  it('feeds provider state into the next model step after tool handling', async () => {
    const requests: ModelStepRuntimeRequest[] = [];

    await collect(runModelToolLoop({
      request: createRequest({
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
      }),
      modelStepPort: {
        async *streamModelStep(input) {
          requests.push(input.request);

          if (requests.length === 1) {
            yield modelStepProviderStateRecordedEvent({
              eventId: input.eventIdFactory(),
              sequence: input.nextSequence(),
              stepId: input.request.stepId,
              modelStepId: String(input.request.modelStepId),
            });
            yield toolCallCreatedEvent({
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

          yield assistantCompletedEvent({
            eventId: input.eventIdFactory(),
            sequence: input.nextSequence(),
            stepId: input.request.stepId,
          });
        },
      },
      toolCallHandler: {
        async handleToolCalls() {
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
            return `provider-state-event-${next}`;
          };
        })(),
        nextStepId: () => 'step-2',
        nextModelStepId: () => 'model-step-2',
      },
    }));

    expect(requests).toHaveLength(2);
    expect(requests[1]?.inputContext.parts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'tool_continuation',
        modelStepId: 'model-step-1',
        providerStateText: 'I need to inspect docs.',
      }),
    ]));
  });

  it('uses continuation input-context builder before the next model step', async () => {
    const requests: ModelStepRuntimeRequest[] = [];
    let callbackCallCount = 0;
    const events = await collect(runModelToolLoop({
      request: createRequest(),
      modelStepPort: {
        async *streamModelStep({ request }) {
          requests.push(request);
          if (requests.length === 1) {
            yield toolCallCreatedEvent({
              eventId: 'event-tool-call',
              sequence: 1,
              stepId: request.stepId,
              modelStepId: String(request.modelStepId),
            });
            yield modelStepCompletedEvent({
              eventId: 'event-model-step-completed',
              sequence: 2,
              stepId: request.stepId,
              modelStepId: String(request.modelStepId),
            });
            return;
          }
          yield assistantCompletedEvent({
            eventId: 'event-final',
            sequence: 1,
            stepId: request.stepId,
          });
        },
      },
      toolCallHandler: {
        async handleToolCalls() {
          return {
            toolResults: [{
              toolResultId: 'tool-result:1',
              toolCallId: 'call-read',
              toolExecutionId: 'tool-execution-1',
              runId: 'run-1',
              kind: 'success',
              textContent: 'ok',
              redactionState: 'none',
              createdAt: '2026-05-17T00:00:03.000Z',
            }],
          };
        },
      },
      ids: {
        nextEventId: () => `event-${Math.random().toString(36).slice(2)}`,
        nextStepId: () => 'step-2',
        nextModelStepId: () => 'model-step-2',
      },
      buildContinuationInputContext: async (input) => {
        callbackCallCount += 1;
        return buildModelStepInputContextFromSources({
          ...input,
          instructionSources: [{
            sourceId: 'project-instruction:AGENTS.md',
            sourceKind: 'project_instruction',
            status: 'included',
            sourceUri: 'project://AGENTS.md',
            relativePath: 'AGENTS.md',
            text: '# refreshed',
            loadedAt: input.builtAt,
            sizeBytes: 11,
            includedBytes: 11,
            hardCapBytes: 65536,
            truncated: false,
          }],
        });
      },
    }));

    expect(events.length).toBeGreaterThan(0);
    expect(callbackCallCount).toBe(1);
    expect(requests[1]?.inputContext.parts[0]).toMatchObject({
      kind: 'instruction',
      instructionKind: 'project',
      text: expect.stringContaining('# refreshed'),
    });
  });

  it('stops before requesting another model step when tool handling returns pending approvals', async () => {
    const requests: ModelStepRuntimeRequest[] = [];
    const continuations: PendingToolApprovalContinuation[] = [];

    const events = await collect(runModelToolLoop({
      request: createRequest(),
      modelStepPort: {
        async *streamModelStep(input) {
          requests.push(input.request);
          yield toolCallCreatedEvent({
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
      toolCallHandler: {
        async handleToolCalls(input) {
          const toolCall = input.toolCalls[0];
          const toolExecution = createToolExecution(toolCall);
          const pendingApproval: PendingToolApproval = {
            approvalRequest: createApprovalRequest(toolCall, toolExecution),
            toolCall,
            toolExecution,
          };

          return {
            pendingApprovals: [pendingApproval],
            toolResults: [],
          };
        },
      },
      ids: {
        nextEventId: () => 'core-event-approval',
        nextStepId: () => 'step-2',
        nextModelStepId: () => 'model-step-2',
      },
      onPendingApproval: (continuation) => {
        continuations.push(continuation);
      },
    }));

    expect(requests).toHaveLength(1);
    expect(continuations).toEqual([
      expect.objectContaining({
        pendingApproval: expect.objectContaining({
          approvalRequest: expect.objectContaining({
            approvalRequestId: 'approval-1',
          }),
          toolCall: expect.objectContaining({
            toolCallId: 'call-read',
            status: 'created',
          }),
          toolExecution: expect.objectContaining({
            toolExecutionId: 'tool-execution-1',
            toolCallId: 'call-read',
            status: 'awaitingApproval',
          }),
        }),
        request: expect.objectContaining({
          stepId: 'step-1',
          inputContext: expect.objectContaining({
            parts: expect.arrayContaining([
              expect.objectContaining({
                kind: 'tool_continuation',
                toolCallId: 'call-read',
              }),
            ]),
          }),
        }),
        accumulatedToolCalls: [
          expect.objectContaining({
            toolCallId: 'call-read',
            toolName: 'read_file',
          }),
        ],
        accumulatedToolResults: [],
      }),
    ]);
    expect(events.map((event) => event.eventType)).toEqual([
      'tool.call.created',
      'model.step.completed',
    ]);
  });

  it('keeps pending approval continuation context ids within the shared id limit', async () => {
    const continuations: PendingToolApprovalContinuation[] = [];

    await collect(runModelToolLoop({
      request: createRequest({
        requestId: 'request:11111111-2222-4333-8444-555555555555',
        stepId: 'step:11111111-2222-4333-8444-555555555555',
        modelStepId: 'model-step:11111111-2222-4333-8444-555555555555',
      }),
      modelStepPort: {
        async *streamModelStep(input) {
          yield toolCallCreatedEvent({
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
      toolCallHandler: {
        async handleToolCalls(input) {
          const toolCall = input.toolCalls[0];
          const toolExecution = createToolExecution(toolCall);
          return {
            pendingApprovals: [{
              approvalRequest: createApprovalRequest(toolCall, toolExecution),
              toolCall,
              toolExecution,
            }],
            toolResults: [],
          };
        },
      },
      ids: {
        nextEventId: () => 'core-event-approval',
        nextStepId: () => 'step:22222222-2222-4333-8444-555555555555',
        nextModelStepId: () => 'model-step:22222222-2222-4333-8444-555555555555',
      },
      onPendingApproval: (continuation) => {
        continuations.push(continuation);
      },
    }));

    expect(continuations[0]?.request.inputContext?.contextId.length).toBeLessThanOrEqual(128);
    expect(continuations[0]?.request.inputContext?.contextId).toBe(
      'model-input-context:step:11111111-2222-4333-8444-555555555555:approval',
    );
  });

  it('emits completed tool results before stopping for pending approvals', async () => {
    const requests: ModelStepRuntimeRequest[] = [];

    const events = await collect(runModelToolLoop({
      request: createRequest(),
      modelStepPort: {
        async *streamModelStep(input) {
          requests.push(input.request);
          yield toolCallCreatedEvent({
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
      toolCallHandler: {
        async handleToolCalls(input) {
          const toolCall = input.toolCalls[0];
          const toolExecution = createToolExecution(toolCall);
          const pendingApproval: PendingToolApproval = {
            approvalRequest: createApprovalRequest(toolCall, toolExecution),
            toolCall,
            toolExecution,
          };

          return {
            toolResults: [createToolResult()],
            pendingApprovals: [pendingApproval],
          };
        },
      },
      ids: {
        nextEventId: (() => {
          let next = 1;
          return () => {
            next += 1;
            return `mixed-event-${next}`;
          };
        })(),
        nextStepId: () => 'step-2',
        nextModelStepId: () => 'model-step-2',
      },
    }));

    expect(requests).toHaveLength(1);
    expect(events.map((event) => event.eventType)).toEqual([
      'tool.call.created',
      'model.step.completed',
      'tool.result.created',
    ]);
    expect(events.at(-1)).toMatchObject({
      eventType: 'tool.result.created',
      payload: {
        toolResultId: 'tool-result-1',
        toolCallId: 'call-read',
        toolExecutionId: 'tool-execution-1',
      },
    });
  });

  it('yields but ignores malformed tool call events before tool handling', async () => {
    let handleToolCallsCallCount = 0;

    const malformedToolCallEvent: RuntimeEvent = {
      eventId: 'malformed-event-1',
      schemaVersion: 1,
      eventType: 'tool.call.created',
      sessionId: 'session-1',
      runId: 'run-1',
      stepId: 'step-1',
      sequence: 1,
      createdAt: '2026-05-17T00:00:01.000Z',
      source: 'provider',
      visibility: 'system',
      persist: 'required',
      payload: {
        toolCallId: 'call-read',
      },
    };

    const events = await collect(runModelToolLoop({
      request: createRequest(),
      modelStepPort: {
        async *streamModelStep() {
          yield malformedToolCallEvent;
        },
      },
      toolCallHandler: {
        async handleToolCalls() {
          handleToolCallsCallCount += 1;
          return {
            toolResults: [createToolResult()],
          };
        },
      },
      ids: {
        nextEventId: () => 'malformed-loop-event',
        nextStepId: () => 'step-2',
        nextModelStepId: () => 'model-step-2',
      },
    }));

    expect(events).toEqual([malformedToolCallEvent]);
    expect(handleToolCallsCallCount).toBe(0);
  });

  it('continues after an invalid tool call ToolResult instead of failing the run', async () => {
    const requests: ModelStepRuntimeRequest[] = [];
    const events = await collect(runModelToolLoop({
      request: createRequest(),
      modelStepPort: {
        async *streamModelStep(input) {
          requests.push(input.request);
          if (requests.length === 1) {
            yield toolCallCreatedEvent({
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
          yield assistantCompletedEvent({
            eventId: input.eventIdFactory(),
            sequence: input.nextSequence(),
            stepId: input.request.stepId,
          });
        },
      },
      toolCallHandler: {
        async handleToolCalls(input) {
          const toolCall = input.toolCalls[0]!;
          return {
            toolResults: [createToolResult({
              toolResultId: 'tool-result-invalid-tool',
              toolCallId: toolCall.toolCallId,
              kind: 'invalid_tool_call',
              textContent: 'Unknown tool: missing_tool',
            })],
          };
        },
      },
      ids: {
        nextEventId: () => `event-${Math.random().toString(36).slice(2)}`,
        nextStepId: () => `step-${requests.length + 1}`,
        nextModelStepId: () => `model-step-${requests.length + 1}`,
      },
    }));

    expect(requests).toHaveLength(2);
    expect(events.map((event) => event.eventType)).toContain('tool.result.created');
    expect(events.find((event) => event.eventType === 'tool.result.created')).toMatchObject({
      payload: { kind: 'invalid_tool_call' },
    });
    expect(events.map((event) => event.eventType)).toContain('assistant.output.completed');
    expect(events.map((event) => event.eventType)).not.toContain('run.failed');
  });

  it('fails with terminal reason when tool results are empty after tool calls', async () => {
    const events = await collect(runModelToolLoop({
      request: createRequest(),
      modelStepPort: {
        async *streamModelStep(input) {
          yield toolCallCreatedEvent({
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
      toolCallHandler: {
        async handleToolCalls() {
          return { toolResults: [] };
        },
      },
      ids: {
        nextEventId: () => `event-${Math.random().toString(36).slice(2)}`,
        nextStepId: () => 'step-2',
        nextModelStepId: () => 'model-step-2',
      },
    }));

    expect(events.at(-1)).toMatchObject({
      eventType: 'run.failed',
      payload: {
        error: {
          details: {
            reason: 'runtime_invariant_violation',
          },
        },
      },
    });
  });

  it('does not continue to the provider when tool observations are not continuation-ready', async () => {
    const requests: ModelStepRuntimeRequest[] = [];
    const events = await collect(runModelToolLoop({
      request: createRequest(),
      modelStepPort: {
        async *streamModelStep(request) {
          requests.push(request.request);
          if (requests.length === 1) {
            yield toolCallCreatedEvent({
              eventId: 'event-tool-call',
              sequence: 1,
              stepId: String(request.request.stepId),
              modelStepId: String(request.request.modelStepId),
            });
            yield modelStepCompletedEvent({
              eventId: 'event-model-completed',
              sequence: 2,
              stepId: String(request.request.stepId),
              modelStepId: String(request.request.modelStepId),
            });
          }
        },
      },
      toolCallHandler: {
        async handleToolCalls(input) {
          return {
            assistantMessageId: String(input.request.modelStepId),
            toolResults: [createToolResult({
              observationId: 'observation:call-read',
              metadata: { callOrder: 0 },
            })],
            pendingApprovals: [],
            continuationReady: false,
          };
        },
      },
      ids: {
        nextEventId: () => `event-${Math.random().toString(36).slice(2)}`,
        nextStepId: () => 'step-continuation',
        nextModelStepId: () => 'model-step-continuation',
      },
    }));

    expect(requests).toHaveLength(1);
    expect(events.map((event) => event.eventType)).toContain('tool.result.created');
    expect(events.map((event) => event.eventType)).not.toContain('run.continued');
  });

  it('preserves tool result ordering for multiple tool calls in the conservative 19.01 path', async () => {
    const events = await collect(runModelToolLoop({
      request: createRequest(),
      modelStepPort: {
        async *streamModelStep(input) {
          yield toolCallCreatedEvent({
            eventId: input.eventIdFactory(),
            sequence: input.nextSequence(),
            stepId: input.request.stepId,
            modelStepId: String(input.request.modelStepId),
          });
          yield {
            ...toolCallCreatedEvent({
              eventId: input.eventIdFactory(),
              sequence: input.nextSequence(),
              stepId: input.request.stepId,
              modelStepId: String(input.request.modelStepId),
            }),
            payload: {
              toolCallId: 'call-read-2',
              modelStepId: String(input.request.modelStepId),
              providerToolCallId: 'provider-call-read-2',
              toolName: 'read_file',
              input: { path: 'README.md' },
            },
          };
          yield modelStepCompletedEvent({
            eventId: input.eventIdFactory(),
            sequence: input.nextSequence(),
            stepId: input.request.stepId,
            modelStepId: String(input.request.modelStepId),
          });
        },
      },
      toolCallHandler: {
        async handleToolCalls(input) {
          return {
            toolResults: input.toolCalls.map((toolCall, index) => createToolResult({
              toolResultId: `tool-result-${index + 1}`,
              toolCallId: toolCall.toolCallId,
              textContent: `result-${index + 1}`,
            })),
          };
        },
      },
      ids: {
        nextEventId: () => `event-${Math.random().toString(36).slice(2)}`,
        nextStepId: () => 'step-2',
        nextModelStepId: () => 'model-step-2',
      },
      maxModelSteps: 1,
    }));

    expect(events
      .filter((event) => event.eventType === 'tool.result.created')
      .map((event) => (event.payload as { toolResultId: string }).toolResultId)).toEqual([
      'tool-result-1',
      'tool-result-2',
    ]);
  });

  it('emits run failed instead of throwing when model step limit is exhausted', async () => {
    const events = await collect(runModelToolLoop({
      request: createRequest(),
      maxModelSteps: 1,
      modelStepPort: {
        async *streamModelStep(input) {
          yield toolCallCreatedEvent({
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
      toolCallHandler: {
        async handleToolCalls() {
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
            return `loop-event-${next}`;
          };
        })(),
        nextStepId: () => 'step-2',
        nextModelStepId: () => 'model-step-2',
      },
    }));

    expect(events.map((event) => event.eventType)).toEqual([
      'tool.call.created',
      'model.step.completed',
      'tool.result.created',
      'run.failed',
    ]);
    expect(events.at(-1)).toMatchObject({
      eventType: 'run.failed',
      sessionId: 'session-1',
      sequence: 4,
      payload: {
        error: {
          code: 'runtime_protocol_violation',
          message: 'Model tool loop exceeded maxModelSteps (1).',
          retryable: false,
          source: 'core',
          details: {
            reason: 'loop_limit_exceeded',
            maxModelSteps: 1,
          },
        },
      },
    });
  });
});


