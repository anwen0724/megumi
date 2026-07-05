import { describe, expect, it, vi } from 'vitest';
import { AssistantEventStream, type AiCallRequest, type AiClient } from '@megumi/ai';
import {
  createModelCallService,
  type ModelCallRequest,
  type ModelCallEvent,
} from '@megumi/coding-agent/agent-run';
import { mapModelCallToAiRequest } from '@megumi/coding-agent/agent-run/adapters/ai-client-adapter';

describe('Model Call Service', () => {
  it('maps Prompt and run-level ToolSet to packages/ai request', () => {
    const mapped = mapModelCallToAiRequest(sampleModelCallRequest());

    expect(mapped.model).toEqual({
      providerId: 'deepseek',
      protocol: 'openai-compatible',
      modelId: 'deepseek-chat',
    });
    expect(mapped.context.systemPrompt).toBe('System prompt');
    expect(mapped.context.messages).toEqual([
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: [{ type: 'text', text: 'Hi' }] },
    ]);
    expect(mapped.toolSet).toEqual([
      {
        name: 'read_file',
        description: 'Read a file',
        inputSchema: { type: 'object' },
      },
    ]);
    expect('maxRetries' in mapped).toBe(false);
    expect('maxRetryDelayMs' in mapped).toBe(false);
  });

  it('streams model events and supports cancellation by model_call_id', async () => {
    let capturedRequest: AiCallRequest | undefined;
    const aiClient: AiClient = {
      stream(request) {
        capturedRequest = request;
        return AssistantEventStream.from([
          { type: 'message_start', messageId: 'assistant-1', role: 'assistant' },
          {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: 'Hello' },
          },
          {
            type: 'content_block_start',
            index: 1,
            block: {
              type: 'toolCall',
              id: 'provider-tool-call-1',
              name: 'read_file',
              argumentsText: '{"path":"README.md"}',
            },
          },
          {
            type: 'message_end',
            message: {
              role: 'assistant',
              content: [{ type: 'text', text: 'Hello' }],
              stopReason: 'stop',
              usage: {
                providerId: 'deepseek',
                modelId: 'deepseek-chat',
                inputTokens: 1,
                outputTokens: 2,
                totalTokens: 3,
              },
            },
          },
        ]);
      },
      complete: vi.fn(),
    };
    const service = createModelCallService({
      ai_client: aiClient,
      ids: { model_call_id: () => 'model-call-1' },
      clock: { now: () => '2026-01-01T00:00:00.000Z' },
      retry: { max_retries: 2, max_retry_delay_ms: 25 },
    });

    const result = await service.modelCall(sampleModelCallRequest());

    expect(result.status).toBe('started');
    if (result.status !== 'started') return;

    const events = await collect(result.events);
    expect(events.map((event) => event.type)).toEqual([
      'started',
      'text_delta',
      'tool_call',
      'completed',
    ]);
    expect(events.find((event) => event.type === 'tool_call')).toMatchObject({
      tool_call_id: 'provider-tool-call-1',
      tool_name: 'read_file',
      input: { path: 'README.md' },
    });
    expect(capturedRequest && 'maxRetries' in capturedRequest).toBe(false);
    expect(service.cancelModelCall({ model_call_id: 'model-call-1' })).toEqual({
      status: 'not_cancellable',
      model_call_id: 'model-call-1',
    });
  });

  it('retries retryable provider failures inside Model Call Service', async () => {
    let calls = 0;
    const aiClient: AiClient = {
      stream() {
        calls += 1;
        if (calls < 3) {
          return AssistantEventStream.from([
            {
              type: 'error',
              reason: 'error',
              message: {
                role: 'assistant',
                content: [],
                stopReason: 'error',
                error: {
                  providerId: 'deepseek',
                  modelId: 'deepseek-chat',
                  code: 'provider_http_error',
                  message: 'provider failed',
                  severity: 'error',
                  source: 'ai',
                  retryable: true,
                },
              },
            },
          ]);
        }

        return AssistantEventStream.from([
          {
            type: 'message_end',
            message: {
              role: 'assistant',
              content: [{ type: 'text', text: 'Recovered' }],
              stopReason: 'stop',
            },
          },
        ]);
      },
      complete: vi.fn(),
    };
    const service = createModelCallService({
      ai_client: aiClient,
      ids: { model_call_id: () => 'model-call-1' },
      clock: { now: () => '2026-01-01T00:00:00.000Z' },
      retry: { max_retries: 3, max_retry_delay_ms: 10 },
    });

    const result = await service.modelCall(sampleModelCallRequest());

    expect(result.status).toBe('started');
    if (result.status !== 'started') return;

    const events = await collect(result.events);
    expect(calls).toBe(3);
    expect(events.map((event) => event.type)).toEqual([
      'started',
      'retrying',
      'retrying',
      'completed',
    ]);
    expect(events.at(-1)).toMatchObject({ type: 'completed', content: 'Recovered' });
  });
});

function sampleModelCallRequest(): ModelCallRequest {
  return {
    owner: { type: 'agent_run', run_id: 'run-1' },
    prompt: {
      prompt_id: 'prompt-1',
      purpose: 'agent_response',
      messages: [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi' },
      ],
      source_refs: [],
    },
    model_config: {
      provider_id: 'deepseek',
      protocol: 'openai-compatible',
      model_id: 'deepseek-chat',
      api_key: 'sk-test',
    },
    tool_set: {
      items: [
        {
          name: 'read_file',
          description: 'Read a file',
          input_schema: { type: 'object' },
          source_tool_name: 'read_file',
        },
      ],
    },
  };
}

async function collect(events: AsyncIterable<ModelCallEvent>): Promise<ModelCallEvent[]> {
  const collected: ModelCallEvent[] = [];
  for await (const event of events) {
    collected.push(event);
  }
  return collected;
}
