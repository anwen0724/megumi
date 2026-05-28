// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildModelStepInputContextFromSources } from '@megumi/context-management/model-step-input-context';
import type { ModelStepRuntimeRequest } from '@megumi/shared/model-step-contracts';
import type { RuntimeEvent } from '@megumi/shared/runtime-events';
import type { ApprovalRequest, ToolCall, ToolResult, ToolUse } from '@megumi/shared/tool-contracts';
import { runModelToolLoop } from '@megumi/core/run-runtime/tool-loop';
import type {
  PendingToolApproval,
  PendingToolApprovalContinuation,
} from '@megumi/core/run-runtime/tool-loop';

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

function createToolCall(toolUse: ToolUse, overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    toolCallId: 'tool-call-1',
    toolUseId: toolUse.toolUseId,
    runId: toolUse.runId,
    stepId: 'step-1',
    toolName: toolUse.toolName,
    input: toolUse.input,
    inputPreview: toolUse.inputPreview,
    capabilities: ['project_read'],
    riskLevel: 'low',
    sideEffect: 'none',
    status: 'waiting_for_approval',
    requestedAt: '2026-05-17T00:00:02.250Z',
    ...overrides,
  };
}

function createApprovalRequest(
  toolUse: ToolUse,
  toolCall: ToolCall,
  overrides: Partial<ApprovalRequest> = {},
): ApprovalRequest {
  return {
    approvalRequestId: 'approval-1',
    toolUseId: toolUse.toolUseId,
    toolCallId: toolCall.toolCallId,
    runId: toolUse.runId,
    stepId: String(toolCall.stepId),
    toolName: toolUse.toolName,
    capabilities: toolCall.capabilities,
    riskLevel: toolCall.riskLevel,
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
  it('feeds tool results into the next model step after handling tool uses', async () => {
    const requests: ModelStepRuntimeRequest[] = [];

    const events = await collect(runModelToolLoop({
      request: createRequest(),
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
    });
    expect(requests[1]?.inputContext.parts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'tool_continuation',
        toolUseId: 'call-read',
        providerToolUseId: 'call-read',
        toolName: 'read_file',
        text: expect.stringContaining('Tool use call-read requested read_file.'),
      }),
      expect.objectContaining({
        kind: 'tool_continuation',
        toolResultId: 'tool-result-1',
        text: expect.stringContaining('Tool result tool-result-1 for call-read'),
      }),
    ]));
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

  it('feeds provider state into the next model step after tool handling', async () => {
    const requests: ModelStepRuntimeRequest[] = [];

    await collect(runModelToolLoop({
      request: createRequest({
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
      }),
      aiPort: {
        async *streamModelStep(input) {
          requests.push(input.request);

          if (requests.length === 1) {
            yield modelStepProviderStateRecordedEvent({
              eventId: input.eventIdFactory(),
              sequence: input.nextSequence(),
              stepId: input.request.stepId,
              modelStepId: String(input.request.modelStepId),
            });
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

          yield assistantCompletedEvent({
            eventId: input.eventIdFactory(),
            sequence: input.nextSequence(),
            stepId: input.request.stepId,
          });
        },
      },
      toolUseHandler: {
        async handleToolUses() {
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
      aiPort: {
        async *streamModelStep({ request }) {
          requests.push(request);
          if (requests.length === 1) {
            yield toolUseCreatedEvent({
              eventId: 'event-tool-use',
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
      toolUseHandler: {
        async handleToolUses() {
          return {
            toolResults: [{
              toolResultId: 'tool-result:1',
              toolUseId: 'call-read',
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
          const toolCall = createToolCall(input.toolUses[0]);
          const pendingApproval: PendingToolApproval = {
            approvalRequest: createApprovalRequest(input.toolUses[0], toolCall),
            toolUse: input.toolUses[0],
            toolCall,
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
            toolCallId: 'tool-call-1',
            status: 'waiting_for_approval',
          }),
        }),
        request: expect.objectContaining({
          stepId: 'step-1',
          inputContext: expect.objectContaining({
            parts: expect.arrayContaining([
              expect.objectContaining({
                kind: 'tool_continuation',
                toolUseId: 'call-read',
              }),
            ]),
          }),
        }),
        accumulatedToolUses: [
          expect.objectContaining({
            toolUseId: 'call-read',
            toolName: 'read_file',
          }),
        ],
        accumulatedToolResults: [],
      }),
    ]);
    expect(events.map((event) => event.eventType)).toEqual([
      'tool.use.created',
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
      aiPort: {
        async *streamModelStep(input) {
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
          const toolCall = createToolCall(input.toolUses[0]);
          return {
            pendingApprovals: [{
              approvalRequest: createApprovalRequest(input.toolUses[0], toolCall),
              toolUse: input.toolUses[0],
              toolCall,
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
          const toolCall = createToolCall(input.toolUses[0]);
          const pendingApproval: PendingToolApproval = {
            approvalRequest: createApprovalRequest(input.toolUses[0], toolCall),
            toolUse: input.toolUses[0],
            toolCall,
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
      'tool.use.created',
      'model.step.completed',
      'tool.result.created',
    ]);
    expect(events.at(-1)).toMatchObject({
      eventType: 'tool.result.created',
      payload: {
        toolResultId: 'tool-result-1',
        toolUseId: 'call-read',
      },
    });
  });

  it('yields but ignores malformed tool use events before tool handling', async () => {
    let handleToolUsesCallCount = 0;

    const malformedToolUseEvent: RuntimeEvent = {
      eventId: 'malformed-event-1',
      schemaVersion: 1,
      eventType: 'tool.use.created',
      sessionId: 'session-1',
      runId: 'run-1',
      stepId: 'step-1',
      sequence: 1,
      createdAt: '2026-05-17T00:00:01.000Z',
      source: 'provider',
      visibility: 'system',
      persist: 'required',
      payload: {
        toolUseId: 'call-read',
      },
    };

    const events = await collect(runModelToolLoop({
      request: createRequest(),
      aiPort: {
        async *streamModelStep() {
          yield malformedToolUseEvent;
        },
      },
      toolUseHandler: {
        async handleToolUses() {
          handleToolUsesCallCount += 1;
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

    expect(events).toEqual([malformedToolUseEvent]);
    expect(handleToolUsesCallCount).toBe(0);
  });

  it('emits run failed instead of throwing when model step limit is exhausted', async () => {
    const events = await collect(runModelToolLoop({
      request: createRequest(),
      maxModelSteps: 1,
      aiPort: {
        async *streamModelStep(input) {
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
        async handleToolUses() {
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
      'tool.use.created',
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
            reason: 'runtime_loop_limit_exceeded',
            maxModelSteps: 1,
          },
        },
      },
    });
  });
});
