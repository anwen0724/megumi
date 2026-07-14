/*
 * Verifies shared Prompt materialization and Model Call streaming behavior.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  AssistantEventStream,
  type AiCallRequest,
  type AiClient,
  type RequestTokenCounter,
} from '@megumi/ai';
import {
  createModelCallService,
  type ModelCallRequest,
  type ModelCallEvent,
} from '@megumi/coding-agent/agent-run';
import { mapModelCallToAiRequest } from '@megumi/coding-agent/agent-run/adapters/ai-client-adapter';

const userMessage = (text: string) => ({ role: 'user' as const, content: [{ type: 'text' as const, text }] });

describe('Model Call Service', () => {
  it('maps all four Prompt regions to packages/ai without dropping model-facing content', () => {
    const mapped = mapModelCallToAiRequest(sampleModelCallRequest());

    expect(mapped.model).toEqual({
      providerId: 'deepseek',
      protocol: 'openai-compatible',
      modelId: 'deepseek-chat',
    });
    expect(mapped.context.systemPrompt).toBe(
      'System instruction\n\nWorkspace instruction\n\nSkill instruction',
    );
    expect(mapped.context.systemPrompt).not.toContain('Catalog entry');
    expect(mapped.context.systemPrompt).not.toContain('Summary reference');
    expect(mapped.context.systemPrompt).not.toContain('Memory reference');
    expect(mapped.context.messages).toEqual([
      contextMessage('skill_catalog', [{ skillId: 'catalog-1', description: 'Catalog entry' }]),
      contextMessage('compaction_summary', 'Summary reference'),
      userMessage('Earlier question'),
      { role: 'assistant', content: [{ type: 'text', text: 'Earlier answer' }] },
      contextMessage('memory_recall', [{ type: 'text', text: 'Memory reference' }]),
      userMessage('Hello'),
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Looking up' },
          {
            type: 'toolCall',
            id: 'call-lookup',
            name: 'lookup',
            argumentsText: '{"id":1}',
          },
        ],
      },
      {
        role: 'toolResult',
        toolCallId: 'call-lookup',
        content: '{"toolName":"lookup","status":"success","content":"{\\"answer\\":42}"}',
      },
    ]);
    expect(mapped.tools).toEqual([
      {
        name: 'lookup',
        description: 'Lookup an item',
        inputSchema: { type: 'object' },
      },
    ]);
    expect('maxRetries' in mapped).toBe(false);
    expect('maxRetryDelayMs' in mapped).toBe(false);
    expect(mapped).not.toHaveProperty('toolSet');
  });

  it('combines assistant text and one following tool call into one protocol message', () => {
    expect(mapConversation([
      { type: 'user_message', content: [{ type: 'text', text: 'Lookup one' }] },
      { type: 'assistant_message', content: [{ type: 'text', text: 'Calling lookup' }] },
      { type: 'tool_call', toolCallId: 'call-1', toolName: 'lookup', arguments: { id: 1 } },
      {
        type: 'tool_result',
        toolCallId: 'call-1',
        toolName: 'lookup',
        status: 'success',
        content: [{ type: 'text', text: 'one' }],
      },
    ])).toEqual([
      userMessage('Lookup one'),
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Calling lookup' },
          { type: 'toolCall', id: 'call-1', name: 'lookup', argumentsText: '{"id":1}' },
        ],
      },
      {
        role: 'toolResult',
        toolCallId: 'call-1',
        content: '{"toolName":"lookup","status":"success","content":"one"}',
      },
    ]);
  });

  it('maps historical run state to low-authority context instead of native tool protocol', () => {
    const state = {
      runId: 'run-old',
      runStatus: 'cancelled',
      modelStep: {
        modelCallId: 'model-1',
        assistantContent: [{ type: 'text', text: 'I will write it.' }],
        toolCalls: [{ toolCallId: 'call-1', toolName: 'write_file', arguments: { path: 'a.ts' } }],
      },
    };

    expect(mapConversation([
      { type: 'user_message', content: [{ type: 'text', text: 'Create a file' }] },
      { type: 'context', kind: 'historical_run_state', content: state },
      { type: 'user_message', content: [{ type: 'text', text: 'Continue' }] },
    ])).toEqual([
      userMessage('Create a file'),
      contextMessage('historical_run_state', state),
      userMessage('Continue'),
    ]);
  });

  it('keeps text, parallel tool calls, and paired results in provider protocol order', () => {
    expect(mapConversation([
      { type: 'user_message', content: [{ type: 'text', text: 'Lookup two' }] },
      {
        type: 'assistant_message',
        content: [
          { type: 'text', text: 'Calling both' },
          { type: 'json', value: { plan: 'parallel' } },
        ],
      },
      { type: 'tool_call', toolCallId: 'call-1', toolName: 'lookup', arguments: { id: 1 } },
      { type: 'tool_call', toolCallId: 'call-2', toolName: 'lookup', arguments: { id: 2 } },
      {
        type: 'tool_result',
        toolCallId: 'call-1',
        toolName: 'lookup',
        status: 'success',
        content: [{ type: 'text', text: 'one' }],
      },
      {
        type: 'tool_result',
        toolCallId: 'call-2',
        toolName: 'lookup',
        status: 'failure',
        content: [{ type: 'text', text: 'missing' }],
      },
    ])).toEqual([
      userMessage('Lookup two'),
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Calling both' },
          { type: 'text', text: '{"plan":"parallel"}' },
          { type: 'toolCall', id: 'call-1', name: 'lookup', argumentsText: '{"id":1}' },
          { type: 'toolCall', id: 'call-2', name: 'lookup', argumentsText: '{"id":2}' },
        ],
      },
      {
        role: 'toolResult',
        toolCallId: 'call-1',
        content: '{"toolName":"lookup","status":"success","content":"one"}',
      },
      {
        role: 'toolResult',
        toolCallId: 'call-2',
        content: '{"toolName":"lookup","status":"failure","content":"missing"}',
      },
    ]);
  });

  it('combines consecutive parallel tool calls without assistant text', () => {
    expect(mapConversation([
      { type: 'user_message', content: [{ type: 'text', text: 'Lookup two' }] },
      { type: 'tool_call', toolCallId: 'call-1', toolName: 'lookup', arguments: { id: 1 } },
      { type: 'tool_call', toolCallId: 'call-2', toolName: 'lookup', arguments: { id: 2 } },
    ])).toEqual([
      userMessage('Lookup two'),
      {
        role: 'assistant',
        content: [
          { type: 'toolCall', id: 'call-1', name: 'lookup', argumentsText: '{"id":1}' },
          { type: 'toolCall', id: 'call-2', name: 'lookup', argumentsText: '{"id":2}' },
        ],
      },
    ]);
  });

  it('uses the same Prompt materialization for counting and the actual model call', async () => {
    let countedRequest: AiCallRequest | undefined;
    let streamedRequest: AiCallRequest | undefined;
    const requestTokenCounter: RequestTokenCounter = {
      count(request) {
        countedRequest = request;
        return { inputTokens: 321, accuracy: 'estimated' };
      },
    };
    const aiClient: AiClient = {
      stream(request) {
        streamedRequest = request;
        return AssistantEventStream.from([{
          type: 'message_end',
          message: { role: 'assistant', content: [], stopReason: 'stop' },
        }]);
      },
      complete: vi.fn(),
    };
    const service = createModelCallService({
      ai_client: aiClient,
      request_token_counter: requestTokenCounter,
      ids: { model_call_id: () => 'model-call-1' },
    });
    const request = sampleModelCallRequest();

    await expect(service.countPrompt({
      prompt: request.prompt,
      model_config: request.model_config,
    })).resolves.toEqual({
      status: 'counted',
      input_tokens: 321,
      accuracy: 'estimated',
    });
    const result = await service.modelCall(request);
    if (result.status !== 'started') throw new Error('expected started model call');
    await collect(result.events);

    expect(countedRequest).toBeDefined();
    expect(streamedRequest).toBeDefined();
    expect(stripRuntimeOnlyFields(streamedRequest!)).toEqual(stripRuntimeOnlyFields(countedRequest!));
    expect(JSON.stringify(countedRequest)).toContain('System instruction');
    expect(JSON.stringify(countedRequest)).toContain('Memory reference');
    expect(JSON.stringify(countedRequest)).toContain('Hello');
    expect(JSON.stringify(countedRequest)).toContain('lookup');
  });

  it('reports unsupported image content instead of dropping it while counting', async () => {
    const counter = { count: vi.fn() };
    const service = createModelCallService({ request_token_counter: counter });
    const request = sampleModelCallRequest();
    request.prompt.conversation = [{
      type: 'user_message',
      content: [{ type: 'image', source: { type: 'host_reference', referenceId: 'attachment-1' } }],
    }];

    const result = await service.countPrompt({
      prompt: request.prompt,
      model_config: request.model_config,
    });

    expect(result).toMatchObject({
      status: 'failed',
      failure: { code: 'unsupported_content', retryable: false },
    });
    expect(counter.count).not.toHaveBeenCalled();
  });

  it('fails explicitly when Memory cannot be placed before a current user message', async () => {
    const counter = { count: vi.fn() };
    const service = createModelCallService({ request_token_counter: counter });
    const request = sampleModelCallRequest();
    request.prompt.conversation = [{
      type: 'assistant_message',
      content: [{ type: 'text', text: 'No current user' }],
    }];

    const result = await service.countPrompt({
      prompt: request.prompt,
      model_config: request.model_config,
    });

    expect(result).toMatchObject({
      status: 'failed',
      failure: {
        code: 'model_call_failed',
        retryable: false,
        details: { reason: 'memory_requires_current_user' },
      },
    });
    expect(counter.count).not.toHaveBeenCalled();
  });

  it('reports unsupported file content instead of starting a model call', () => {
    const aiClient: AiClient = { stream: vi.fn(), complete: vi.fn() };
    const service = createModelCallService({ ai_client: aiClient });
    const request = sampleModelCallRequest();
    request.prompt.conversation = [{
      type: 'user_message',
      content: [{ type: 'file', fileId: 'file-1' }],
    }];

    expect(service.modelCall(request)).toMatchObject({
      status: 'failed',
      failure: { code: 'unsupported_content', retryable: false },
    });
    expect(aiClient.stream).not.toHaveBeenCalled();
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
              argumentsText: '',
            },
          },
          {
            type: 'content_block_delta',
            index: 1,
            delta: {
              type: 'tool_call_delta',
              argumentsTextDelta: '{"path":"README.md"}',
            },
          },
          {
            type: 'content_block_end',
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

  it('yields text deltas before the provider stream closes', async () => {
    const providerStream = new AssistantEventStream();
    const aiClient: AiClient = {
      stream() {
        return providerStream;
      },
      complete: vi.fn(),
    };
    const service = createModelCallService({
      ai_client: aiClient,
      ids: { model_call_id: () => 'model-call-1' },
      clock: { now: () => '2026-01-01T00:00:00.000Z' },
    });

    const result = await service.modelCall(sampleModelCallRequest());

    expect(result.status).toBe('started');
    if (result.status !== 'started') return;

    const iterator = result.events[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toMatchObject({
      value: { type: 'started' },
      done: false,
    });

    providerStream.push({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'Hello' },
    });

    const streamed = await nextWithin(iterator, 25);
    providerStream.close();

    expect(streamed).toMatchObject({
      value: { type: 'text_delta', delta: 'Hello' },
      done: false,
    });
  });

  it('maps provider thinking blocks into model call thinking events', async () => {
    const aiClient: AiClient = {
      stream() {
        return AssistantEventStream.from([
          {
            type: 'content_block_start',
            index: 0,
            block: { type: 'thinking', thinking: '' },
          },
          {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'thinking_delta', thinking: 'I should inspect the file.' },
          },
          {
            type: 'content_block_end',
            index: 0,
            block: { type: 'thinking', thinking: 'I should inspect the file.' },
          },
          {
            type: 'message_end',
            message: {
              role: 'assistant',
              content: [
                { type: 'thinking', thinking: 'I should inspect the file.' },
                { type: 'text', text: 'Done.' },
              ],
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
    });

    const result = await service.modelCall(sampleModelCallRequest());

    expect(result.status).toBe('started');
    if (result.status !== 'started') return;

    const events = await collect(result.events);
    expect(events.map((event) => event.type)).toEqual([
      'started',
      'thinking_started',
      'thinking_delta',
      'thinking_completed',
      'completed',
    ]);
  });

  it('waits for complete streaming tool-call arguments before emitting a tool call', async () => {
    const aiClient: AiClient = {
      stream() {
        return AssistantEventStream.from([
          { type: 'message_start', messageId: 'assistant-1', role: 'assistant' },
          {
            type: 'content_block_start',
            index: 0,
            block: {
              type: 'toolCall',
              id: 'provider-tool-call-1',
              name: 'read_file',
              argumentsText: '',
            },
          },
          {
            type: 'content_block_delta',
            index: 0,
            delta: {
              type: 'tool_call_delta',
              argumentsTextDelta: '{"path":',
            },
          },
          {
            type: 'content_block_delta',
            index: 0,
            delta: {
              type: 'tool_call_delta',
              argumentsTextDelta: '"README.md"}',
            },
          },
          {
            type: 'content_block_end',
            index: 0,
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
              content: [
                {
                  type: 'toolCall',
                  id: 'provider-tool-call-1',
                  name: 'read_file',
                  argumentsText: '{"path":"README.md"}',
                },
              ],
              stopReason: 'tool_calls',
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
    });

    const result = await service.modelCall(sampleModelCallRequest());

    expect(result.status).toBe('started');
    if (result.status !== 'started') return;

    const events = await collect(result.events);
    expect(events.filter((event) => event.type === 'tool_call')).toEqual([
      expect.objectContaining({
        tool_call_id: 'provider-tool-call-1',
        tool_name: 'read_file',
        input: { path: 'README.md' },
      }),
    ]);
  });

  it('maps provider-neutral Prompt continuation items into provider protocol messages', () => {
    const request = sampleModelCallRequest();
    const mapped = mapModelCallToAiRequest({
      ...request,
      prompt: {
        ...request.prompt,
        conversation: [
          ...request.prompt.conversation,
          { type: 'assistant_message', content: [{ type: 'text', text: 'I need to read the file.' }] },
          { type: 'tool_call', toolCallId: 'provider-tool-call-1', toolName: 'read_file', arguments: { path: 'README.md' } },
          { type: 'tool_result', toolCallId: 'provider-tool-call-1', toolName: 'read_file', status: 'success', content: [{ type: 'text', text: 'README content' }] },
        ],
      },
    });

    expect(mapped.context.messages).toEqual([
      contextMessage('skill_catalog', [{ skillId: 'catalog-1', description: 'Catalog entry' }]),
      contextMessage('compaction_summary', 'Summary reference'),
      userMessage('Earlier question'),
      { role: 'assistant', content: [{ type: 'text', text: 'Earlier answer' }] },
      contextMessage('memory_recall', [{ type: 'text', text: 'Memory reference' }]),
      userMessage('Hello'),
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Looking up' },
          {
            type: 'toolCall',
            id: 'call-lookup',
            name: 'lookup',
            argumentsText: '{"id":1}',
          },
        ],
      },
      {
        role: 'toolResult',
        toolCallId: 'call-lookup',
        content: '{"toolName":"lookup","status":"success","content":"{\\"answer\\":42}"}',
      },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'I need to read the file.' },
          {
            type: 'toolCall',
            id: 'provider-tool-call-1',
            name: 'read_file',
            argumentsText: '{"path":"README.md"}',
          },
        ],
      },
      {
        role: 'toolResult',
        toolCallId: 'provider-tool-call-1',
        content: '{"toolName":"read_file","status":"success","content":"README content"}',
      },
    ]);
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
      instructions: {
        system: [{ instructionId: 'system-1', content: 'System instruction' }],
        agentInstructions: {
          sources: [{
            sourceId: 'agent-1',
            sourcePath: 'AGENTS.md',
            content: 'Workspace instruction',
          }],
        },
        activatedSkills: [{ skillId: 'skill-1', name: 'Skill', content: 'Skill instruction' }],
      },
      referenceContext: {
        skillCatalog: [{ skillId: 'catalog-1', name: 'Catalog skill', description: 'Catalog entry' }],
        compactionSummary: { compactionId: 'compaction-1', content: 'Summary reference' },
        memoryRecall: {
          recallId: 'recall-1',
          items: [{ memoryId: 'memory-1', content: [{ type: 'text', text: 'Memory reference' }] }],
        },
      },
      conversation: [
        { type: 'user_message', content: [{ type: 'text', text: 'Earlier question' }] },
        { type: 'assistant_message', content: [{ type: 'text', text: 'Earlier answer' }] },
        { type: 'user_message', content: [{ type: 'text', text: 'Hello' }] },
        { type: 'assistant_message', content: [{ type: 'text', text: 'Looking up' }] },
        { type: 'tool_call', toolCallId: 'call-lookup', toolName: 'lookup', arguments: { id: 1 } },
        {
          type: 'tool_result',
          toolCallId: 'call-lookup',
          toolName: 'lookup',
          status: 'success',
          content: [{ type: 'json', value: { answer: 42 } }],
        },
      ],
      tools: [{ name: 'lookup', description: 'Lookup an item', inputSchema: { type: 'object' } }],
    },
    model_config: {
      provider_id: 'deepseek',
      protocol: 'openai-compatible',
      model_id: 'deepseek-chat',
      capabilities: { imageInput: true },
      api_key: 'sk-test',
    },
  };
}

function mapConversation(conversation: ModelCallRequest['prompt']['conversation']) {
  const request = sampleModelCallRequest();
  request.prompt.referenceContext = { skillCatalog: [] };
  request.prompt.conversation = conversation;
  return mapModelCallToAiRequest(request).context.messages;
}

function contextMessage(kind: 'skill_catalog' | 'compaction_summary' | 'memory_recall' | 'historical_run_state', content: unknown) {
  return { role: 'context', kind, content };
}

function stripRuntimeOnlyFields(request: AiCallRequest): Omit<AiCallRequest, 'signal'> {
  const { signal: _signal, ...modelFacingRequest } = request;
  return modelFacingRequest;
}

async function collect(events: AsyncIterable<ModelCallEvent>): Promise<ModelCallEvent[]> {
  const collected: ModelCallEvent[] = [];
  for await (const event of events) {
    collected.push(event);
  }
  return collected;
}

async function nextWithin<T>(
  iterator: AsyncIterator<T>,
  timeoutMs: number,
): Promise<IteratorResult<T> | { timeout: true }> {
  return Promise.race([
    iterator.next(),
    new Promise<{ timeout: true }>((resolve) => {
      setTimeout(() => resolve({ timeout: true }), timeoutMs);
    }),
  ]);
}
