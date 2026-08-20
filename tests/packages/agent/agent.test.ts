/* Verifies the stateful Agent exclusively through its public package interface. */
import { describe, expect, it, vi } from 'vitest';
import {
  Agent,
  AgentOperationError,
  type AgentEvent,
  type AgentOptions,
  type AgentTool,
} from '@megumi/agent';
import {
  AssistantMessageEventStream,
  Type,
  type Api,
  type AssistantMessage,
  type Model,
  type UserMessage,
} from '@megumi/ai';

const model: Model<Api> = {
  id: 'test-model',
  name: 'Test Model',
  api: 'test-api',
  provider: 'test-provider',
  baseUrl: 'https://example.invalid',
  reasoning: true,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 8_192,
  maxTokens: 1_024,
};

function assistant(text: string, timestamp = 2): AssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'stop',
    timestamp,
  };
}

function completedStream(message: AssistantMessage): AssistantMessageEventStream {
  const stream = new AssistantMessageEventStream();
  stream.push({ type: 'start', partial: { ...message, content: [] } });
  stream.push({ type: 'text_delta', contentIndex: 0, delta: 'done', partial: message });
  stream.push({ type: 'done', reason: message.stopReason as 'stop' | 'toolUse', message });
  stream.end();
  return stream;
}

function options(overrides: Partial<AgentOptions> = {}): AgentOptions {
  return {
    initialState: {
      configuration: {
        systemPrompt: 'Be concise.',
        model,
        thinkingLevel: 'high',
        tools: [],
      },
      messages: [],
    },
    stream: () => completedStream(assistant('done')),
    ...overrides,
  };
}

