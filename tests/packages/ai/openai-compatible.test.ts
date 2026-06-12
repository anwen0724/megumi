// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { buildModelInputContext } from '@megumi/context-management';
import type { ModelInputContextPart, ModelInputContextSourceRef } from '@megumi/shared/model';
import { RuntimeEventSchema } from '@megumi/shared/runtime';
import type { ToolCall, ToolResult } from '@megumi/shared/tool';
import { createOpenAICompatibleAdapter } from '@megumi/ai/providers/openai-compatible';
import type { AiModelStepAdapterRequest, FetchLike, ProviderRuntimeConfig } from '@megumi/ai/types';

const builtAt = '2026-05-27T00:00:00.000Z';

interface ModelStepRequestOverrides extends Partial<AiModelStepAdapterRequest['request']> {
  messageText?: string;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
}

function sourceRef(sourceId: string, sourceKind: ModelInputContextSourceRef['sourceKind']): ModelInputContextSourceRef {
  return {
    sourceId,
    sourceKind,
  };
}

function instructionPart(
  overrides: Partial<Extract<ModelInputContextPart, { kind: 'instruction' }>>,
): ModelInputContextPart {
  return {
    partId: 'part:instruction:1',
    kind: 'instruction',
    instructionKind: 'system',
    text: 'System instruction from ModelInputContext.',
    sourceRefs: [sourceRef('system:1', 'system_instruction')],
    priority: 100,
    budgetStatus: 'included_full',
    ...overrides,
  };
}

function currentTurnPart(
  overrides: Partial<Extract<ModelInputContextPart, { kind: 'current_turn' }>> = {},
): ModelInputContextPart {
  return {
    partId: 'part:current-turn:1',
    kind: 'current_turn',
    role: 'user',
    text: 'Hello from input context.',
    sourceRefs: [sourceRef('message:input-context', 'current_user_message')],
    priority: 90,
    budgetStatus: 'included_full',
    ...overrides,
  };
}

function modelStepInputContext(request: ModelStepRequestOverrides & {
  sessionId: string;
  runId: string;
  stepId: string;
  createdAt: string;
}) {
  return buildModelInputContext({
    contextId: `model-input-context:${request.stepId}`,
    sessionId: request.sessionId,
    runId: request.runId,
    stepId: request.stepId,
    buildReason: request.toolResults && request.toolResults.length > 0
      ? 'tool_continuation'
      : 'initial_model_step',
    builtAt: request.createdAt,
    parts: [
      instructionPart({
        partId: `part:instruction:${request.stepId}`,
      }),
      currentTurnPart({
        partId: `part:current-turn:${request.stepId}`,
        text: request.messageText ?? 'Read package.json',
        sourceRefs: [sourceRef(`message:${request.stepId}`, 'current_user_message')],
      }),
      ...toolContinuationParts(request.toolCalls ?? [], request.toolResults ?? []),
    ],
  });
}

function toolContinuationParts(toolCalls: ToolCall[], toolResults: ToolResult[]): ModelInputContextPart[] {
  return [
    ...toolCalls.map((toolCall, index): ModelInputContextPart => ({
      partId: `part:tool-call:${index + 1}:${toolCall.toolCallId}`,
      kind: 'tool_continuation',
      text: `Tool call ${toolCall.toolCallId} requested ${toolCall.toolName}.`,
      toolCallId: String(toolCall.toolCallId),
      providerToolCallId: toolCall.providerToolCallId,
      modelStepId: String(toolCall.modelStepId),
      toolName: toolCall.toolName,
      toolInput: toolCall.input,
      sourceRefs: [sourceRef(`tool-call:${toolCall.toolCallId}`, 'tool_call')],
      priority: 80,
      budgetStatus: 'included_full',
    })),
    ...toolResults.map((toolResult, index): ModelInputContextPart => ({
      partId: `part:tool-result:${index + 1}:${toolResult.toolResultId}`,
      kind: 'tool_continuation',
      text: `Tool result ${toolResult.toolResultId} for ${toolResult.toolCallId}.`,
      toolCallId: String(toolResult.toolCallId),
      ...(toolResult.toolExecutionId ? { toolExecutionId: String(toolResult.toolExecutionId) } : {}),
      toolResultId: String(toolResult.toolResultId),
      toolResultContent: toolResultContent(toolResult),
      sourceRefs: [sourceRef(`tool-result:${toolResult.toolResultId}`, 'tool_result')],
      priority: 85,
      budgetStatus: 'included_full',
    })),
  ];
}

