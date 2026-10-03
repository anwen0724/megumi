// @vitest-environment node
/*
 * Verifies run completion and persistence through the standalone Agent public entry.
 */
import { expect, it } from 'vitest';
import { fauxAssistantMessage, fauxToolCall } from '@megumi/ai';
import { type SaveMessageRequest, type AgentTool } from '@megumi/agent';
import { fixture, deferred } from './agent-fixture';

it('closes saved tool calls without executing them when the reply exceeds the execution limit', async () => {
  const { agent, config, provider } = fixture();
  provider.setResponses([fauxAssistantMessage([
    fauxToolCall('write', {}, { id: 'write-1' }), fauxToolCall('write', {}, { id: 'write-2' }),
  ], { stopReason: 'toolUse' })]);
  const saved: SaveMessageRequest[] = [];
  let changed = false;
  const run = agent.startAgent({
    config: { ...config, policy: { ...config.policy, maxToolCallsPerModelCall: 1 }, tools: [{
      name: 'write', description: 'Write', parameters: { type: 'object' }, operations: () => [],
      async execute() { changed = true; return { outputKind: 'text', content: 'Written' }; },
    }] },
    input: { role: 'user', content: 'Write', timestamp: 1 },
    context: { async prepare({ runMessages, tools }) { return { systemPrompt: '', messages: runMessages, tools }; } },
    async saveMessage(message) { saved.push(message); },
  });
  expect(await run.completion).toMatchObject({ status: 'failed', error: { code: 'EXECUTION_LIMIT_REACHED' } });
  expect(changed).toBe(false);
  expect(saved.filter(item => item.message.role === 'toolResult').map(item => item.message)).toMatchObject([
    { toolCallId: 'write-1', isError: true }, { toolCallId: 'write-2', isError: true },
  ]);
});

it('records cancelled results for saved calls when cancellation arrives during the assistant save', async () => {
  const { agent, config, provider } = fixture();
  provider.setResponses([fauxAssistantMessage(fauxToolCall('write', {}, { id: 'write-1' }), { stopReason: 'toolUse' })]);
  const saving = deferred();
  const release = deferred();
  const saved: SaveMessageRequest[] = [];
  let changed = false;
  const run = agent.startAgent({
    config: { ...config, tools: [{ name: 'write', description: 'Write', parameters: { type: 'object' },
      operations: () => [], async execute() { changed = true; return { outputKind: 'text', content: 'Written' }; } }] },
    input: { role: 'user', content: 'Write', timestamp: 1 },
    context: { async prepare({ runMessages, tools }) { return { systemPrompt: '', messages: runMessages, tools }; } },
    async saveMessage(request) {
      saved.push(request);
      if (request.message.role === 'assistant') { saving.resolve(); await release.promise; }
    },
  });
  await saving.promise;
  run.cancel();
  release.resolve();
  expect(await run.completion).toMatchObject({ status: 'cancelled' });
  expect(saved.map(item => item.message.role)).toEqual(['user', 'assistant', 'toolResult']);
  expect(saved[2].message).toMatchObject({ toolCallId: 'write-1', isError: true });
  expect(changed).toBe(false);
});

it('fails before context preparation when saving the input fails', async () => {
  const { agent, config } = fixture();
  let prepared = false;
  const run = agent.startAgent({
    config,
    input: { role: 'user', content: 'Hello', timestamp: 1 },
    context: { async prepare({ runMessages, tools }) {
      prepared = true;
      return { systemPrompt: '', messages: runMessages, tools };
    } },
    async saveMessage() { throw new Error('Storage unavailable'); },
  });
  expect(await run.completion).toMatchObject({
    status: 'failed', phase: 'saving_message', error: { code: 'MESSAGE_SAVE_FAILED' },
  });
  expect(prepared).toBe(false);
});