describe('Agent', () => {
  it('copies constructor inputs and returns isolated state snapshots', () => {
    const tools: AgentTool[] = [{
      name: 'lookup',
      description: 'Lookup.',
      parameters: Type.Object({}),
      execute: async () => ({
        status: 'completed',
        result: { content: [{ type: 'text', text: 'done' }], isError: false },
      }),
    }];
    const messages: UserMessage[] = [{ role: 'user', content: 'seed', timestamp: 1 }];
    const agent = new Agent(options({
      initialState: {
        configuration: { systemPrompt: 'Initial.', model, thinkingLevel: 'low', tools },
        messages,
      },
    }));
    tools.length = 0;
    messages.length = 0;

    const snapshot = agent.state;
    expect(snapshot.configuration.tools).toHaveLength(1);
    expect(snapshot.messages).toHaveLength(1);
    (snapshot.configuration.tools as AgentTool[]).length = 0;
    (snapshot.messages as UserMessage[]).length = 0;
    (snapshot.pendingToolCallIds as Set<string>).add('external');
    expect(agent.state.configuration.tools).toHaveLength(1);
    expect(agent.state.messages).toHaveLength(1);
    expect(agent.state.pendingToolCallIds.size).toBe(0);
  });

  it('configures and replaces history atomically while idle, then reset preserves configuration', () => {
    const agent = new Agent(options());
    const history: UserMessage[] = [{ role: 'user', content: 'resume', timestamp: 1 }];
    agent.configure({ systemPrompt: 'Changed.', thinkingLevel: 'high' });
    agent.replaceMessages(history);
    history.length = 0;
    expect(agent.state.configuration).toMatchObject({ systemPrompt: 'Changed.', thinkingLevel: 'high' });
    expect(agent.state.messages).toHaveLength(1);

    agent.reset();
    expect(agent.state.messages).toEqual([]);
    expect(agent.state.configuration.systemPrompt).toBe('Changed.');
    expect(agent.state.status).toBe('idle');
    expect(agent.state.lastError).toBeUndefined();
  });

  it('prompts with one or many normalized messages and continues only from a valid tail', async () => {
    const contexts: string[][] = [];
    const agent = new Agent(options({
      stream: (_model, context) => {
        contexts.push(context.messages.map((message) => message.role));
        return completedStream(assistant(`done-${contexts.length}`, contexts.length + 1));
      },
    }));
    const first: UserMessage = { role: 'user', content: 'one', timestamp: 1 };
    const second: UserMessage = { role: 'user', content: 'two', timestamp: 2 };

    const result = await agent.prompt([first, second]);
    expect(result.status).toBe('completed');
    expect(agent.state.messages.map((message) => message.role)).toEqual(['user', 'user', 'assistant']);
    expect(contexts[0]).toEqual(['user', 'user']);
    await expect(agent.continue()).rejects.toMatchObject({ code: 'invalid_state' });

    agent.replaceMessages([first]);
    await agent.continue();
    expect(contexts[1]).toEqual(['user']);
    expect(agent.state.messages.map((message) => message.role)).toEqual(['user', 'assistant']);
  });

  it('rejects concurrent operations and idle mutations without changing the active execution', async () => {
    const streamStarted = Promise.withResolvers<void>();
    const releaseStream = Promise.withResolvers<void>();
    const events: AgentEvent[] = [];
    const agent = new Agent(options({
      stream: async () => {
        streamStarted.resolve();
        await releaseStream.promise;
        return completedStream(assistant('done'));
      },
    }));
    agent.subscribe((event) => { events.push(event); });

    const active = agent.prompt({ role: 'user', content: 'first', timestamp: 1 });
    await streamStarted.promise;
    const stateBefore = agent.state;
    await expect(agent.prompt({ role: 'user', content: 'second', timestamp: 2 }))
      .rejects.toEqual(expect.objectContaining({ code: 'agent_busy' }));
    await expect(agent.continue()).rejects.toEqual(expect.objectContaining({ code: 'agent_busy' }));
    expect(() => agent.configure({ systemPrompt: 'late' })).toThrow(AgentOperationError);
    expect(() => agent.replaceMessages([])).toThrow(expect.objectContaining({ code: 'invalid_state' }));
    expect(() => agent.reset()).toThrow(expect.objectContaining({ code: 'invalid_state' }));
    expect(agent.state.messages).toEqual(stateBefore.messages);
    expect(agent.state.lastError).toBeUndefined();
    releaseStream.resolve();
    await active;
    expect(events.filter((event) => event.type === 'agent_start')).toHaveLength(1);
  });

  it('projects state before ordered awaited listeners and unsubscribe affects only later events', async () => {
    const observations: string[] = [];
    const listenerGate = Promise.withResolvers<void>();
    const agent = new Agent(options());
    const unsubscribe = agent.subscribe(async (event) => {
      if (event.type === 'message_update') {
        observations.push(`first:${agent.state.streamingMessage?.content.length}`);
        await listenerGate.promise;
      }
    });
    agent.subscribe((event) => {
      if (event.type === 'message_update') observations.push('second');
      if (event.type === 'message_end' && event.message.role === 'assistant') {
        observations.push(`ended:${agent.state.messages.at(-1)?.role}`);
      }
    });

    const execution = agent.prompt({ role: 'user', content: 'hello', timestamp: 1 });
    await vi.waitFor(() => expect(observations).toEqual(['first:1']));
    expect(agent.state.status).toBe('executing');
    listenerGate.resolve();
    await execution;
    expect(observations).toEqual(['first:1', 'second', 'ended:assistant']);
    unsubscribe();
    unsubscribe();
    observations.length = 0;
    await agent.prompt({ role: 'user', content: 'again', timestamp: 3 });
    expect(observations).toEqual(['second', 'ended:assistant']);
  });

  it('turns an unisolated listener exception into a failed result and stops before the model call', async () => {
    const stream = vi.fn(() => completedStream(assistant('unused')));
    const agent = new Agent(options({ stream }));
    agent.subscribe((event) => {
      if (event.type === 'turn_start') throw new Error('persistence failed');
    });

    const result = await agent.prompt({ role: 'user', content: 'hello', timestamp: 1 });
    expect(result).toMatchObject({
      status: 'failed',
      error: { code: 'event_listener_failed' },
    });
    expect(stream).not.toHaveBeenCalled();
    expect(agent.state).toMatchObject({ status: 'idle', lastError: { code: 'event_listener_failed' } });
  });

  it('projects pending ToolCall state before Tool lifecycle listeners', async () => {
    const toolMessage: AssistantMessage = {
      ...assistant('', 2),
      content: [{ type: 'toolCall', id: 'call-1', name: 'lookup', arguments: {} }],
      stopReason: 'toolUse',
    };
    const streams = [completedStream(toolMessage), completedStream(assistant('done', 4))];
    const observations: string[] = [];
    const agent = new Agent(options({
      initialState: {
        configuration: {
          systemPrompt: 'Be concise.',
          model,
          thinkingLevel: 'high',
          tools: [{
            name: 'lookup',
            description: 'Lookup.',
            parameters: Type.Object({}),
            execute: async () => ({
              status: 'completed',
              result: { content: [{ type: 'text', text: 'found' }], isError: false },
            }),
          }],
        },
      },
      stream: () => streams.shift()!,
    }));
    agent.subscribe((event) => {
      if (event.type === 'tool_execution_start') {
        observations.push(`start:${agent.state.pendingToolCallIds.has('call-1')}`);
      }
      if (event.type === 'tool_execution_end') {
        observations.push(`end:${agent.state.pendingToolCallIds.has('call-1')}`);
      }
    });

    await agent.prompt({ role: 'user', content: 'lookup', timestamp: 1 });
    expect(observations).toEqual(['start:true', 'end:false']);
  });

  it('rejects an invalid continuation without events or state changes', async () => {
    const events: AgentEvent[] = [];
    const agent = new Agent(options());
    agent.subscribe((event) => { events.push(event); });
    const before = agent.state;

    await expect(agent.continue()).rejects.toMatchObject({ code: 'invalid_state' });
    expect(events).toEqual([]);
    expect(agent.state).toEqual(before);
  });

  it('aborts idempotently and waitForIdle settles after final listeners and cleanup', async () => {
    const streamStarted = Promise.withResolvers<void>();
    const agentEndGate = Promise.withResolvers<void>();
    const agent = new Agent(options({
      stream: async (_model, _context, streamOptions) => {
        streamStarted.resolve();
        await new Promise<void>((resolve) => {
          streamOptions.signal?.addEventListener('abort', () => resolve(), { once: true });
        });
        return new AssistantMessageEventStream();
      },
    }));
    agent.subscribe(async (event) => {
      if (event.type === 'agent_end') await agentEndGate.promise;
    });

    const execution = agent.prompt({ role: 'user', content: 'hello', timestamp: 1 });
    await streamStarted.promise;
    const idle = agent.waitForIdle();
    agent.abort();
    agent.abort();
    let idleSettled = false;
    void idle.then(() => { idleSettled = true; });
    await vi.waitFor(() => expect(agent.state.streamingMessage).toBeUndefined());
    expect(idleSettled).toBe(false);
    agentEndGate.resolve();

    await expect(execution).resolves.toMatchObject({ status: 'cancelled' });
    await idle;
    expect(agent.state.status).toBe('idle');
    expect(agent.state.streamingMessage).toBeUndefined();
    expect(agent.state.pendingToolCallIds.size).toBe(0);
    expect(idleSettled).toBe(true);
  });

  it('rejects invalid policy before any execution can start', () => {
    expect(() => new Agent(options({ policy: { maxModelCalls: 0 } }))).toThrow(TypeError);
    expect(() => new Agent(options({ policy: { modelRetryDelayMs: -1 } }))).toThrow(TypeError);
  });
});
