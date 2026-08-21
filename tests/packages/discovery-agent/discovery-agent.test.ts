/* Verifies the public Discovery Agent operations: start, approval, cancel, read, shutdown. */
import { describe, expect, it, vi } from 'vitest';
import { Agent } from '@megumi/agent';
import { AssistantMessageEventStream, Type, type Api, type AssistantMessage, type Model } from '@megumi/ai';
import { createEventBus, type AnyEvent } from '@megumi/events';
import type { SessionEntry, SessionMessageWithAttachments } from '@megumi/session';
import {
  createDiscoveryAgent,
  type ApprovalRequest,
  type CreateDiscoveryAgentOptions,
  type DiscoveryAgent,
  type ExecutionOutcome,
  type LaunchedAgentExecution,
  type LaunchAgentExecutionInput,
  type StartExecutionRequest,
} from '@megumi/discovery-agent';

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

const startRequest: StartExecutionRequest = {
  requestId: 'request:1',
  workspaceId: 'workspace:1',
  sessionId: 'session:1',
  input: {
    displayContent: [{ type: 'text', text: 'hello' }],
    modelContent: [{ type: 'text', text: 'hello' }],
    attachments: [],
  },
  model,
  permissionMode: 'ask',
};

interface LaunchHandle {
  readonly agent: Agent;
  readonly input: LaunchAgentExecutionInput;
  resolveOutcome(outcome: ExecutionOutcome): void;
  approve(outcome: ExecutionOutcome): void;
}

interface TestLaunch {
  readonly launch: CreateDiscoveryAgentOptions['launch'];
  readonly handles: LaunchHandle[];
}

function createTestLaunch(): TestLaunch {
  const handles: LaunchHandle[] = [];
  const launch = async (input: LaunchAgentExecutionInput): Promise<LaunchedAgentExecution> => {
    let resolveOutcome!: (outcome: ExecutionOutcome) => void;
    const outcome = new Promise<ExecutionOutcome>((resolve) => { resolveOutcome = resolve; });
    // The control Agent parks in executing_tools so approval waits derive as waiting.
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
    const agent = new Agent({
      initialState: {
        configuration: { systemPrompt: 'test', model, thinkingLevel: 'minimal', tools: [hangingTool] },
        messages: [{ role: 'user', content: input.input.modelContent[0]?.text ?? '', timestamp: 1 }],
      },
      stream,
    });
    void agent.continue();
    await vi.waitFor(() => {
      expect(agent.state.execution).toMatchObject({ status: 'executing', phase: 'executing_tools' });
    });
    const handle: LaunchHandle = {
      agent,
      input,
      resolveOutcome,
      approve: (result) => resolveOutcome(result),
    };
    handles.push(handle);
    return {
      agent,
      outcome,
      userMessage: stubUserMessage(input),
      userEntry: stubUserEntry(input),
    };
  };
  return { launch, handles };
}

function fixture(overrides: Partial<CreateDiscoveryAgentOptions> = {}): {
  discoveryAgent: DiscoveryAgent;
  published: AnyEvent[];
  testLaunch: TestLaunch;
  options: CreateDiscoveryAgentOptions;
} {
  const eventsBus = createEventBus();
  const published: AnyEvent[] = [];
  eventsBus.subscribe({}, (event) => { published.push(event); });
  const testLaunch = createTestLaunch();
  let executionNumber = 0;
  let messageNumber = 0;
  let approvalNumber = 0;
  const options: CreateDiscoveryAgentOptions = {
    ids: {
      createExecutionId: () => `execution:${++executionNumber}`,
      createSessionMessageId: () => `message:${++messageNumber}`,
      createApprovalId: () => `approval:${++approvalNumber}`,
    },
    clock,
    terminalRetentionMs: 60_000,
    events: eventsBus,
    launch: testLaunch.launch,
    ...overrides,
  };
  return {
    discoveryAgent: createDiscoveryAgent(options),
    published,
    testLaunch,
    options,
  };
}

function collect(published: AnyEvent[], executionId: string): AnyEvent[] {
  return published.filter((event) => event.executionId === executionId);
}

