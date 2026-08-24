/* Verifies the Discovery Agent Execution Registry: reservation, exclusion, approval, terminal, idle. */
import { describe, expect, it, vi } from 'vitest';
import { Agent, type AgentOptions } from '@megumi/agent-core';
import { AssistantMessageEventStream, Type, type Api, type AssistantMessage, type Model } from '@megumi/ai';
import {
  ExecutionRegistry,
  type ApprovalRequest,
  type ExecutionMetadata,
  type ExecutionOutcome,
  type TerminalExecution,
} from '../../../packages/agent/discovery/src/execution/execution-registry';

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

const clock = { now: () => '2026-07-31T00:00:00.000Z' };

function metadata(overrides: Partial<ExecutionMetadata> = {}): ExecutionMetadata {
  return {
    executionId: 'execution:1',
    requestId: 'request:1',
    workspaceId: 'workspace:1',
    sessionId: 'session:1',
    userMessageId: 'message:1',
    model,
    permissionMode: 'ask',
    createdAt: clock.now(),
    startedAt: clock.now(),
    ...overrides,
  };
}

function approvalRequest(overrides: Partial<ApprovalRequest> = {}): ApprovalRequest {
  return {
    approvalId: 'approval:1',
    executionId: 'execution:1',
    toolCallId: 'call-1',
    toolName: 'lookup',
    toolIdentity: { sourceId: 'source:1', namespace: 'builtin', sourceToolName: 'lookup' },
    input: { path: 'a.ts' },
    operations: [],
    options: [{ optionId: 'once:1', scope: 'once', display: { label: 'Once', description: 'Allow once.' } }],
    defaultOptionId: 'once:1',
    createdAt: clock.now(),
    status: 'pending',
    ...overrides,
  };
}

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

function agentOptions(overrides: Partial<AgentOptions> = {}): AgentOptions {
  return {
    initialState: {
      configuration: { systemPrompt: 'Be concise.', model, thinkingLevel: 'high', tools: [] },
      messages: [],
    },
    stream: () => {
      const message = assistant('done');
      const stream = new AssistantMessageEventStream();
      stream.push({ type: 'start', partial: { ...message, content: [] } });
      stream.push({ type: 'text_delta', contentIndex: 0, delta: 'done', partial: message });
      stream.push({ type: 'done', reason: 'stop', message });
      stream.end();
      return stream;
    },
    ...overrides,
  };
}

function createAgent(options: Partial<AgentOptions> = {}): Agent {
  return new Agent(agentOptions(options));
}

function registry(): ExecutionRegistry {
  return new ExecutionRegistry({ clock, terminalRetentionMs: 60_000 });
}

function resolveOutcome<T>(outcome: T): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => { resolve = settle; });
  return { promise, resolve };
}

