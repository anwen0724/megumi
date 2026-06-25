// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { buildModelInputContext } from '@megumi/coding-agent/run/context';
import type { ModelStepRuntimeRequest } from '@megumi/shared/model';
import { RuntimeEventSchema } from '@megumi/shared/runtime';
import { createModelStepProviderAdapter } from '@megumi/agent';
import type { FetchLike, ProviderRuntimeConfig } from '@megumi/agent';
import { createOpenAICompatibleAdapter } from '@megumi/ai/providers/openai-compatible';

const config: ProviderRuntimeConfig = {
  providerId: 'openai',
  kind: 'openai-compatible',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: 'sk-test',
  defaultModelId: 'gpt-5.5',
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
    headers: { 'content-type': 'text/event-stream' },
  });
}

async function collect<T>(events: AsyncIterable<T>): Promise<T[]> {
  const output: T[] = [];
  for await (const event of events) {
    output.push(event);
  }
  return output;
}

function runtimeRequest(overrides: Partial<ModelStepRuntimeRequest> = {}): ModelStepRuntimeRequest {
  return {
    requestId: 'request-1',
    sessionId: 'session-1',
    runId: 'run-1',
    stepId: 'step-1',
    modelStepId: 'model-step-1',
    providerId: 'openai',
    modelId: 'gpt-5.5',
    inputContext: buildModelInputContext({
      contextId: 'model-input-context:1',
      sessionId: 'session-1',
      runId: 'run-1',
      stepId: 'step-1',
      buildReason: 'initial_model_step',
      builtAt: '2026-05-17T00:00:00.000Z',
      parts: [
        {
          partId: 'part:instruction:1',
          kind: 'instruction',
          instructionKind: 'system',
          text: 'You are Megumi.',
          sourceRefs: [{ sourceId: 'system:1', sourceKind: 'system_instruction' }],
          priority: 100,
        },
        {
          partId: 'part:current-turn:1',
          kind: 'current_turn',
          role: 'user',
          text: 'Read package.json.',
          sourceRefs: [{ sourceId: 'message:1', sourceKind: 'current_user_message' }],
          priority: 90,
        },
      ],
    }),
    toolDefinitions: [{
      name: 'read_file',
      description: 'Read a workspace file.',
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
    }],
    createdAt: '2026-05-17T00:00:00.000Z',
    ...overrides,
  };
}