function approvalRequest(executionId: string, approvalId: string): ApprovalRequest {
  return {
    approvalId,
    executionId,
    toolCallId: 'call-1',
    toolName: 'lookup',
    toolIdentity: { sourceId: 'source:1', namespace: 'builtin', sourceToolName: 'lookup' },
    input: { path: 'a.ts' },
    operations: [],
    options: [{ optionId: 'once:1', scope: 'once', display: { label: 'Once', description: 'Allow once.' } }],
    defaultOptionId: 'once:1',
    createdAt: clock.now(),
    status: 'pending',
  };
}

describe('Discovery Agent', () => {
  it('starts one execution, publishes the user message before run.started, and returns a running projection', async () => {
    const { discoveryAgent, published, testLaunch } = fixture();
    const started = await discoveryAgent.start(startRequest);
    expect(started.status).toBe('started');
    if (started.status !== 'started') throw new Error('unreachable');

    expect(started.execution).toMatchObject({
      executionId: 'execution:1',
      requestId: 'request:1',
      sessionId: 'session:1',
      status: 'running',
      model,
      permissionMode: 'ask',
    });
    expect(testLaunch.handles).toHaveLength(1);
    // The user message precedes run.started and carries no executionId (ordering contract).
    expect(published.map((event) => event.type)).toEqual([
      'message.started', 'message.ended', 'run.started',
    ]);
    expect(published[0]).toMatchObject({ type: 'message.started', payload: { role: 'user', messageId: 'message:1' } });
    expect(published[0].executionId).toBeUndefined();
    const executionEvents = collect(published, 'execution:1');
    expect(executionEvents.map((event) => event.type)).toEqual(['run.started']);
    expect(executionEvents.at(-1)).toMatchObject({
      type: 'run.started',
      executionId: 'execution:1',
      payload: { requestId: 'request:1', providerId: 'test-provider', modelId: 'test-model' },
    });
  });

  it('shares one launch across concurrent equal requests and rejects a different fingerprint', async () => {
    const { discoveryAgent, testLaunch } = fixture();
    const first = discoveryAgent.start(startRequest);
    const duplicate = discoveryAgent.start(startRequest);
    const [firstResult, duplicateResult] = await Promise.all([first, duplicate]);
    expect(firstResult.status).toBe('started');
    expect(duplicateResult.status).toBe('already_started');
    expect(testLaunch.handles).toHaveLength(1);
    if (firstResult.status !== 'started' || duplicateResult.status !== 'already_started') throw new Error('unreachable');
    expect(duplicateResult.execution.executionId).toBe(firstResult.execution.executionId);

    const conflict = await discoveryAgent.start({
      ...startRequest,
      requestId: 'request:1',
      input: { ...startRequest.input, displayContent: [{ type: 'text', text: 'different' }] },
    });
    expect(conflict.status).toBe('failed');
    if (conflict.status !== 'failed') throw new Error('unreachable');
    expect(conflict.failure).toMatchObject({ code: 'runtime_protocol_violation' });
  });

  it('returns session busy while another execution on the same Session is live', async () => {
    const { discoveryAgent, testLaunch } = fixture();
    const started = await discoveryAgent.start(startRequest);
    expect(started.status).toBe('started');
    const busy = await discoveryAgent.start({
      ...startRequest,
      requestId: 'request:2',
      workspaceId: 'workspace:2',
    });
    expect(busy.status).toBe('session_busy');
    if (busy.status !== 'session_busy') throw new Error('unreachable');
    expect(busy.activeExecution).toMatchObject({ executionId: 'execution:1', sessionId: 'session:1' });
    expect(testLaunch.handles).toHaveLength(1);
  });

  it('releases the reservation when the launch fails so the same request can start again', async () => {
    const failingLaunch = vi.fn<CreateDiscoveryAgentOptions['launch']>(async () => {
      throw new Error('launch exploded');
    });
    const { discoveryAgent } = fixture({ launch: failingLaunch });
    const failed = await discoveryAgent.start(startRequest);
    expect(failed.status).toBe('failed');
    if (failed.status !== 'failed') throw new Error('unreachable');
    expect(failed.failure).toMatchObject({ code: 'internal_error' });

    const retried = await discoveryAgent.start(startRequest);
    expect(retried.status).toBe('failed');
  });

  it('fixes one terminal outcome, publishes run.ended, and keeps terminal reads immutable', async () => {
    const { discoveryAgent, published, testLaunch } = fixture();
    const started = await discoveryAgent.start(startRequest);
    expect(started.status).toBe('started');
    if (started.status !== 'started') throw new Error('unreachable');

    testLaunch.handles[0]!.resolveOutcome({ status: 'completed', assistantMessageId: 'message:reply' });
    await vi.waitFor(() => {
      expect(collect(published, 'execution:1').map((event) => event.type)).toContain('run.ended');
    });
    const ended = collect(published, 'execution:1').filter((event) => event.type === 'run.ended');
    expect(ended).toHaveLength(1);
    expect(ended[0]).toMatchObject({
      executionId: 'execution:1',
      payload: { status: 'completed', assistantMessageId: 'message:reply' },
    });

    const found = discoveryAgent.get({ executionId: 'execution:1' });
    expect(found.status).toBe('found');
    if (found.status !== 'found') throw new Error('unreachable');
    expect(found.execution).toMatchObject({ status: 'completed', completedAt: clock.now() });
    const again = discoveryAgent.get({ executionId: 'execution:1' });
    if (again.status !== 'found') throw new Error('unreachable');
    expect(again.execution).toEqual(found.execution);
  });

  it('resolves one approval once and reports not_found and already_resolved afterwards', async () => {
    const { discoveryAgent, testLaunch } = fixture();
    const started = await discoveryAgent.start(startRequest);
    expect(started.status).toBe('started');
    const handle = testLaunch.handles[0]!;
    // The launch registers its pending approval through the real wait seam.
    const wait = handle.input.awaitApproval({ approval: approvalRequest('execution:1', 'approval:1') });

    const resolved = await discoveryAgent.resolveApproval({
      approvalId: 'approval:1',
      decision: { decision: 'approved', optionId: 'once:1' },
    });
    expect(resolved.status).toBe('accepted');
    if (resolved.status !== 'accepted') throw new Error('unreachable');
    expect(resolved.execution).toMatchObject({ executionId: 'execution:1' });
    await expect(wait).resolves.toMatchObject({ status: 'approved' });

    const repeated = await discoveryAgent.resolveApproval({
      approvalId: 'approval:1',
      decision: { decision: 'denied' },
    });
    expect(repeated.status).toBe('already_resolved');

    const missing = await discoveryAgent.resolveApproval({
      approvalId: 'approval:missing',
      decision: { decision: 'denied' },
    });
    expect(missing.status).toBe('not_found');
  });

  it('cancels by settling the pending approval before aborting the Agent and converges as cancelled', async () => {
    const { discoveryAgent, published, testLaunch } = fixture();
    const started = await discoveryAgent.start(startRequest);
    expect(started.status).toBe('started');
    const handle = testLaunch.handles[0]!;
    const abortSpy = vi.spyOn(handle.agent, 'abort');
    const approvalOrder: string[] = [];
    const wait = handle.input.awaitApproval({ approval: approvalRequest('execution:1', 'approval:1') });
    void wait.then((resolution) => {
      approvalOrder.push(`settled:${resolution.status}`);
      handle.resolveOutcome({ status: 'cancelled' });
    });

    const cancelled = await discoveryAgent.cancel({ executionId: 'execution:1' });
    expect(cancelled.status).toBe('cancellation_requested');
    if (cancelled.status !== 'cancellation_requested') throw new Error('unreachable');
    expect(cancelled.execution.status).toBe('cancelling');
    // The pending approval settles before the Agent abort fires.
    expect(abortSpy).toHaveBeenCalledTimes(1);
    expect(approvalOrder).toEqual(['settled:cancelled']);
    expect(collect(published, 'execution:1').map((event) => event.type)).toContain('run.cancel.requested');

    await vi.waitFor(() => {
      expect(collect(published, 'execution:1').map((event) => event.type)).toContain('run.ended');
    });
    const repeated = await discoveryAgent.cancel({ executionId: 'execution:1' });
    expect(repeated.status).toBe('already_terminal');
    const unknown = await discoveryAgent.cancel({ executionId: 'execution:missing' });
    expect(unknown.status).toBe('not_found');
  });

  it('reports already_cancelling for a repeated live cancel', async () => {
    const { discoveryAgent, testLaunch } = fixture();
    const started = await discoveryAgent.start(startRequest);
    expect(started.status).toBe('started');
    const handle = testLaunch.handles[0]!;
    const wait = handle.input.awaitApproval({ approval: approvalRequest('execution:1', 'approval:1') });

    const first = await discoveryAgent.cancel({ executionId: 'execution:1' });
    expect(first.status).toBe('cancellation_requested');
    const second = await discoveryAgent.cancel({ executionId: 'execution:1' });
    expect(second.status).toBe('already_cancelling');
    void wait;
  });

  it('reads active executions per Session through getActive', async () => {
    const { discoveryAgent } = fixture();
    const started = await discoveryAgent.start(startRequest);
    expect(started.status).toBe('started');
    const found = discoveryAgent.getActive({ sessionId: 'session:1' });
    expect(found.status).toBe('found');
    if (found.status !== 'found') throw new Error('unreachable');
    expect(found.execution.executionId).toBe('execution:1');
    const missing = discoveryAgent.getActive({ sessionId: 'session:missing' });
    expect(missing.status).toBe('not_found');
  });

  it('stops admission on shutdown, cancels active Agents, and waits for completion', async () => {
    const { discoveryAgent, testLaunch } = fixture();
    const started = await discoveryAgent.start(startRequest);
    expect(started.status).toBe('started');
    const handle = testLaunch.handles[0]!;
    const abortSpy = vi.spyOn(handle.agent, 'abort');
    const wait = handle.input.awaitApproval({ approval: approvalRequest('execution:1', 'approval:1') });
    void wait.then(() => handle.resolveOutcome({ status: 'cancelled' }));

    const shutdown = await discoveryAgent.shutdown({ timeoutMs: 2_000 });
    expect(shutdown.status).toBe('shut_down');
    expect(abortSpy).toHaveBeenCalledTimes(1);

    const after = await discoveryAgent.start(startRequest);
    expect(after.status).toBe('failed');
    if (after.status !== 'failed') throw new Error('unreachable');
    expect(after.failure).toMatchObject({ code: 'internal_error' });
  });

  it('returns timed_out with active projections when shutdown cannot wait out executions', async () => {
    const { discoveryAgent } = fixture();
    const started = await discoveryAgent.start(startRequest);
    expect(started.status).toBe('started');
    // The approval promise never settles; abort fires but the outcome stays open.
    const shutdown = await discoveryAgent.shutdown({ timeoutMs: 30 });
    expect(shutdown.status).toBe('timed_out');
    if (shutdown.status !== 'timed_out') throw new Error('unreachable');
    expect(shutdown.activeExecutions).toHaveLength(1);
    expect(shutdown.activeExecutions[0]).toMatchObject({ executionId: 'execution:1' });
  });
});

function stubUserMessage(input: LaunchAgentExecutionInput): SessionMessageWithAttachments {
  return {
    message: {
      message_id: input.metadata.userMessageId,
      session_id: input.metadata.sessionId,
      ...(input.metadata.executionId ? { execution_id: input.metadata.executionId } : {}),
      message_kind: 'user_message',
      display_content: [...input.input.displayContent],
      model_content: [...input.input.modelContent],
      created_at: input.metadata.createdAt,
    },
    attachments: [],
  } as unknown as SessionMessageWithAttachments;
}

function stubUserEntry(input: LaunchAgentExecutionInput): SessionEntry {
  return {
    entry_id: `entry:${input.metadata.userMessageId}`,
    session_id: input.metadata.sessionId,
    entry_type: 'message',
    message_id: input.metadata.userMessageId,
    created_at: input.metadata.createdAt,
  };
}