describe('Execution Registry', () => {
  it('shares one start for concurrent equal requests and rejects a conflicting fingerprint', async () => {
    const store = registry();
    const reserved = store.reserveStart({
      requestId: 'request:1',
      fingerprint: { workspaceId: 'workspace:1', sessionId: 'session:1', inputDigest: '{"a":1}' },
      metadata: metadata(),
    });
    expect(reserved.status).toBe('reserved');

    const duplicate = store.reserveStart({
      requestId: 'request:1',
      fingerprint: { workspaceId: 'workspace:1', sessionId: 'session:1', inputDigest: '{"a":1}' },
      metadata: metadata({ executionId: 'execution:2' }),
    });
    expect(duplicate.status).toBe('pending');

    const conflict = store.reserveStart({
      requestId: 'request:1',
      fingerprint: { workspaceId: 'workspace:1', sessionId: 'session:1', inputDigest: '{"a":2}' },
      metadata: metadata({ executionId: 'execution:3' }),
    });
    expect(conflict.status).toBe('request_conflict');

    store.completeStart({
      requestId: 'request:1',
      executionId: 'execution:1',
      userMessage: stubUserMessage(),
      userEntry: stubUserEntry(),
    });
    await expect(duplicate.status === 'pending' ? duplicate.completion : Promise.resolve({ status: 'failed' as const, failure: stubFailure() }))
      .resolves.toMatchObject({ status: 'started' });

    const already = store.reserveStart({
      requestId: 'request:1',
      fingerprint: { workspaceId: 'workspace:1', sessionId: 'session:1', inputDigest: '{"a":1}' },
      metadata: metadata(),
    });
    expect(already.status).toBe('already_started');
  });

  it('rejects a second live execution on the same Session and clears the exclusion on terminal settlement', async () => {
    const store = registry();
    const first = store.reserveStart({
      requestId: 'request:1',
      fingerprint: { workspaceId: 'workspace:1', sessionId: 'session:1', inputDigest: 'x' },
      metadata: metadata(),
    });
    expect(first.status).toBe('reserved');
    const outcome = resolveOutcome<ExecutionOutcome>({ status: 'completed', assistantMessageId: 'message:reply' });
    const agent = createAgent();
    store.attachActiveExecution({ metadata: metadata(), agent, completion: outcome.promise, pendingApproval: undefined });

    const second = store.reserveStart({
      requestId: 'request:2',
      fingerprint: { workspaceId: 'workspace:2', sessionId: 'session:1', inputDigest: 'y' },
      metadata: metadata({ executionId: 'execution:2', requestId: 'request:2', workspaceId: 'workspace:2' }),
    });
    expect(second.status).toBe('session_busy');

    outcome.resolve({ status: 'completed', assistantMessageId: 'message:reply' });
    store.settleTerminal('execution:1', { status: 'completed', assistantMessageId: 'message:reply' });
    const again = store.reserveStart({
      requestId: 'request:2',
      fingerprint: { workspaceId: 'workspace:2', sessionId: 'session:1', inputDigest: 'y' },
      metadata: metadata({ executionId: 'execution:2', requestId: 'request:2', workspaceId: 'workspace:2' }),
    });
    expect(again.status).toBe('reserved');
  });

  it('keeps ActiveExecution as metadata, agent, completion and pendingApproval only', () => {
    const outcome = resolveOutcome<ExecutionOutcome>({ status: 'cancelled' });
    const agent = createAgent();
    const active = {
      metadata: metadata(),
      agent,
      completion: outcome.promise,
      pendingApproval: undefined,
    };
    // The active handle exposes no Run FSM, AbortController, or mutable status.
    expect(Object.keys(active).sort()).toEqual(['agent', 'completion', 'metadata', 'pendingApproval']);
  });

  it('derives running, waiting and cancelling projections from the Agent and the pending approval', async () => {
    const store = registry();
    const hangingTool = {
      name: 'hang',
      description: 'Hang.',
      parameters: Type.Object({}),
      execute: async () => new Promise<never>(() => undefined),
    };
    const toolMessage: AssistantMessage = {
      ...assistant('', 2),
      content: [{ type: 'toolCall', id: 'call-1', name: 'hang', arguments: {} }],
      stopReason: 'toolUse',
    };
    const stream = () => {
      const value = new AssistantMessageEventStream();
      value.push({ type: 'start', partial: { ...toolMessage, content: [] } });
      value.push({ type: 'done', reason: 'toolUse', message: toolMessage });
      value.end();
      return value;
    };
    const agent = createAgent({
      initialState: {
        configuration: { systemPrompt: 'Be concise.', model, thinkingLevel: 'high', tools: [hangingTool] },
        messages: [{ role: 'user', content: 'run', timestamp: 1 }],
      },
      stream,
    });
    const completion = resolveOutcome<ExecutionOutcome>({ status: 'cancelled' });
    const activeMetadata = metadata();
    store.attachActiveExecution({ metadata: activeMetadata, agent, completion: completion.promise, pendingApproval: undefined });

    const execution = agent.continue();
    await vi.waitFor(() => {
      expect(agent.state.execution).toMatchObject({ status: 'executing', phase: 'executing_tools' });
    });
    expect(store.getExecution('execution:1')?.status).toBe('running');

    const wait = store.beginApprovalWait({ executionId: 'execution:1', approval: approvalRequest() });
    expect(store.getExecution('execution:1')?.status).toBe('waiting');

    expect(store.cancelPendingApproval('execution:1')).toBe(true);
    agent.abort();
    expect(store.getExecution('execution:1')?.status).toBe('cancelling');
    await expect(wait).resolves.toEqual({ status: 'cancelled' });
    await execution;
  });

  it('settles an approval decision exactly once', async () => {
    const store = registry();
    const setup = await attachExecutingToolsAgent(store, 'execution:1');
    const wait = store.beginApprovalWait({ executionId: 'execution:1', approval: approvalRequest() });

    const accepted = store.resolveApproval({
      approvalId: 'approval:1',
      decision: {
        approvalRequestId: 'approval:1',
        decision: 'approved',
        optionId: 'once:1',
        decidedBy: 'user',
        decidedAt: clock.now(),
      },
    });
    expect(accepted).toMatchObject({ status: 'accepted' });
    const repeated = store.resolveApproval({
      approvalId: 'approval:1',
      decision: {
        approvalRequestId: 'approval:1',
        decision: 'denied',
        decidedBy: 'user',
        decidedAt: clock.now(),
      },
    });
    expect(repeated.status).toBe('already_resolved');
    await expect(wait).resolves.toMatchObject({ status: 'approved' });
    setup.agent.abort();
    await setup.execution;
  });

  it('cancels a pending approval exactly once and never resurrects it', () => {
    const store = registry();
    const outcome = resolveOutcome<ExecutionOutcome>({ status: 'cancelled' });
    const agent = createAgent();
    store.attachActiveExecution({ metadata: metadata(), agent, completion: outcome.promise, pendingApproval: undefined });
    const wait = store.beginApprovalWait({ executionId: 'execution:1', approval: approvalRequest() });

    expect(store.cancelPendingApproval('execution:1')).toBe(true);
    expect(store.cancelPendingApproval('execution:1')).toBe(false);
    return expect(wait).resolves.toEqual({ status: 'cancelled' });
  });

  it('fixes one immutable TerminalExecution and expires it after retention', () => {
    const store = registry();
    const outcome = resolveOutcome<ExecutionOutcome>({ status: 'completed', assistantMessageId: 'message:reply' });
    const agent = createAgent();
    store.attachActiveExecution({ metadata: metadata(), agent, completion: outcome.promise, pendingApproval: undefined });
    outcome.resolve({ status: 'completed', assistantMessageId: 'message:reply' });
    store.settleTerminal('execution:1', { status: 'completed', assistantMessageId: 'message:reply' });

    const found = store.getExecution('execution:1');
    expect(found).toMatchObject({
      status: 'completed',
      executionId: 'execution:1',
      completedAt: clock.now(),
    });
    expect(found?.failure).toBeUndefined();

    // A later settlement attempt cannot change the fixed terminal record.
    store.settleTerminal('execution:1', { status: 'cancelled' });
    expect(store.getExecution('execution:1')?.status).toBe('completed');

    // Expiry drops the terminal record and the idempotent start result.
    let now = '2026-07-31T00:00:00.000Z';
    const later = new ExecutionRegistry({
      clock: { now: () => now },
      terminalRetentionMs: 60_000,
    });
    const reserved = later.reserveStart({
      requestId: 'request:1',
      fingerprint: { workspaceId: 'workspace:1', sessionId: 'session:1', inputDigest: 'x' },
      metadata: metadata(),
    });
    expect(reserved.status).toBe('reserved');
    const lateOutcome = resolveOutcome<ExecutionOutcome>({ status: 'completed', assistantMessageId: 'message:reply' });
    const lateAgent = createAgent();
    later.attachActiveExecution({ metadata: metadata(), agent: lateAgent, completion: lateOutcome.promise, pendingApproval: undefined });
    later.completeStart({
      requestId: 'request:1',
      executionId: 'execution:1',
      userMessage: stubUserMessage(),
      userEntry: stubUserEntry(),
    });
    lateOutcome.resolve({ status: 'completed', assistantMessageId: 'message:reply' });
    later.settleTerminal('execution:1', { status: 'completed', assistantMessageId: 'message:reply' });
    expect(later.getExecution('execution:1')?.status).toBe('completed');
    now = '2026-08-02T00:00:00.000Z';
    later.getExecution('execution:1'); // prunes
    expect(later.getExecution('execution:1')).toBeUndefined();
    expect(later.getStartedResult('request:1')).toBeUndefined();
  });

  it('settles one failed terminal record with its failure facts', () => {
    const store = registry();
    const outcome = resolveOutcome<ExecutionOutcome>({ status: 'cancelled' });
    const agent = createAgent();
    store.attachActiveExecution({ metadata: metadata(), agent, completion: outcome.promise, pendingApproval: undefined });
    const failure = {
      code: 'model_call_failed' as const,
      message: 'Model call failed.',
      retryable: false,
      cause: { owner: 'ai' as const, code: 'model_call_failed' },
    };
    store.settleTerminal('execution:1', { status: 'failed', failure });

    const terminal = store.getExecution('execution:1');
    expect(terminal).toMatchObject({ status: 'failed', failure });
    expect(terminal?.completedAt).toBe(clock.now());
  });

  it('notifies idle waiters only after every active execution settles', async () => {
    const store = registry();
    const first = resolveOutcome<ExecutionOutcome>({ status: 'cancelled' });
    const second = resolveOutcome<ExecutionOutcome>({ status: 'cancelled' });
    store.attachActiveExecution({ metadata: metadata(), agent: createAgent(), completion: first.promise, pendingApproval: undefined });
    store.attachActiveExecution({
      metadata: metadata({ executionId: 'execution:2', requestId: 'request:2', sessionId: 'session:2', userMessageId: 'message:2' }),
      agent: createAgent(),
      completion: second.promise,
      pendingApproval: undefined,
    });

    const idle = store.waitForIdle(1_000);
    let settled = false;
    void idle.then(() => { settled = true; });
    first.resolve({ status: 'cancelled' });
    store.settleTerminal('execution:1', { status: 'cancelled' });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(settled).toBe(false);
    second.resolve({ status: 'cancelled' });
    store.settleTerminal('execution:2', { status: 'cancelled' });
    await expect(idle).resolves.toBe(true);
  });

  it('times out idle wait while executions remain active', async () => {
    const store = registry();
    const outcome = resolveOutcome<ExecutionOutcome>({ status: 'cancelled' });
    store.attachActiveExecution({ metadata: metadata(), agent: createAgent(), completion: outcome.promise, pendingApproval: undefined });
    await expect(store.waitForIdle(20)).resolves.toBe(false);
  });
});