it('saves a finished parallel tool immediately and waits for other active tools after a save failure', async () => {
  const { agent, config, provider } = fixture();
  const stopping = deferred();
  const cleanup = deferred();
  let finished = false;
  let queuedExecuted = false;
  provider.setResponses([fauxAssistantMessage([
    fauxToolCall('slow', {}, { id: 'slow-1' }),
    fauxToolCall('fast', {}, { id: 'fast-1' }),
    fauxToolCall('queued', {}, { id: 'queued-1' }),
  ], { stopReason: 'toolUse' })]);
  const makeTool = (name: string, execute: AgentTool['execute']): AgentTool => ({
    name, description: name, parameters: { type: 'object', properties: {} },
    executionMode: 'parallel', operations: () => [], execute,
  });
  const run = agent.startAgent({
    config: { ...config, tools: [
      makeTool('slow', async (_input, { signal }) => {
        signal.addEventListener('abort', () => stopping.resolve(), { once: true });
        await cleanup.promise;
        return { outputKind: 'text', content: 'Stopped after cleanup' };
      }),
      makeTool('fast', async () => ({ outputKind: 'text', content: 'Saved side effect' })),
      makeTool('queued', async () => { queuedExecuted = true; return { outputKind: 'text', content: 'Unexpected' }; }),
    ] },
    input: { role: 'user', content: 'Run tools', timestamp: 1 },
    context: { async prepare({ runMessages, tools }) { return { systemPrompt: '', messages: runMessages, tools }; } },
    async saveMessage({ message }) {
      if (message.role === 'toolResult' && message.toolName === 'fast') throw new Error('Disk full');
    },
  });
  void run.completion.then(() => { finished = true; });
  await stopping.promise;
  expect(finished).toBe(false);
  cleanup.resolve();
  expect(await run.completion).toMatchObject({ status: 'failed', error: { code: 'MESSAGE_SAVE_FAILED' } });
  expect(queuedExecuted).toBe(false);
  expect(provider.state.callCount).toBe(1);
});



it('retries a transient model failure without persisting it as a completed reply', async () => {
  const { agent, config, provider } = fixture();
  provider.setResponses([
    fauxAssistantMessage('', { stopReason: 'error', errorMessage: '503 Service unavailable' }),
    fauxAssistantMessage('Recovered.'),
  ]);
  const saved: SaveMessageRequest[] = [];
  const run = agent.startAgent({
    config: { ...config, policy: { ...config.policy, maxModelCallAttempts: 2 } },
    input: { role: 'user', content: 'Hello', timestamp: 1 },
    context: { async prepare({ runMessages, tools }) {
      return { systemPrompt: '', messages: runMessages, tools };
    } },
    async saveMessage(message) { saved.push(message); },
  });
  expect(await run.completion).toMatchObject({ status: 'completed' });
  expect(provider.state.callCount).toBe(2);
  expect(saved.map(item => item.message.role)).toEqual(['user', 'assistant']);
});

it('saves each message before dependent work and passes the complete prepared context only once', async () => {
  const { agent, config, provider } = fixture();
  const saved: SaveMessageRequest[] = [];
  let changed = false;
  provider.setResponses([
    context => {
      expect(context.messages.filter(message => message.role === 'user')).toHaveLength(1);
      return fauxAssistantMessage(fauxToolCall('write_note', {}, { id: 'write-1' }), { stopReason: 'toolUse' });
    },
    context => {
      expect(context.messages.filter(message => message.role === 'user')).toHaveLength(1);
      expect(context.messages.filter(message => message.role === 'toolResult')).toHaveLength(1);
      expect(saved.map(item => item.message.role)).toEqual(['user', 'assistant', 'toolResult']);
      return fauxAssistantMessage('Note saved.');
    },
  ]);
  const run = agent.startAgent({
    config: { ...config, tools: [{
      name: 'write_note', description: 'Write a note', parameters: { type: 'object', properties: {} },
      operations: () => [],
      async execute() {
        expect(saved.map(item => item.message.role)).toEqual(['user', 'assistant']);
        changed = true;
        return { outputKind: 'text', content: 'Saved' };
      },
    }] },
    input: { role: 'user', content: 'Write a note', timestamp: 1 },
    context: { async prepare({ tools }) {
      expect(saved.length).toBeGreaterThan(0);
      return { systemPrompt: '', messages: saved.map(item => item.message), tools };
    } },
    async saveMessage(message) { saved.push(message); },
  });
  expect(await run.completion).toMatchObject({ status: 'completed', reason: 'model_response' });
  expect(changed).toBe(true);
  expect(saved.map(item => item.message.role)).toEqual(['user', 'assistant', 'toolResult', 'assistant']);
  expect(new Set(saved.map(item => item.messageId)).size).toBe(4);
  expect((await run.completion).runMessages).toEqual(saved.map(item => item.message));
});

