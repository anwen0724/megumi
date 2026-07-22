/* Verifies the Model Call boundary preserves the AI package's authoritative stream semantics. */
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type Context,
  type Model,
  type Provider,
} from '@megumi/ai';
import {
  createModelCallService,
  type ModelCallEvent,
} from '@megumi/agent/agent-run';
import type { ProviderRuntimeConfig } from '@megumi/agent/settings';

describe('Model Call Service', () => {
  it('projects completed tool calls once and preserves the final AssistantMessage', async () => {
    const assistantMessage = message([
      { type: 'thinking', thinking: 'Check the file.' },
      { type: 'text', text: 'I will inspect it.' },
      { type: 'toolCall', id: 'call-1', name: 'read_file', arguments: { path: 'README.md' } },
    ], 'toolUse');
    const stream = createAssistantMessageEventStream();
    stream.push({ type: 'start', partial: message([]) });
    stream.push({ type: 'thinking_start', contentIndex: 0, partial: message([]) });
    stream.push({ type: 'thinking_delta', contentIndex: 0, delta: 'Check', partial: message([]) });
    stream.push({ type: 'thinking_end', contentIndex: 0, content: 'Check the file.', partial: message([]) });
    stream.push({ type: 'text_delta', contentIndex: 1, delta: 'I will inspect it.', partial: message([]) });
    stream.push({ type: 'toolcall_start', contentIndex: 2, partial: message([]) });
    stream.push({ type: 'toolcall_delta', contentIndex: 2, delta: '{"path":', partial: message([]) });
    stream.push({
      type: 'toolcall_end',
      contentIndex: 2,
      toolCall: { type: 'toolCall', id: 'call-1', name: 'read_file', arguments: { path: 'README.md' } },
      partial: assistantMessage,
    });
    stream.push({ type: 'done', reason: 'toolUse', message: assistantMessage });

    const model = testModel();
    const provider = {
      id: 'test-provider',
      name: 'Test Provider',
      auth: {},
      getModels: () => [model],
      stream: () => stream,
      streamSimple: () => stream,
    } as Provider;
    const service = createModelCallService({
      resolve_model_runtime: () => ({ provider, model }),
      ids: { model_call_id: () => 'model-call-1' },
      clock: { now: () => '2026-07-23T00:00:00.000Z' },
    });

    const result = await service.modelCall({
      owner: { type: 'agent_run', run_id: 'run-1' },
      context: testContext(),
      model_config: testConfig(),
    });
    expect(result.status).toBe('started');
    if (result.status !== 'started') return;
    const events = await collect(result.events);

    expect(events.filter((event) => event.type === 'tool_call')).toEqual([expect.objectContaining({
      tool_call_id: 'call-1',
      tool_name: 'read_file',
      input: { path: 'README.md' },
      arguments_text: '{"path":"README.md"}',
    })]);
    expect(events.at(-1)).toEqual(expect.objectContaining({
      type: 'completed',
      content: 'I will inspect it.',
      finish_reason: 'toolUse',
      assistant_message: assistantMessage,
    }));
  });
});

function testContext(): Context {
  return { messages: [{ role: 'user', content: 'Read it.', timestamp: 0 }] };
}

function testModel(): Model<'openai-completions'> {
  return {
    id: 'test-model',
    name: 'Test Model',
    api: 'openai-completions',
    provider: 'test-provider',
    baseUrl: 'https://example.test/v1',
    reasoning: true,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 8_192,
  };
}

function testConfig(): ProviderRuntimeConfig {
  return {
    provider_id: 'test-provider',
    api: 'openai-completions',
    base_url: 'https://example.test/v1',
    model_id: 'test-model',
    display_name: 'Test Model',
    context_window_tokens: 128_000,
    max_output_tokens: 8_192,
    capabilities: { streaming: true, toolCalls: true, thinking: true, imageInput: false },
    api_key: 'secret',
  };
}

function message(
  content: AssistantMessage['content'],
  stopReason: AssistantMessage['stopReason'] = 'stop',
): AssistantMessage {
  return {
    role: 'assistant',
    content,
    api: 'openai-completions',
    provider: 'test-provider',
    model: 'test-model',
    usage: {
      input: 2,
      output: 3,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 5,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason,
    timestamp: 0,
  };
}

async function collect(events: AsyncIterable<ModelCallEvent>): Promise<ModelCallEvent[]> {
  const collected: ModelCallEvent[] = [];
  for await (const event of events) collected.push(event);
  return collected;
}
