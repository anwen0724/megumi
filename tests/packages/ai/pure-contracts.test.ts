// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  AssistantEventStream,
  AssistantMessageSchema,
  ModelContextSchema,
  ToolSetSchema,
  createProviderError,
  defineAiModel,
  defineToolSet,
  type AssistantStreamEvent,
} from '@megumi/ai';

describe('pure AI contracts', () => {
  it('defines provider-bound model identity and model context input', () => {
    expect(defineAiModel({
      providerId: 'openai',
      modelId: 'gpt-5.5',
      displayName: 'GPT-5.5',
      capabilities: {
        streaming: true,
        toolCalls: true,
        thinking: true,
      },
    })).toEqual({
      providerId: 'openai',
      modelId: 'gpt-5.5',
      displayName: 'GPT-5.5',
      capabilities: {
        streaming: true,
        toolCalls: true,
        thinking: true,
      },
    });

    expect(ModelContextSchema.parse({
      systemPrompt: 'You are Megumi.',
      messages: [
        { role: 'user', content: 'Read package.json.' },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'I will inspect it.' },
            { type: 'toolCall', id: 'call-1', name: 'read_file', argumentsText: '{"path":"package.json"}' },
          ],
        },
        { role: 'toolResult', toolCallId: 'call-1', content: 'file contents' },
      ],
    })).toMatchObject({
      systemPrompt: 'You are Megumi.',
      messages: [
        { role: 'user', content: 'Read package.json.' },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'I will inspect it.' },
            { type: 'toolCall', id: 'call-1', name: 'read_file', argumentsText: '{"path":"package.json"}' },
          ],
        },
        { role: 'toolResult', toolCallId: 'call-1', content: 'file contents' },
      ],
    });
  });

  it('defines model-visible ToolSet without tool execution details', () => {
    expect(defineToolSet([
      {
        name: 'read_file',
        description: 'Read a workspace file.',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string' },
          },
          required: ['path'],
          additionalProperties: false,
        },
      },
    ])).toEqual([
      {
        name: 'read_file',
        description: 'Read a workspace file.',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string' },
          },
          required: ['path'],
          additionalProperties: false,
        },
      },
    ]);

    expect(() => ToolSetSchema.parse([
      {
        name: 'read_file',
        description: 'Read a workspace file.',
        inputSchema: {
          type: 'object',
          properties: { path: { type: 'string' } },
        },
        executionMode: 'serial',
      },
    ])).toThrow();
  });

  it('streams assistant message events and materializes the final assistant message', async () => {
    const events: AssistantStreamEvent[] = [
      { type: 'message_start', messageId: 'assistant-1', role: 'assistant' },
      { type: 'content_block_start', index: 0, block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } },
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
    ];

    const stream = AssistantEventStream.from(events);

    await expect(collect(stream)).resolves.toEqual(events);
    await expect(stream.result()).resolves.toEqual({
      role: 'assistant',
      content: [{ type: 'text', text: 'Hello' }],
      usage: {
        providerId: 'openai',
        modelId: 'gpt-5.5',
        inputTokens: 3,
        outputTokens: 2,
        totalTokens: 5,
      },
    });
  });

  it('normalizes provider errors as model access errors', () => {
    expect(createProviderError({
      providerId: 'openai',
      modelId: 'gpt-5.5',
      code: 'provider_http_error',
      message: 'Provider request failed.',
      retryable: true,
      details: { httpStatus: 500 },
    })).toEqual({
      providerId: 'openai',
      modelId: 'gpt-5.5',
      code: 'provider_http_error',
      message: 'Provider request failed.',
      severity: 'error',
      source: 'ai',
      retryable: true,
      details: {
        providerId: 'openai',
        modelId: 'gpt-5.5',
        httpStatus: 500,
      },
    });

    expect(AssistantMessageSchema.parse({
      role: 'assistant',
      content: [],
      stopReason: 'error',
      error: createProviderError({
        providerId: 'openai',
        modelId: 'gpt-5.5',
        code: 'provider_http_error',
        message: 'Provider request failed.',
      }),
    })).toMatchObject({
      role: 'assistant',
      stopReason: 'error',
    });
  });
});

async function collect<T>(events: AsyncIterable<T>): Promise<T[]> {
  const output: T[] = [];
  for await (const event of events) {
    output.push(event);
  }
  return output;
}
