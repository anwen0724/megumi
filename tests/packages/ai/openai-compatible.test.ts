// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { ChatRuntimeRequest } from '@megumi/shared/chat-contracts';
import { RuntimeEventSchema } from '@megumi/shared/runtime-event-schemas';
import { createOpenAICompatibleAdapter } from '@megumi/ai/providers/openai-compatible';
import type { AiModelStepAdapterRequest, FetchLike, ProviderRuntimeConfig } from '@megumi/ai/types';

const request: ChatRuntimeRequest = {
  requestId: 'request-1',
  providerId: 'openai',
  modelId: 'gpt-4.1',
  createdAt: '2026-05-11T00:00:00.000Z',
  messages: [
    {
      id: 'message-1',
      role: 'user',
      content: 'Hello',
      createdAt: '2026-05-11T00:00:00.000Z',
    },
  ],
};

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
  function adapterInput() {
    let sequence = 0;

    return {
      request,
      runId: 'run-1',
      config,
      nextSequence: () => {
        sequence += 1;
        return sequence;
      },
      eventIdFactory: () => `event-${sequence + 1}`,
    };
  }

  function modelStepInput(overrides: Partial<AiModelStepAdapterRequest['request']> = {}): AiModelStepAdapterRequest {
    let sequence = 0;

    return {
      request: {
        requestId: 'request-1',
        sessionId: 'session-1',
        runId: 'run-1',
        stepId: 'step-1',
        providerId: 'openai' as const,
        modelId: 'gpt-4.1',
        messages: [
          {
            messageId: 'message-1',
            sessionId: 'session-1',
            role: 'user' as const,
            content: 'Read package.json',
            status: 'completed' as const,
            createdAt: '2026-05-17T00:00:00.000Z',
          },
        ],
        createdAt: '2026-05-17T00:00:00.000Z',
        ...overrides,
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

  it('posts chat completions and maps SSE chunks to stream events', async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue(sseResponse([
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"lo"}}],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}\n\n',
      'data: [DONE]\n\n',
    ]));

    const adapter = createOpenAICompatibleAdapter({
      providerId: 'openai',
      defaultBaseUrl: 'https://api.openai.com/v1',
      fetch,
      clock: { now: () => '2026-05-11T00:00:01.000Z' },
    });

    const events = await collect(adapter.streamChat(adapterInput()));

    expect(fetch).toHaveBeenCalledWith('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        authorization: 'Bearer sk-test',
        'content-type': 'application/json',
      },
      body: expect.any(String),
      signal: undefined,
    });

    const [, init] = fetch.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toEqual({
      model: 'gpt-4.1',
      messages: [
        {
          role: 'system',
          content: expect.stringContaining('You are Megumi'),
        },
        {
          role: 'user',
          content: 'Hello',
        },
      ],
      stream: true,
      stream_options: {
        include_usage: true,
      },
    });

    expect(events.map((event) => event.eventType)).toEqual([
      'assistant.output.delta',
      'assistant.output.delta',
      'assistant.output.completed',
    ]);
    expect(events.map((event) => event.sequence)).toEqual([1, 2, 3]);
    expect(events[0]).toMatchObject({
      eventType: 'assistant.output.delta',
      sequence: 1,
      payload: { delta: 'Hel' },
    });
    expect(events[1]).toMatchObject({
      eventType: 'assistant.output.delta',
      sequence: 2,
      payload: { delta: 'lo' },
    });
    expect(events[2]).toMatchObject({
      eventType: 'assistant.output.completed',
      sequence: 3,
      payload: {
        content: 'Hello',
        usage: {
          inputTokens: 3,
          outputTokens: 2,
          totalTokens: 5,
        },
      },
    });
  });

  it('streams model step requests as the primary provider path', async () => {
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
        messages: [
          {
            messageId: 'message-1',
            sessionId: 'session-1',
            role: 'user',
            content: 'Hello',
            status: 'completed',
            createdAt: '2026-05-17T00:00:00.000Z',
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

  it('streams model step tool calls as tool use created events', async () => {
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
      'model.tool_use.detected',
      'tool.use.created',
      'model.step.completed',
    ]);
    expect(events.map((event) => event.sequence)).toEqual([1, 2, 3, 4]);
    expect(events.map((event) => RuntimeEventSchema.parse(event))).toEqual(events);
    expect(events[1]).toMatchObject({
      eventType: 'model.tool_use.detected',
      payload: {
        modelStepId: 'model-step-1',
        toolUseId: 'call-read',
        providerToolUseId: 'call-read',
        toolName: 'read_file',
      },
    });
    expect(events[2]).toMatchObject({
      eventType: 'tool.use.created',
      stepId: 'step-1',
      payload: {
        toolUseId: 'call-read',
        modelStepId: 'model-step-1',
        providerToolUseId: 'call-read',
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

  it('detects tool use before the completed tool-use event', async () => {
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
      'model.tool_use.detected',
      'tool.use.created',
      'model.step.completed',
    ]);
    expect(events.findIndex((event) => event.eventType === 'model.tool_use.detected'))
      .toBeLessThan(events.findIndex((event) => event.eventType === 'tool.use.created'));
  });

  it('keeps one thinking lifecycle when reasoning continues after tool detection', async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue(sseResponse([
      'data: {"choices":[{"delta":{"reasoning_content":"I need to inspect docs."}}]}\n\n',
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
      'model.thinking.delta',
      'model.thinking.completed',
      'model.step.provider_state.recorded',
      'model.tool_use.detected',
      'tool.use.created',
      'model.step.completed',
    ]);
    expect(events.filter((event) => event.eventType === 'model.thinking.started')).toHaveLength(1);
    expect(events.filter((event) => event.eventType === 'model.thinking.completed')).toHaveLength(1);
    expect(events[3]).toMatchObject({
      eventType: 'model.thinking.delta',
      payload: {
        delta: 'Then I will summarize.',
      },
    });
    const eventTypes = events.map((event) => event.eventType);
    expect(eventTypes.indexOf('model.thinking.completed'))
      .toBeGreaterThan(eventTypes.lastIndexOf('model.thinking.delta'));
    expect(eventTypes.indexOf('model.thinking.completed'))
      .toBeLessThan(events.findIndex((event) => event.eventType === 'model.step.provider_state.recorded'));
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
      'model.thinking.completed',
      'model.step.provider_state.recorded',
      'model.tool_use.detected',
      'tool.use.created',
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
      eventType: 'model.thinking.completed',
      payload: {
        modelStepId: 'model-step-1',
      },
    });
    expect(events[4]).toMatchObject({
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
    expect(events[5]).toMatchObject({
      eventType: 'model.tool_use.detected',
      payload: {
        modelStepId: 'model-step-1',
        toolUseId: 'call-list',
        providerToolUseId: 'call-list',
        toolName: 'list_directory',
      },
    });
    expect(events[6]).toMatchObject({
      eventType: 'tool.use.created',
      payload: {
        toolName: 'list_directory',
        input: { path: 'docs' },
      },
    });
  });

  it('maps auth failures to typed failed events', async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue(new Response('bad key', { status: 401 }));
    const adapter = createOpenAICompatibleAdapter({
      providerId: 'openai',
      defaultBaseUrl: 'https://api.openai.com/v1',
      fetch,
      clock: { now: () => '2026-05-11T00:00:01.000Z' },
    });

    const events = await collect(adapter.streamChat(adapterInput()));

    expect(events).toEqual([
      expect.objectContaining({
        eventType: 'run.failed',
        requestId: 'request-1',
        runId: 'run-1',
        sequence: 1,
        payload: expect.objectContaining({
          error: expect.objectContaining({
            code: 'provider_auth_failed',
            message: 'Provider rejected the API key.',
            retryable: false,
            source: 'provider',
            details: expect.objectContaining({
              providerId: 'openai',
              modelId: 'gpt-4.1',
            }),
          }),
        }),
      }),
    ]);
    expect(JSON.stringify(events)).not.toContain('HTTP 401');
    expect(JSON.stringify(events)).not.toContain('cause');
  });

  it('maps rate limit failures to retryable typed failed events', async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue(new Response('rate limited', { status: 429 }));
    const adapter = createOpenAICompatibleAdapter({
      providerId: 'openai',
      defaultBaseUrl: 'https://api.openai.com/v1',
      fetch,
      clock: { now: () => '2026-05-11T00:00:01.000Z' },
    });

    const [event] = await collect(adapter.streamChat(adapterInput()));

    expect(event).toMatchObject({
      eventType: 'run.failed',
      payload: {
        error: {
          code: 'provider_rate_limited',
          retryable: true,
        },
      },
    });
  });

  it('maps abort signals to cancelled events', async () => {
    const abortError = new DOMException('The operation was aborted.', 'AbortError');
    const fetch = vi.fn<FetchLike>().mockRejectedValue(abortError);
    const adapter = createOpenAICompatibleAdapter({
      providerId: 'openai',
      defaultBaseUrl: 'https://api.openai.com/v1',
      fetch,
      clock: { now: () => '2026-05-11T00:00:01.000Z' },
    });

    const events = await collect(adapter.streamChat(adapterInput()));

    expect(events).toEqual([
      expect.objectContaining({
        eventType: 'run.cancelled',
        requestId: 'request-1',
        runId: 'run-1',
        sequence: 1,
        payload: {
          reason: 'Provider request was cancelled.',
        },
      }),
    ]);
  });

  it('does not include raw network error causes in failed event payloads', async () => {
    const fetch = vi.fn<FetchLike>().mockRejectedValue(new Error('connect failed with sk-secret-raw-header'));
    const adapter = createOpenAICompatibleAdapter({
      providerId: 'openai',
      defaultBaseUrl: 'https://api.openai.com/v1',
      fetch,
      clock: { now: () => '2026-05-11T00:00:01.000Z' },
    });

    const events = await collect(adapter.streamChat(adapterInput()));

    expect(events).toEqual([
      expect.objectContaining({
        eventType: 'run.failed',
        payload: expect.objectContaining({
          error: expect.objectContaining({
            code: 'provider_network_error',
            message: 'Provider network request failed.',
            details: expect.objectContaining({
              providerId: 'openai',
              modelId: 'gpt-4.1',
            }),
          }),
        }),
      }),
    ]);
    expect(JSON.stringify(events)).not.toContain('sk-secret-raw-header');
    expect(JSON.stringify(events)).not.toContain('cause');
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
      toolUses: [
        {
          toolUseId: 'tool-use-1',
          runId: 'run-1',
          modelStepId: 'step-1',
          providerToolUseId: 'tool-use-1',
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
          toolUseId: 'tool-use-1',
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
          code: 'provider_network_error',
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
            toolUseCount: 1,
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
            toolUseCount: 0,
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