describe('model-step compatibility adapter', () => {
  it('adapts pure assistant stream events to current RuntimeEvent model step events', async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue(sseResponse([
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"lo"}}],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}\n\n',
      'data: [DONE]\n\n',
    ]));
    const adapter = createModelStepProviderAdapter({
      providerId: 'openai',
      provider: createOpenAICompatibleAdapter({
        providerId: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        fetch,
      }),
      clock: { now: () => '2026-05-17T00:00:01.000Z' },
    });
    let sequence = 0;

    const events = await collect(adapter.streamModelStep({
      request: runtimeRequest(),
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
    expect(events.map((event) => RuntimeEventSchema.parse(event))).toEqual(events);
    expect(events[1]).toMatchObject({
      eventType: 'model.output.delta',
      payload: {
        modelStepId: 'model-step-1',
        delta: 'Hel',
      },
    });
    expect(events[3]).toMatchObject({
      eventType: 'model.step.completed',
      payload: {
        modelStepId: 'model-step-1',
      },
    });
    expect(events[3].payload).not.toHaveProperty('outputText');
    expect(events[3].payload).not.toHaveProperty('usage');
  });

  it('adapts tool call content blocks to current tool.call.created events', async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue(sseResponse([
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-read","function":{"name":"read_file","arguments":"{\\"path\\":"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"package.json\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n',
    ]));
    const adapter = createModelStepProviderAdapter({
      providerId: 'openai',
      provider: createOpenAICompatibleAdapter({
        providerId: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        fetch,
      }),
      clock: { now: () => '2026-05-17T00:00:01.000Z' },
    });
    let sequence = 0;

    const events = await collect(adapter.streamModelStep({
      request: runtimeRequest(),
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
      'model.tool_call.detected',
      'tool.call.created',
      'model.step.completed',
    ]);
    expect(events[1]).toMatchObject({
      eventType: 'model.tool_call.detected',
      payload: {
        toolCallId: 'call-read',
        providerToolCallId: 'call-read',
        toolName: 'read_file',
      },
    });
    expect(events[2]).toMatchObject({
      eventType: 'tool.call.created',
      payload: {
        toolCallId: 'call-read',
        providerToolCallId: 'call-read',
        toolName: 'read_file',
        input: { path: 'package.json' },
      },
    });
  });

  it('keeps non-streaming completion behavior for memory extraction callers', async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue(new Response(JSON.stringify({
      choices: [{
        message: {
          content: '{ "candidates": [] }',
          reasoning_content: 'checked memory rules',
        },
        finish_reason: 'stop',
      }],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 4,
        total_tokens: 14,
      },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    const adapter = createModelStepProviderAdapter({
      providerId: 'openai',
      provider: createOpenAICompatibleAdapter({
        providerId: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        fetch,
      }),
      clock: { now: () => '2026-05-17T00:00:01.000Z' },
    });

    const result = await adapter.completeModelStep({
      request: runtimeRequest(),
      runId: 'run-1',
      stepId: 'step-1',
      config,
      nextSequence: () => 1,
      eventIdFactory: () => 'event-1',
    });

    expect(result).toEqual({
      ok: true,
      text: '{ "candidates": [] }',
      finishReason: 'stop',
      usage: {
        inputTokens: 10,
        outputTokens: 4,
        totalTokens: 14,
      },
      providerStates: [{
        modelStepId: 'model-step-1',
        providerId: 'openai',
        modelId: 'gpt-5.5',
        blocks: [{
          type: 'reasoning_content',
          text: 'checked memory rules',
        }],
      }],
    });
  });

  it('preserves system-like model input context parts outside user messages', async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue(sseResponse([
      'data: {"choices":[{"delta":{"content":"Ok"}}]}\n\n',
      'data: [DONE]\n\n',
    ]));
    const adapter = createModelStepProviderAdapter({
      providerId: 'openai',
      provider: createOpenAICompatibleAdapter({
        providerId: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        fetch,
      }),
      clock: { now: () => '2026-05-17T00:00:01.000Z' },
    });

    await collect(adapter.streamModelStep({
      request: runtimeRequest({
        inputContext: buildModelInputContext({
          contextId: 'model-input-context:system-role',
          sessionId: 'session-1',
          runId: 'run-1',
          stepId: 'step-1',
          buildReason: 'initial_model_step',
          builtAt: '2026-05-17T00:00:00.000Z',
          parts: [
            {
              partId: 'part:instruction:1',
              kind: 'instruction',
              instructionKind: 'system',
              text: 'You are Megumi.',
              sourceRefs: [{ sourceId: 'system:1', sourceKind: 'system_instruction' }],
              priority: 100,
            },
            {
              partId: 'part:memory:1',
              kind: 'memory',
              memoryKind: 'memory_recall',
              text: 'User prefers concise answers.',
              sourceRefs: [{ sourceId: 'memory:1', sourceKind: 'memory_recall' }],
              priority: 60,
            },
            {
              partId: 'part:runtime:1',
              kind: 'runtime_constraint',
              constraintKind: 'permission_mode',
              text: 'Permission mode is plan.',
              sourceRefs: [{ sourceId: 'permission:1', sourceKind: 'permission_mode' }],
              priority: 80,
            },
            {
              partId: 'part:current-turn:1',
              kind: 'current_turn',
              role: 'user',
              text: 'Read package.json.',
              sourceRefs: [{ sourceId: 'message:1', sourceKind: 'current_user_message' }],
              priority: 90,
            },
          ],
        }),
      }),
      runId: 'run-1',
      stepId: 'step-1',
      config,
      nextSequence: () => 1,
      eventIdFactory: () => 'event-1',
    }));

    const [, init] = fetch.mock.calls[0];
    expect(JSON.parse(String(init?.body)).messages).toEqual([
      {
        role: 'system',
        content: [
          'You are Megumi.',
          'User prefers concise answers.',
          'Permission mode is plan.',
        ].join('\n\n'),
      },
      {
        role: 'user',
        content: 'Read package.json.',
      },
    ]);
  });

  it('replays provider state as assistant thinking content for tool continuation', async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue(sseResponse([
      'data: {"choices":[{"delta":{"content":"Done"}}]}\n\n',
      'data: [DONE]\n\n',
    ]));
    const adapter = createModelStepProviderAdapter({
      providerId: 'openai',
      provider: createOpenAICompatibleAdapter({
        providerId: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        fetch,
      }),
      clock: { now: () => '2026-05-17T00:00:01.000Z' },
    });

    await collect(adapter.streamModelStep({
      request: runtimeRequest({
        inputContext: buildModelInputContext({
          contextId: 'model-input-context:provider-state',
          sessionId: 'session-1',
          runId: 'run-1',
          stepId: 'step-2',
          buildReason: 'tool_continuation',
          builtAt: '2026-05-17T00:00:00.000Z',
          parts: [
            {
              partId: 'part:tool-call:1',
              kind: 'tool_continuation',
              text: 'Tool use call-read requested read_file.',
              sourceRefs: [{ sourceId: 'tool-call:1', sourceKind: 'tool_call' }],
              priority: 80,
              toolCallId: 'call-read',
              providerToolCallId: 'provider-call-read',
              modelStepId: 'model-step-1',
              toolName: 'read_file',
              toolInput: { path: 'package.json' },
            },
            {
              partId: 'part:tool-result:1',
              kind: 'tool_continuation',
              text: 'read_file returned package metadata.',
              sourceRefs: [{ sourceId: 'tool-result:1', sourceKind: 'tool_result' }],
              priority: 80,
              toolCallId: 'call-read',
              toolResultId: 'tool-result-1',
              toolResultContent: 'read_file returned package metadata.',
              metadata: { observationId: 'observation:1' },
            },
            {
              partId: 'part:provider-state:1',
              kind: 'tool_continuation',
              text: 'I need to inspect package metadata.',
              sourceRefs: [{ sourceId: 'provider-state:1', sourceKind: 'provider_state' }],
              priority: 70,
              modelStepId: 'model-step-1',
              providerStateText: 'I need to inspect package metadata.',
            },
          ],
        }),
      }),
      runId: 'run-1',
      stepId: 'step-2',
      config,
      nextSequence: () => 1,
      eventIdFactory: () => 'event-1',
    }));

    const [, init] = fetch.mock.calls[0];
    expect(JSON.parse(String(init?.body)).messages).toEqual([
      {
        role: 'assistant',
        reasoning_content: 'I need to inspect package metadata.',
        tool_calls: [{
          id: 'provider-call-read',
          type: 'function',
          function: {
            name: 'read_file',
            arguments: '{"path":"package.json"}',
          },
        }],
      },
      {
        role: 'tool',
        tool_call_id: 'provider-call-read',
        content: 'read_file returned package metadata.',
      },
    ]);
  });

  it('uses non-streaming provider requests for completeModelStep', async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue(new Response(JSON.stringify({
      choices: [{
        message: { content: '{ "candidates": [] }' },
        finish_reason: 'stop',
      }],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    const adapter = createModelStepProviderAdapter({
      providerId: 'openai',
      provider: createOpenAICompatibleAdapter({
        providerId: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        fetch,
      }),
      clock: { now: () => '2026-05-17T00:00:01.000Z' },
    });

    await adapter.completeModelStep({
      request: runtimeRequest(),
      runId: 'run-1',
      stepId: 'step-1',
      config,
      nextSequence: () => 1,
      eventIdFactory: () => 'event-1',
    });

    const [, init] = fetch.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toMatchObject({
      stream: false,
    });
    expect(JSON.parse(String(init?.body))).not.toHaveProperty('stream_options');
  });
});