it('ends after the configured successful tool and waits for its result to be saved', async () => {
  const { agent, config, provider } = fixture();
  provider.setResponses([fauxAssistantMessage(fauxToolCall('submit', {}), { stopReason: 'toolUse' })]);
  const saving = deferred();
  const saved = deferred();
  let ended = false;
  const run = agent.startAgent({
    config: { ...config, completeAfterTool: 'submit', tools: [{
      name: 'submit', description: 'Submit draft', parameters: { type: 'object' }, operations: () => [],
      async execute() { return { outputKind: 'text', content: 'Draft accepted' }; },
    }] },
    input: { role: 'user', content: 'Select recommendations', timestamp: 1 },
    context: { async prepare({ runMessages, tools }) { return { systemPrompt: '', messages: runMessages, tools }; } },
    async saveMessage({ message }) {
      if (message.role === 'toolResult') { saving.resolve(); await saved.promise; }
    },
  });
  void run.completion.then(() => { ended = true; });
  await saving.promise;
  expect(ended).toBe(false);
  saved.resolve();
  expect(await run.completion).toMatchObject({ status: 'completed', reason: 'tool_completed' });
  expect(provider.state.callCount).toBe(1);
});

it('keeps a message save failure visible when cancellation arrives during the write', async () => {
  const { agent, config } = fixture();
  const saving = deferred();
  const release = deferred();
  let prepared = false;
  const run = agent.startAgent({
    config, input: { role: 'user', content: 'Hello', timestamp: 1 },
    context: { async prepare({ runMessages, tools }) {
      prepared = true;
      return { systemPrompt: '', messages: runMessages, tools };
    } },
    async saveMessage() { saving.resolve(); await release.promise; throw new Error('Write failed'); },
  });
  await saving.promise;
  run.cancel();
  expect(run.snapshot().status).toBe('cancelling');
  release.resolve();
  expect(await run.completion).toMatchObject({ status: 'failed', cancellationRequested: true, error: { code: 'MESSAGE_SAVE_FAILED' } });
  expect(prepared).toBe(false);
});

it('isolates callback and snapshot messages and fixes one immutable completion result', async () => {
  const { agent, config } = fixture();
  const run = agent.startAgent({
    config, input: { role: 'user', content: [{ type: 'text', text: 'Original' }], timestamp: 1 },
    context: { async prepare({ runMessages, tools }) {
      return { systemPrompt: '', messages: runMessages, tools };
    } },
    async saveMessage({ message }) {
      if (Array.isArray(message.content)) message.content.splice(0);
    },
  });
  const result = await run.completion;
  expect(result.runMessages[0].content).toEqual([{ type: 'text', text: 'Original' }]);
  const view = run.snapshot();
  const content = view.runMessages[0].content;
  if (Array.isArray(content)) content.splice(0);
  expect(run.snapshot().runMessages[0].content).toEqual([{ type: 'text', text: 'Original' }]);
  expect(Object.isFrozen(result.runMessages[0].content)).toBe(true);
  run.cancel();
  expect(await run.completion).toBe(result);
  expect(run.snapshot().status).toBe('completed');
});

