// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  createOpenAICompatibleAdapter,
  type FetchLike,
  type ProviderAdapterRequest,
} from '@megumi/ai';

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

function request(overrides: Partial<ProviderAdapterRequest> = {}): ProviderAdapterRequest {
  return {
    model: {
      providerId: 'openai',
      modelId: 'gpt-5.5',
      capabilities: {
        streaming: true,
        toolCalls: true,
        thinking: true,
      },
    },
    context: {
      systemPrompt: 'You are Megumi.',
      messages: [
        { role: 'user', content: 'Read package.json.' },
      ],
    },
    toolSet: [
      {
        name: 'read_file',
        description: 'Read a workspace file.',
        inputSchema: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
          additionalProperties: false,
        },
      },
    ],
    options: {
      credential: { type: 'api_key', value: 'sk-test' },
    },
    ...overrides,
  };
}

describe('pure OpenAI-compatible provider adapter', () => {
  it('materializes ModelContextInput and ToolSet into provider request body', async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue(sseResponse([
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"lo"}}],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}\n\n',
      'data: [DONE]\n\n',
    ]));
    const adapter = createOpenAICompatibleAdapter({
      providerId: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      fetch,
    });

    const events = await collect(adapter.stream(request()));

    const [, init] = fetch.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toEqual({
      model: 'gpt-5.5',
      messages: [
        { role: 'system', content: 'You are Megumi.' },
        { role: 'user', content: 'Read package.json.' },
      ],
      stream: true,
      stream_options: { include_usage: true },
      tools: [
        {
          type: 'function',
          function: {
            name: 'read_file',
            description: 'Read a workspace file.',
            parameters: {
              type: 'object',
              properties: { path: { type: 'string' } },
              required: ['path'],
              additionalProperties: false,
            },
          },
        },
      ],
      tool_choice: 'auto',
    });
    expect(events).toEqual([
      { type: 'message_start', messageId: 'assistant-0', role: 'assistant' },
      { type: 'content_block_start', index: 0, block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hel' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'lo' } },
      { type: 'content_block_end', index: 0, block: { type: 'text', text: 'Hello' } },
      {
        type: 'message_end',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Hello' }],
          usage: {
            providerId: 'openai',
            modelId: 'gpt-5.5',
            inputTokens: 3,
            outputTokens: 2,
            totalTokens: 5,
          },
        },
      },
    ]);
  });

  it('normalizes provider reasoning and tool calls as assistant content block events', async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue(sseResponse([
      'data: {"choices":[{"delta":{"reasoning_content":"Think."}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-read","function":{"name":"read_file","arguments":"{\\"path\\":"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"package.json\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n',
    ]));
    const adapter = createOpenAICompatibleAdapter({
      providerId: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      fetch,
    });

    const events = await collect(adapter.stream(request()));

    expect(events).toEqual([
      { type: 'message_start', messageId: 'assistant-0', role: 'assistant' },
      { type: 'content_block_start', index: 0, block: { type: 'thinking', thinking: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Think.' } },
      { type: 'content_block_end', index: 0, block: { type: 'thinking', thinking: 'Think.' } },
      {
        type: 'content_block_start',
        index: 1,
        block: {
          type: 'toolCall',
          id: 'call-read',
          name: 'read_file',
          argumentsText: '',
        },
      },
      {
        type: 'content_block_delta',
        index: 1,
        delta: {
          type: 'tool_call_delta',
          id: 'call-read',
          name: 'read_file',
          argumentsTextDelta: '{"path":',
        },
      },
      {
        type: 'content_block_delta',
        index: 1,
        delta: {
          type: 'tool_call_delta',
          argumentsTextDelta: '"package.json"}',
        },
      },
      {
        type: 'content_block_end',
        index: 1,
        block: {
          type: 'toolCall',
          id: 'call-read',
          name: 'read_file',
          argumentsText: '{"path":"package.json"}',
        },
      },
      {
        type: 'message_end',
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'Think.' },
            {
              type: 'toolCall',
              id: 'call-read',
              name: 'read_file',
              argumentsText: '{"path":"package.json"}',
            },
          ],
          stopReason: 'tool_calls',
        },
      },
    ]);
  });

  it('returns provider errors as assistant stream error events without leaking credentials', async () => {
    const fetch = vi.fn<FetchLike>().mockResolvedValue(new Response(
      '{"error":{"message":"bad sk-provider-secret-12345678"}}',
      { status: 401, statusText: 'Unauthorized' },
    ));
    const adapter = createOpenAICompatibleAdapter({
      providerId: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      fetch,
    });

    const [event] = await collect(adapter.stream(request()));

    expect(event).toMatchObject({
      type: 'error',
      reason: 'error',
      message: {
        role: 'assistant',
        content: [],
        stopReason: 'error',
        error: {
          providerId: 'openai',
          modelId: 'gpt-5.5',
          code: 'provider_http_error',
          retryable: false,
          source: 'ai',
          details: {
            httpStatus: 401,
            httpStatusText: 'Unauthorized',
          },
        },
      },
    });
    expect(JSON.stringify(event)).not.toContain('sk-provider-secret-12345678');
  });
});