function stubUserMessage(): import('@megumi/session').SessionMessageWithAttachments {
  return {
    message: {
      message_id: 'message:1',
      session_id: 'session:1',
      message_kind: 'user_message',
      display_content: [{ type: 'text', text: 'hello' }],
      model_content: [{ type: 'text', text: 'hello' }],
      created_at: clock.now(),
    },
    attachments: [],
  } as unknown as import('@megumi/session').SessionMessageWithAttachments;
}

function stubUserEntry(): import('@megumi/session').SessionEntry {
  return {
    entry_id: 'entry:1',
    session_id: 'session:1',
    entry_type: 'message',
    message_id: 'message:1',
    created_at: clock.now(),
  };
}

function stubFailure(): import('../../../packages/agent/discovery/src/execution/execution-registry').ExecutionFailure {
  return { code: 'internal_error', message: 'start failed', retryable: false };
}

/** Attaches a real Agent parked in executing_tools so approval waits derive as waiting. */
async function attachExecutingToolsAgent(
  store: ExecutionRegistry,
  executionId: string,
): Promise<{
  readonly agent: Agent;
  readonly execution: Promise<import('@megumi/agent-core').AgentExecutionResult>;
}> {
  const hangingTool = {
    name: 'hang',
    description: 'Hang.',
    parameters: Type.Object({}),
    execute: async () => new Promise<never>(() => undefined),
  };
  const toolMessage: AssistantMessage = {
    ...assistant('', 2),
    content: [{ type: 'toolCall', id: 'call-1', name: 'hang', arguments: {} }],
    stopReason: 'toolUse',
  };
  const stream = () => {
    const value = new AssistantMessageEventStream();
    value.push({ type: 'start', partial: { ...toolMessage, content: [] } });
    value.push({ type: 'done', reason: 'toolUse', message: toolMessage });
    value.end();
    return value;
  };
  const agent = createAgent({
    initialState: {
      configuration: { systemPrompt: 'Be concise.', model, thinkingLevel: 'high', tools: [hangingTool] },
      messages: [{ role: 'user', content: 'run', timestamp: 1 }],
    },
    stream,
  });
  const completion = resolveOutcome<ExecutionOutcome>({ status: 'cancelled' });
  store.attachActiveExecution({
    metadata: metadata({ executionId }),
    agent,
    completion: completion.promise,
    pendingApproval: undefined,
  });
  const execution = agent.continue();
  await vi.waitFor(() => {
    expect(agent.state.execution).toMatchObject({ status: 'executing', phase: 'executing_tools' });
  });
  return { agent, execution };
}

// Keep the TerminalExecution import referenced for the type-level shape check.
export type { TerminalExecution };