function toolResultContent(toolResult: ToolResult): string {
  return toolResult.textContent ?? JSON.stringify({
    kind: toolResult.kind,
    ...(toolResult.structuredContent !== undefined ? { structuredContent: toolResult.structuredContent } : {}),
    ...(toolResult.denialReason ? { denialReason: toolResult.denialReason } : {}),
    ...(toolResult.error ? { error: toolResult.error } : {}),
  });
}

const config: ProviderRuntimeConfig = {
  providerId: 'openai',
  kind: 'openai-compatible',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: 'sk-test',
  defaultModelId: 'gpt-4.1',
};

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream',
    },
  });
}

async function collect<T>(events: AsyncIterable<T>): Promise<T[]> {
  const output: T[] = [];
  for await (const event of events) {
    output.push(event);
  }
  return output;
}

describe('OpenAI-compatible adapter', () => {
  function modelStepInput(overrides: ModelStepRequestOverrides = {}): AiModelStepAdapterRequest {
    let sequence = 0;
    const request = {
      requestId: 'request-1',
      sessionId: 'session-1',
      runId: 'run-1',
      stepId: 'step-1',
      providerId: 'openai' as const,
      modelId: 'gpt-4.1',
      messageText: 'Read package.json',
      createdAt: '2026-05-17T00:00:00.000Z',
      ...overrides,
    };

    const { messageText: _messageText, toolCalls: _toolCalls, toolResults: _toolResults, ...runtimeRequest } = request;

    return {
      request: {
        ...runtimeRequest,
        inputContext: request.inputContext ?? modelStepInputContext(request),
      },
      runId: 'run-1',
      stepId: 'step-1',
      config,
      nextSequence: () => {
        sequence += 1;
        return sequence;
      },
      eventIdFactory: () => `event-${sequence + 1}`,
    };
  }

  it('streams model step requests as the primary provider path', async () => {
    const inputContext = buildModelInputContext({
      contextId: 'model-input-context:1',
      sessionId: 'session-1',
      runId: 'run-1',
      stepId: 'step-1',
      buildReason: 'initial_model_step',
      builtAt,
      parts: [
        instructionPart({
          partId: 'part:instruction:1',
          sourceRefs: [sourceRef('system:1', 'system_instruction')],
        }),
        currentTurnPart({
          partId: 'part:current-turn:1',
          sourceRefs: [sourceRef('message:1', 'current_user_message')],
        }),
      ],
    });
    const fetch = vi.fn<FetchLike>().mockResolvedValue(sseResponse([
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"lo"}}],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}\n\n',
      'data: [DONE]\n\n',
    ]));
    const adapter = createOpenAICompatibleAdapter({
      providerId: 'openai',
      defaultBaseUrl: 'https://api.openai.com/v1',
      fetch,
      clock: { now: () => '2026-05-17T00:00:01.000Z' },
    });
    let sequence = 0;

    const events = await collect(adapter.streamModelStep({
      request: {
        requestId: 'request-1',
        sessionId: 'session-1',
        runId: 'run-1',
        stepId: 'step-1',
        providerId: 'openai',
        modelId: 'gpt-4.1',
        inputContext,
        createdAt: '2026-05-17T00:00:00.000Z',
      },
      runId: 'run-1',
      stepId: 'step-1',
      config,
      nextSequence: () => {
        sequence += 1;
        return sequence;
      },
      eventIdFactory: () => `event-${sequence + 1}`,
    }));

    const [, init] = fetch.mock.calls[0];
    expect(JSON.parse(String(init?.body)).messages).toEqual([
      {
        role: 'system',
        content: 'System instruction from ModelInputContext.',
      },
      {
        role: 'user',
        content: 'Hello from input context.',
      },
    ]);
    expect(String(init?.body)).not.toContain('Legacy');

    expect(events.map((event) => event.eventType)).toEqual([
      'model.step.started',
      'model.output.delta',
      'model.output.delta',
      'model.step.completed',
    ]);
    expect(events.every((event) => event.stepId === 'step-1')).toBe(true);
    expect(events[1]).toMatchObject({
      eventType: 'model.output.delta',
      payload: {
        modelStepId: 'step-1',
        delta: 'Hel',
      },
    });
    expect(events[3]).toMatchObject({
      eventType: 'model.step.completed',
      payload: {
        modelStepId: 'step-1',
      },
    });
  });

  it('streams model step tool calls as tool call created events', async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue(sseResponse([
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-read","type":"function","function":{"name":"read_file","arguments":"{\\"path\\":"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"package.json\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n',
    ]));
    const adapter = createOpenAICompatibleAdapter({
      providerId: 'openai',
      defaultBaseUrl: 'https://api.openai.com/v1',
      fetch,
      clock: { now: () => '2026-05-17T00:00:01.000Z' },
    });
    let sequence = 0;

    const events = await collect(adapter.streamModelStep({
      request: {
        requestId: 'request-1',
        sessionId: 'session-1',
        runId: 'run-1',
        stepId: 'step-1',
        modelStepId: 'model-step-1',
        providerId: 'openai',
        modelId: 'gpt-4.1',
        inputContext: buildModelInputContext({
          contextId: 'model-input-context:tool-call-stream',
          sessionId: 'session-1',
          runId: 'run-1',
          stepId: 'step-1',
          buildReason: 'initial_model_step',
          builtAt: '2026-05-17T00:00:00.000Z',
          parts: [
            instructionPart({
              partId: 'part:instruction:tool-call-stream',
            }),
            currentTurnPart({
              partId: 'part:current-turn:tool-call-stream',
              text: 'Read package.json',
              sourceRefs: [sourceRef('message:tool-call-stream', 'current_user_message')],
            }),
          ],
        }),
        toolDefinitions: [
          {
            name: 'read_file',
            description: 'Read a project file.',
            inputSchema: {
              type: 'object',
              properties: {
                path: { type: 'string' },
              },
              required: ['path'],
              additionalProperties: false,
            },
            capabilities: ['project_read'],
            riskLevel: 'low',
            sideEffect: 'none',
            availability: { status: 'available' },
          },
        ],
        createdAt: '2026-05-17T00:00:00.000Z',
      },
      runId: 'run-1',
      stepId: 'step-1',
      config,
      nextSequence: () => {
        sequence += 1;
        return sequence;
      },
      eventIdFactory: () => `event-${sequence + 1}`,
    }));

    const [, init] = fetch.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toEqual(expect.objectContaining({
      tools: [
        {
          type: 'function',
          function: {
            name: 'read_file',
            description: 'Read a project file.',
            parameters: {
              type: 'object',
              properties: {
                path: { type: 'string' },
              },
              required: ['path'],
              additionalProperties: false,
            },
          },
        },
      ],
      tool_choice: 'auto',
    }));

    expect(events.map((event) => event.eventType)).toEqual([
      'model.step.started',
      'model.tool_call.detected',
      'tool.call.created',
      'model.step.completed',
    ]);
    expect(events.map((event) => event.sequence)).toEqual([1, 2, 3, 4]);
    expect(events.map((event) => RuntimeEventSchema.parse(event))).toEqual(events);
    expect(events[1]).toMatchObject({
      eventType: 'model.tool_call.detected',
      payload: {
        modelStepId: 'model-step-1',
        toolCallId: 'call-read',
        providerToolCallId: 'call-read',
        toolName: 'read_file',
      },
    });
    expect(events[2]).toMatchObject({
      eventType: 'tool.call.created',
      stepId: 'step-1',
      payload: {
        toolCallId: 'call-read',
        modelStepId: 'model-step-1',
        providerToolCallId: 'call-read',
        toolName: 'read_file',
        input: { path: 'package.json' },
      },
    });
    expect(events[3]).toMatchObject({
      eventType: 'model.step.completed',
      payload: {
        modelStepId: 'model-step-1',
        finishReason: 'tool_calls',
      },
    });
  });

  it('detects tool call before the completed tool call event', async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue(sseResponse([
      'data: {"choices":[{"delta":{"content":"I will check."}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-read","type":"function","function":{"name":"read_file","arguments":"{\\"path\\":"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"package.json\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n',
    ]));
    const adapter = createOpenAICompatibleAdapter({
      providerId: 'openai',
      defaultBaseUrl: 'https://api.openai.com/v1',
      fetch,
      clock: { now: () => '2026-05-24T00:00:00.000Z' },
    });

    const events = await collect(adapter.streamModelStep(modelStepInput({
      modelStepId: 'model-step-1',
      toolDefinitions: [
        {
          name: 'read_file',
          description: 'Read a project file.',
          inputSchema: {
            type: 'object',
            properties: { path: { type: 'string' } },
            required: ['path'],
            additionalProperties: false,
          },
          capabilities: ['project_read'],
          riskLevel: 'low',
          sideEffect: 'none',
          availability: { status: 'available' },
        },
      ],
    })));

    expect(events.map((event) => event.eventType)).toEqual([
      'model.step.started',
      'model.output.delta',
      'model.tool_call.detected',
      'tool.call.created',
      'model.step.completed',
    ]);
    expect(events.findIndex((event) => event.eventType === 'model.tool_call.detected'))
      .toBeLessThan(events.findIndex((event) => event.eventType === 'tool.call.created'));
  });

  it('keeps one thinking lifecycle when reasoning continues after tool detection', async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue(sseResponse([
      'data: {"choices":[{"delta":{"reasoning_content":"I need to inspect docs."}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"I will check."}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-list","type":"function","function":{"name":"list_directory","arguments":"{\\"path\\":"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"reasoning_content":"Then I will summarize."}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"docs\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n',
    ]));
    const adapter = createOpenAICompatibleAdapter({
      providerId: 'deepseek',
      defaultBaseUrl: 'https://api.deepseek.com',
      fetch,
      clock: { now: () => '2026-05-24T00:00:00.000Z' },
    });

    const events = await collect(adapter.streamModelStep({
      ...modelStepInput({
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        modelStepId: 'model-step-1',
        toolDefinitions: [
          {
            name: 'list_directory',
            description: 'List a project directory.',
            inputSchema: {
              type: 'object',
              properties: { path: { type: 'string' } },
              required: ['path'],
              additionalProperties: false,
            },
            capabilities: ['project_read'],
            riskLevel: 'low',
            sideEffect: 'none',
            availability: { status: 'available' },
          },
        ],
      }),
      config: {
        providerId: 'deepseek',
        kind: 'openai-compatible',
        baseUrl: 'https://api.deepseek.com',
        apiKey: 'sk-test',
        defaultModelId: 'deepseek-v4-flash',
      },
    }));

    expect(events.map((event) => event.eventType)).toEqual([
      'model.step.started',
      'model.thinking.started',
      'model.thinking.delta',
      'model.output.delta',
      'model.tool_call.detected',
      'model.thinking.delta',
      'model.thinking.completed',
      'model.step.provider_state.recorded',
      'tool.call.created',
      'model.step.completed',
    ]);
    expect(events.filter((event) => event.eventType === 'model.thinking.started')).toHaveLength(1);
    expect(events.filter((event) => event.eventType === 'model.thinking.completed')).toHaveLength(1);
    expect(events[3]).toMatchObject({
      eventType: 'model.output.delta',
      payload: {
        delta: 'I will check.',
      },
    });
    expect(events[4]).toMatchObject({
      eventType: 'model.tool_call.detected',
      payload: {
        toolCallId: 'call-list',
        toolName: 'list_directory',
      },
    });
    expect(events[5]).toMatchObject({
      eventType: 'model.thinking.delta',
      payload: {
        delta: 'Then I will summarize.',
      },
    });
    const eventTypes = events.map((event) => event.eventType);
    expect(eventTypes.indexOf('model.thinking.completed'))
      .toBeGreaterThan(eventTypes.lastIndexOf('model.thinking.delta'));
    expect(eventTypes.indexOf('model.tool_call.detected'))
      .toBeLessThan(eventTypes.indexOf('model.thinking.completed'));
    expect(eventTypes.indexOf('model.thinking.completed'))
      .toBeLessThan(events.findIndex((event) => event.eventType === 'model.step.provider_state.recorded'));
    expect(eventTypes.indexOf('model.tool_call.detected'))
      .toBeLessThan(eventTypes.indexOf('tool.call.created'));
  });

  it('records provider reasoning state without exposing it as visible model output', async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue(sseResponse([
      'data: {"choices":[{"delta":{"reasoning_content":"I need to inspect docs."}}]}\n\n',
      'data: {"choices":[{"delta":{"content":null}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-list","type":"function","function":{"name":"list_directory","arguments":"{\\"path\\":"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"docs\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n',
    ]));
    const adapter = createOpenAICompatibleAdapter({
      providerId: 'deepseek',
      defaultBaseUrl: 'https://api.deepseek.com',
      fetch,
      clock: { now: () => '2026-05-17T00:00:01.000Z' },
    });

    const events = await collect(adapter.streamModelStep({
      ...modelStepInput({
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        modelStepId: 'model-step-1',
        toolDefinitions: [
          {
            name: 'list_directory',
            description: 'List a project directory.',
            inputSchema: {
              type: 'object',
              properties: { path: { type: 'string' } },
              required: ['path'],
              additionalProperties: false,
            },
            capabilities: ['project_read'],
            riskLevel: 'low',
            sideEffect: 'none',
            availability: { status: 'available' },
          },
        ],
      }),
      config: {
        providerId: 'deepseek',
        kind: 'openai-compatible',
        baseUrl: 'https://api.deepseek.com',
        apiKey: 'sk-test',
        defaultModelId: 'deepseek-v4-flash',
      },
    }));

    expect(events.map((event) => event.eventType)).toEqual([
      'model.step.started',
      'model.thinking.started',
      'model.thinking.delta',
      'model.tool_call.detected',
      'model.thinking.completed',
      'model.step.provider_state.recorded',
      'tool.call.created',
      'model.step.completed',
    ]);
    expect(events.map((event) => RuntimeEventSchema.parse(event))).toEqual(events);
    expect(events).not.toContainEqual(expect.objectContaining({
      eventType: 'model.output.delta',
    }));
    expect(events[1]).toMatchObject({
      eventType: 'model.thinking.started',
      payload: {
        modelStepId: 'model-step-1',
      },
    });
    expect(events[2]).toMatchObject({
      eventType: 'model.thinking.delta',
      payload: {
        modelStepId: 'model-step-1',
        delta: 'I need to inspect docs.',
      },
    });
    expect(events[3]).toMatchObject({
      eventType: 'model.tool_call.detected',
      payload: {
        modelStepId: 'model-step-1',
        toolCallId: 'call-list',
        providerToolCallId: 'call-list',
        toolName: 'list_directory',
      },
    });
    expect(events[4]).toMatchObject({
      eventType: 'model.thinking.completed',
      payload: {
        modelStepId: 'model-step-1',
      },
    });
    expect(events[5]).toMatchObject({
      eventType: 'model.step.provider_state.recorded',
      source: 'provider',
      visibility: 'system',
      persist: 'required',
      payload: {
        modelStepId: 'model-step-1',
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        blocks: [
          {
            type: 'reasoning_content',
            text: 'I need to inspect docs.',
          },
        ],
      },
    });
    expect(events[6]).toMatchObject({
      eventType: 'tool.call.created',
      payload: {
        toolName: 'list_directory',
        input: { path: 'docs' },
      },
    });
  });

  it('blocks provider fetch when request materialization has no required input subject', async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue(sseResponse([
      'data: {"choices":[{"delta":{"content":"should not run"}}]}\n\n',
      'data: [DONE]\n\n',
    ]));
    const adapter = createOpenAICompatibleAdapter({
      providerId: 'openai',
      defaultBaseUrl: 'https://api.openai.com/v1',
      fetch,
      clock: { now: () => '2026-05-17T00:00:01.000Z' },
    });
    const inputContext = buildModelInputContext({
      contextId: 'model-input-context:adapter-missing-subject',
      sessionId: 'session-1',
      runId: 'run-1',
      stepId: 'step-1',
      buildReason: 'initial_model_step',
      builtAt,
      parts: [
        instructionPart({
          partId: 'part:instruction:adapter-missing-subject',
          text: 'System instruction without a model step subject.',
        }),
      ],
    });

    const [event] = await collect(adapter.streamModelStep(modelStepInput({
      inputContext,
    })));

    expect(fetch).not.toHaveBeenCalled();
    expect(event).toMatchObject({
      eventType: 'run.failed',
      requestId: 'request-1',
      runId: 'run-1',
      sequence: 1,
      payload: {
        error: {
          code: 'runtime_protocol_violation',
          message: 'Provider request materialization failed.',
          retryable: false,
          source: 'provider',
          details: {
            providerId: 'openai',
            modelId: 'gpt-4.1',
            boundary: 'provider',
            operation: 'chat_completions_stream',
            failureStage: 'materialization',
            materializationCode: 'model_input_subject_missing',
            contextId: 'model-input-context:adapter-missing-subject',
            buildReason: 'initial_model_step',
          },
        },
      },
    });
    expect(RuntimeEventSchema.parse(event)).toEqual(event);
    expect(JSON.stringify(event)).not.toContain('System instruction without a model step subject.');
  });

  it('maps model step auth failures to typed failed events', async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue(new Response('bad key', { status: 401 }));
    const adapter = createOpenAICompatibleAdapter({
      providerId: 'openai',
      defaultBaseUrl: 'https://api.openai.com/v1',
      fetch,
      clock: { now: () => '2026-05-17T00:00:01.000Z' },
    });

    const [event] = await collect(adapter.streamModelStep(modelStepInput()));

    expect(event).toMatchObject({
      eventType: 'run.failed',
      requestId: 'request-1',
      runId: 'run-1',
      sequence: 1,
      payload: {
        error: {
          code: 'provider_auth_failed',
          retryable: false,
          source: 'provider',
        },
      },
    });
  });

  it('maps aborted model step requests to cancelled events using the request ref', async () => {
    const fetch = vi.fn<FetchLike>().mockRejectedValue(new DOMException('aborted', 'AbortError'));
    const adapter = createOpenAICompatibleAdapter({
      providerId: 'openai',
      defaultBaseUrl: 'https://api.openai.com/v1',
      fetch,
      clock: { now: () => '2026-05-17T00:00:01.000Z' },
    });

    const [event] = await collect(adapter.streamModelStep(modelStepInput()));

    expect(event).toMatchObject({
      eventType: 'run.cancelled',
      requestId: 'request-1',
      sessionId: 'session-1',
      runId: 'run-1',
      sequence: 1,
      payload: {
        reason: 'Provider request was cancelled.',
      },
    });
    expect(RuntimeEventSchema.parse(event)).toEqual(event);
  });

  it('records provider HTTP diagnostics for failed tool continuation model steps', async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue(new Response(
      '{"error":{"message":"tool message rejected","debug":"sk-provider-secret-12345678"}}',
      { status: 400, statusText: 'Bad Request' },
    ));
    const adapter = createOpenAICompatibleAdapter({
      providerId: 'openai',
      defaultBaseUrl: 'https://api.openai.com/v1',
      fetch,
      clock: { now: () => '2026-05-17T00:00:01.000Z' },
    });

    const [event] = await collect(adapter.streamModelStep(modelStepInput({
      toolDefinitions: [
        {
          name: 'read_file',
          description: 'Read a project file.',
          inputSchema: {
            type: 'object',
            properties: { path: { type: 'string' } },
            required: ['path'],
            additionalProperties: false,
          },
          capabilities: ['project_read'],
          riskLevel: 'low',
          sideEffect: 'none',
          availability: { status: 'available' },
        },
      ],
      toolCalls: [
        {
          toolCallId: 'tool-call-1',
          runId: 'run-1',
          modelStepId: 'step-1',
          providerToolCallId: 'tool-call-1',
          toolName: 'read_file',
          input: { path: 'package.json' },
          inputPreview: {
            summary: 'read_file',
            targets: [],
            redactionState: 'none',
          },
          status: 'created',
          createdAt: '2026-05-17T00:00:01.000Z',
        },
      ],
      toolResults: [
        {
          toolResultId: 'tool-result-1',
          toolCallId: 'tool-call-1',
          toolExecutionId: 'tool-execution-1',
          runId: 'run-1',
          kind: 'success',
          textContent: 'File contents',
          redactionState: 'none',
          createdAt: '2026-05-17T00:00:02.000Z',
        },
      ],
    })));

    expect(event).toMatchObject({
      eventType: 'run.failed',
      payload: {
        error: {
          code: 'provider_invalid_request',
          message: 'Provider rejected the request.',
          details: {
            providerId: 'openai',
            modelId: 'gpt-4.1',
            boundary: 'provider',
            operation: 'chat_completions_stream',
            failureStage: 'http_error',
            httpStatus: 400,
            httpStatusText: 'Bad Request',
            providerErrorBodyPreview: expect.stringContaining('tool message rejected'),
            requestShape: 'tool_continuation',
            messageRoles: ['system', 'user', 'assistant', 'tool'],
            toolDefinitionCount: 1,
            toolCallCount: 1,
            toolResultCount: 1,
          },
        },
      },
    });
    expect(JSON.stringify(event)).not.toContain('sk-provider-secret-12345678');
  });

  it('records fetch throw diagnostics without exposing raw causes', async () => {
    const fetch = vi.fn<FetchLike>().mockRejectedValue(new TypeError('connect failed with sk-provider-secret-12345678'));
    const adapter = createOpenAICompatibleAdapter({
      providerId: 'openai',
      defaultBaseUrl: 'https://api.openai.com/v1',
      fetch,
      clock: { now: () => '2026-05-17T00:00:01.000Z' },
    });

    const [event] = await collect(adapter.streamModelStep(modelStepInput()));

    expect(event).toMatchObject({
      eventType: 'run.failed',
      payload: {
        error: {
          code: 'provider_network_error',
          details: {
            providerId: 'openai',
            modelId: 'gpt-4.1',
            boundary: 'provider',
            operation: 'chat_completions_stream',
            failureStage: 'fetch_throw',
            errorName: 'TypeError',
            errorMessage: 'connect failed with [redacted]',
            requestShape: 'initial',
            messageRoles: ['system', 'user'],
            toolDefinitionCount: 0,
            toolCallCount: 0,
            toolResultCount: 0,
          },
        },
      },
    });
    expect(JSON.stringify(event)).not.toContain('sk-provider-secret-12345678');
    expect(JSON.stringify(event)).not.toContain('cause');
  });

  it('records stream parse diagnostics for malformed provider SSE chunks', async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue(sseResponse([
      'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
      'data: {definitely not json}\n\n',
    ]));
    const adapter = createOpenAICompatibleAdapter({
      providerId: 'openai',
      defaultBaseUrl: 'https://api.openai.com/v1',
      fetch,
      clock: { now: () => '2026-05-17T00:00:01.000Z' },
    });

    const events = await collect(adapter.streamModelStep(modelStepInput()));

    expect(events.map((event) => event.eventType)).toEqual([
      'model.step.started',
      'model.output.delta',
      'run.failed',
    ]);
    expect(events[2]).toMatchObject({
      eventType: 'run.failed',
      payload: {
        error: {
          code: 'provider_network_error',
          details: {
            providerId: 'openai',
            modelId: 'gpt-4.1',
            boundary: 'provider',
            operation: 'chat_completions_stream',
            failureStage: 'stream_parse_error',
            errorName: 'SyntaxError',
            requestShape: 'initial',
          },
        },
      },
    });
  });
});