it('waits for overflow compaction to update the source, then prepares the retried context', async () => {
  const { agent, config, provider } = fixture();
  let compacted = false;
  const compactionStarted = deferred();
  const compactionSaved = deferred();
  const seen: string[] = [];
  provider.setResponses([
    fauxAssistantMessage('', { stopReason: 'error', errorMessage: 'maximum context length exceeded' }),
    context => {
      seen.push(JSON.stringify(context.messages));
      return fauxAssistantMessage('Continued after compaction.');
    },
  ]);
  const run = agent.startAgent({
    config: { ...config, policy: { ...config.policy, maxContextOverflowRecoveries: 1 } },
    input: { role: 'user', content: 'Continue', timestamp: 1 },
    context: {
      async prepare({ tools }) {
        return { systemPrompt: '', tools, messages: [{ role: 'user', content: compacted ? 'Summary' : 'History', timestamp: 1 }] };
      },
      async compact({ reason }) {
        expect(reason).toBe('overflow');
        compactionStarted.resolve();
        await compactionSaved.promise;
        compacted = true;
        return { status: 'compacted' };
      },
    },
  });
  await compactionStarted.promise;
  expect(provider.state.callCount).toBe(1);
  compactionSaved.resolve();
  expect(await run.completion).toMatchObject({ status: 'completed' });
  expect(seen).toHaveLength(1);
  expect(seen[0]).toContain('Summary');
  expect(seen[0]).not.toContain('History');
});


it('keeps the configured tool metadata fixed when the caller changes its source object', async () => {
  const { agent, config } = fixture();
  const guidelines = ['Original guidance'];
  const tool: AgentTool = { name: 'read', description: 'Read', parameters: { type: 'object' },
    promptGuidelines: guidelines, operations: () => [], async execute() { return { outputKind: 'text', content: 'Read' }; } };
  let seen: readonly string[] | undefined;
  const run = agent.startAgent({ config: { ...config, tools: [tool] },
    input: { role: 'user', content: 'Hello', timestamp: 1 },
    context: { async prepare({ tools, runMessages }) {
      seen = tools[0].promptGuidelines;
      return { systemPrompt: '', messages: runMessages, tools };
    } },
  });
  guidelines.push('Changed after start');
  expect(await run.completion).toMatchObject({ status: 'completed' });
  expect(seen).toEqual(['Original guidance']);
});


it('isolates failing observers without repeating the model or skipping required saves', async () => {
  const { agent, config, provider } = fixture({ diagnostics: {
    async observe(_scope, operation) { await operation(); throw new Error('Trace failed'); },
    report() {},
  } });
  const saved: string[] = [];
  const run = agent.startAgent({ config, input: { role: 'user', content: 'Hello', timestamp: 1 },
    context: { async prepare({ runMessages, tools }) { return { systemPrompt: '', messages: runMessages, tools }; } },
    onEvent() { throw new Error('Display failed'); }, async saveMessage({ message }) { saved.push(message.role); },
  });
  expect(await run.completion).toMatchObject({ status: 'completed' });
  expect(saved).toEqual(['user', 'assistant']);
  expect(provider.state.callCount).toBe(1);
});

it('rejects duplicate model tool-call IDs before executing any effects', async () => {
  const { agent, config, provider } = fixture();
  let changed = false;
  provider.setResponses([fauxAssistantMessage([
    fauxToolCall('write', {}, { id: 'same' }), fauxToolCall('write', {}, { id: 'same' }),
  ], { stopReason: 'toolUse' })]);
  const run = agent.startAgent({ config: { ...config, tools: [{
    name: 'write', description: 'Write', parameters: { type: 'object' }, operations: () => [],
    async execute() { changed = true; return { outputKind: 'text', content: 'Written' }; },
  }] }, input: { role: 'user', content: 'Write', timestamp: 1 },
    context: { async prepare({ runMessages, tools }) { return { systemPrompt: '', messages: runMessages, tools }; } },
  });
  expect(await run.completion).toMatchObject({ status: 'failed', error: { code: 'MODEL_PROTOCOL_ERROR' } });
  expect(changed).toBe(false);
});
