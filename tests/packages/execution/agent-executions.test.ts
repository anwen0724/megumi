/* Verifies shared Agent Execution and conversation-submission operations. */
import { describe, expect, it, vi } from 'vitest';
import { Agent } from '@megumi/agent-core';
import { AssistantMessageEventStream, Type, type Api, type AssistantMessage, type Model } from '@megumi/ai';
import { createEventBus, type AnyEvent } from '@megumi/events';
import type { CommandTerminalResult } from '@megumi/commands';
import type { InputProcessor } from '@megumi/input';
import type {
  SessionBranchDrafts,
  SessionCatalog,
  SessionEntry,
  SessionHistory,
  SessionMessageWithAttachments,
} from '@megumi/session';
import {
  createAgentExecutions,
  createConversationSubmission,
  type AgentExecutions,
  ApprovalRequest,
  type ConversationSubmissionDependencies,
  ExecutionOutcome,
  LaunchedAgentExecution,
  LaunchAgentExecutionInput,
  type LaunchAgentExecution,
  type StartExecutionRequest,
  type SubmitConversationInputRequest,
  type SubmitConversationInputResult,
} from '@megumi/execution';

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
  kind: 'conversation',
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

const session = {
  session_id: 'session:1',
  workspace_id: 'workspace:1',
  title: 'hello',
  status: 'active',
  created_at: clock.now(),
  updated_at: clock.now(),
} as const;

interface LaunchHandle {
  readonly agent: Agent;
  readonly input: LaunchAgentExecutionInput;
  resolveOutcome(outcome: ExecutionOutcome): void;
  approve(outcome: ExecutionOutcome): void;
}

interface TestLaunch {
  readonly launch: LaunchAgentExecution;
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
      userMessage: stubUserMessage(input),
      userEntry: stubUserEntry(input),
      execute: () => outcome,
    };
  };
  return { launch, handles };
}

interface TestRuntime extends AgentExecutions {
  submitConversationInput(request: SubmitConversationInputRequest): Promise<SubmitConversationInputResult>;
}

interface TestRuntimeOptions {
  readonly launch: LaunchAgentExecution;
  readonly conversation: ConversationSubmissionDependencies;
}

function fixture(overrides: Partial<TestRuntimeOptions> = {}): {
  runtime: TestRuntime;
  published: AnyEvent[];
  testLaunch: TestLaunch;
} {
  const eventsBus = createEventBus();
  const published: AnyEvent[] = [];
  eventsBus.subscribe({}, (event) => { published.push(event); });
  const testLaunch = createTestLaunch();
  let executionNumber = 0;
  let messageNumber = 0;
  const conversationDependencies: ConversationSubmissionDependencies = overrides.conversation ?? {
    input: {} as Pick<InputProcessor<CommandTerminalResult>, 'process'>,
    sessions: {} as Pick<SessionCatalog, 'getSession' | 'createSession'>,
    history: {} as Pick<SessionHistory, 'getCommittedBranch'>,
    branches: {} as Pick<SessionBranchDrafts, 'resolveBranchDraft' | 'commitBranchDraft'>,
    resolveModel: async () => ({ status: 'ok', model }),
  };
  const executions = createAgentExecutions({
    ids: {
      createExecutionId: () => `execution:${++executionNumber}`,
      createSessionMessageId: () => `message:${++messageNumber}`,
    },
    clock,
    terminalRetentionMs: 60_000,
    events: eventsBus,
    launch: overrides.launch ?? testLaunch.launch,
  });
  const conversation = createConversationSubmission({
    dependencies: conversationDependencies,
    startExecution: (request) => executions.start(request),
  });
  return {
    runtime: {
      ...executions,
      submitConversationInput: (request) => conversation.submit(request),
    },
    published,
    testLaunch,
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

describe('Agent Executions and conversation submission', () => {
  it('starts Candidate Supply as a background execution with its fixed Run Context', async () => {
    let launched: LaunchAgentExecutionInput | undefined;
    const settled = vi.fn();
    const executions = createAgentExecutions({
      ids: { createExecutionId: () => 'execution:supply', createSessionMessageId: () => 'unused' },
      clock,
      terminalRetentionMs: 60_000,
      events: createEventBus(),
      launch: async (input) => {
        launched = input;
        const agent = new Agent({
          initialState: {
            configuration: { systemPrompt: '', model, thinkingLevel: 'minimal', tools: [] },
            messages: [],
          },
          stream: () => new AssistantMessageEventStream(),
        });
        return { agent, execute: async () => ({ status: 'completed' }) };
      },
    });
    const started = await executions.start({
      kind: 'candidate_supply', requestId: 'request:supply', model,
      material: {
        pool: {
          counts: { available: 0 }, lowWatermark: 10, target: 20, hardLimit: 40,
          totalShortfall: 20, uncoveredInterestIds: [], consumerShortfalls: [],
        },
        interests: [], negativeConstraints: [], sources: [], recentQueryOutcomes: [], pendingCandidates: [],
        budget: { searchesRemaining: 12, readsRemaining: 40, rawResultsRemaining: 200 },
      },
      accept: async () => ({ status: 'accepted' }),
      onSettled: settled,
    });

    expect(started.status).toBe('started');
    expect(launched).toMatchObject({
      kind: 'candidate_supply',
      runContext: { kind: 'candidate_supply', executionId: 'execution:supply' },
    });
    if (started.status === 'started') await started.completion;
    await vi.waitFor(() => expect(settled).toHaveBeenCalledWith({
      executionId: 'execution:supply', outcome: { status: 'completed' },
    }));
  });

  it('does not create a Session or start an execution when Input completes the request', async () => {
    const createSession = vi.fn();
    const { runtime, testLaunch } = fixture({
      conversation: {
        input: {
          process: async () => ({
            status: 'completed',
            result: { type: 'completed', message: 'done' },
          }),
        },
        sessions: {
          getSession: vi.fn(),
          createSession,
        },
        history: { getCommittedBranch: vi.fn() },
        branches: {
          resolveBranchDraft: vi.fn(),
          commitBranchDraft: vi.fn(),
        },
        resolveModel: async () => ({ status: 'ok', model }),
      },
    });

    const result = await runtime.submitConversationInput({
      requestId: 'request:command',
      workspaceId: 'workspace:1',
      text: '/test',
      modelSelection: { providerId: 'test-provider', modelId: 'test-model' },
      permissionMode: 'ask',
    });

    expect(result).toEqual({
      status: 'completed',
      requestId: 'request:command',
      message: 'done',
    });
    expect(createSession).not.toHaveBeenCalled();
    expect(testLaunch.handles).toHaveLength(0);
  });

  it('creates a Session only after Input accepts and then starts one execution', async () => {
    const order: string[] = [];
    const { runtime, testLaunch } = fixture({
      conversation: {
        input: {
          process: async (request) => {
            order.push('input');
            expect(request.context).toMatchObject({ workspaceId: 'workspace:1', model });
            return {
              status: 'accepted',
              input: {
                displayContent: [{ type: 'text', text: 'hello' }],
                modelContent: [{ type: 'text', text: 'hello' }],
                attachments: [],
              },
            };
          },
        },
        sessions: {
          getSession: vi.fn(),
          createSession: (request) => {
            order.push('session');
            expect(request).toMatchObject({ workspace_id: 'workspace:1', initial_user_text: 'hello' });
            return { status: 'created', session };
          },
        },
        history: { getCommittedBranch: vi.fn() },
        branches: {
          resolveBranchDraft: vi.fn(),
          commitBranchDraft: vi.fn(),
        },
        resolveModel: async (selection) => {
          order.push('model');
          expect(selection).toEqual({ providerId: 'test-provider', modelId: 'test-model' });
          return { status: 'ok', model };
        },
      },
    });

    const result = await runtime.submitConversationInput({
      requestId: 'request:accepted',
      workspaceId: 'workspace:1',
      text: 'hello',
      modelSelection: { providerId: 'test-provider', modelId: 'test-model' },
      permissionMode: 'ask',
    });

    expect(order).toEqual(['model', 'input', 'session']);
    expect(result.status).toBe('agent_started');
    if (result.status !== 'agent_started') throw new Error('unreachable');
    expect(result.session).toEqual(session);
    expect(result.execution).toMatchObject({ sessionId: 'session:1' });
    expect(testLaunch.handles).toHaveLength(1);
  });

  it('starts two independent Sessions from the same authoritative Recommendation', async () => {
    let sessionNumber = 0;
    const createSession = vi.fn(() => {
      const id = `session:recommendation:${++sessionNumber}`;
      return { status: 'created' as const, session: { ...session, session_id: id } };
    });
    const recommendation = {
      recommendationId: 'recommendation:1', batchId: 'batch:1', localDate: '2026-08-22', position: 0,
      sourceId: 'open-web' as const, sourceName: 'GitHub', canonicalUrl: 'https://example.com/agent',
      contentType: 'article' as const, title: 'Agent runtime', author: 'Example',
      description: 'A concrete implementation.', recommendationReason: 'Relevant to your interests.',
      hidden: false, favorite: false, watchLater: false, publishedAt: '2026-08-22T00:00:00.000Z',
    };
    const { runtime, testLaunch } = fixture({
      conversation: {
        input: { process: async () => ({
          status: 'accepted',
          input: {
            displayContent: [{ type: 'text', text: '聊聊这个项目' }],
            modelContent: [{ type: 'text', text: '聊聊这个项目' }],
            attachments: [],
          },
        }) },
        sessions: { getSession: vi.fn(), createSession },
        history: { getCommittedBranch: vi.fn() },
        branches: { resolveBranchDraft: vi.fn(), commitBranchDraft: vi.fn() },
        resolveModel: async () => ({ status: 'ok', model }),
        recommendations: { readRecommendationReference: () => ({
          type: 'recommendation_reference', recommendationId: recommendation.recommendationId,
          sourceName: recommendation.sourceName, canonicalUrl: recommendation.canonicalUrl,
          title: recommendation.title, author: recommendation.author, description: recommendation.description,
          recommendationReason: recommendation.recommendationReason,
        }) },
      },
    });

    const base = {
      workspaceId: 'workspace:1', recommendationId: 'recommendation:1', text: '聊聊这个项目',
      modelSelection: { providerId: 'test-provider', modelId: 'test-model' },
    } as const;
    const first = await runtime.submitConversationInput({ ...base, requestId: 'request:recommendation:1' });
    const second = await runtime.submitConversationInput({ ...base, requestId: 'request:recommendation:2' });

    expect(first.status).toBe('agent_started');
    expect(second.status).toBe('agent_started');
    if (first.status !== 'agent_started' || second.status !== 'agent_started') throw new Error('unreachable');
    expect(first.session.session_id).not.toBe(second.session.session_id);
    expect(testLaunch.handles.map((handle) => handle.input.recommendationReference)).toEqual([
      expect.objectContaining({ recommendationId: 'recommendation:1', title: 'Agent runtime' }),
      expect.objectContaining({ recommendationId: 'recommendation:1', title: 'Agent runtime' }),
    ]);
  });

  it('rejects unavailable Recommendation drafts and existing-Session injection before creating a Session', async () => {
    const createSession = vi.fn();
    const process = vi.fn(async () => ({
      status: 'accepted' as const,
      input: {
        displayContent: [{ type: 'text' as const, text: '聊聊它' }],
        modelContent: [{ type: 'text' as const, text: '聊聊它' }],
        attachments: [],
      },
    }));
    const { runtime, testLaunch } = fixture({
      conversation: {
        input: { process },
        sessions: { getSession: vi.fn(), createSession },
        history: { getCommittedBranch: vi.fn() },
        branches: { resolveBranchDraft: vi.fn(), commitBranchDraft: vi.fn() },
        resolveModel: async () => ({ status: 'ok', model }),
        recommendations: { readRecommendationReference: () => undefined },
      },
    });

    const missing = await runtime.submitConversationInput({
      requestId: 'request:missing', workspaceId: 'workspace:1', recommendationId: 'recommendation:missing',
      text: '聊聊它', modelSelection: { providerId: 'test-provider', modelId: 'test-model' },
    });
    const existing = await runtime.submitConversationInput({
      requestId: 'request:existing', workspaceId: 'workspace:1', sessionId: 'session:1',
      recommendationId: 'recommendation:1', text: '注入已有会话',
      modelSelection: { providerId: 'test-provider', modelId: 'test-model' },
    });

    expect(missing).toMatchObject({ status: 'failed', failure: { code: 'recommendation_not_found' } });
    expect(existing).toMatchObject({ status: 'failed', failure: { code: 'recommendation_requires_new_session' } });
    expect(createSession).not.toHaveBeenCalled();
    expect(testLaunch.handles).toHaveLength(0);
  });

  it('does not process Input or create a Session when model resolution fails', async () => {
    const process = vi.fn();
    const createSession = vi.fn();
    const { runtime, testLaunch } = fixture({
      conversation: {
        input: { process },
        sessions: { getSession: vi.fn(), createSession },
        history: { getCommittedBranch: vi.fn() },
        branches: {
          resolveBranchDraft: vi.fn(),
          commitBranchDraft: vi.fn(),
        },
        resolveModel: async () => ({
          status: 'failed',
          failure: { code: 'model_unavailable', message: 'Model is unavailable.' },
        }),
      },
    });

    const result = await runtime.submitConversationInput({
      requestId: 'request:model-failure',
      workspaceId: 'workspace:1',
      text: 'hello',
      modelSelection: { providerId: 'missing', modelId: 'missing' },
    });

    expect(result).toMatchObject({
      status: 'failed',
      failure: { message: 'Model is unavailable.' },
    });
    expect(process).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
    expect(testLaunch.handles).toHaveLength(0);
  });

  it('does not create a Session or start an execution when Input rejects the request', async () => {
    const createSession = vi.fn();
    const { runtime, testLaunch } = fixture({
      conversation: {
        input: {
          process: async () => ({
            status: 'failed',
            failure: { code: 'input_empty', message: 'Input is empty.' },
          }),
        },
        sessions: { getSession: vi.fn(), createSession },
        history: { getCommittedBranch: vi.fn() },
        branches: {
          resolveBranchDraft: vi.fn(),
          commitBranchDraft: vi.fn(),
        },
        resolveModel: async () => ({ status: 'ok', model }),
      },
    });

    const result = await runtime.submitConversationInput({
      requestId: 'request:rejected',
      workspaceId: 'workspace:1',
      text: '',
      modelSelection: { providerId: 'test-provider', modelId: 'test-model' },
    });

    expect(result).toMatchObject({
      status: 'failed',
      failure: { message: 'Input is empty.' },
    });
    expect(createSession).not.toHaveBeenCalled();
    expect(testLaunch.handles).toHaveLength(0);
  });

  it('resolves and commits a branch around the started user entry', async () => {
    const commitBranchDraft = vi.fn(() => ({
      status: 'committed' as const,
      branch_draft: {
        branch_marker_id: 'branch:1',
        session_id: 'session:1',
        source_message_id: 'message:source',
        source_entry_id: 'entry:source',
        created_at: clock.now(),
      },
    }));
    const getCommittedBranch = vi.fn(() => ({
      status: 'found' as const,
      branch: {
        type: 'branch' as const,
        branchId: 'branch:committed',
        sourceEntryId: 'entry:source',
        sourceMessageId: 'message:source',
        targetEntryId: 'entry:message:1',
        targetMessageId: 'message:1',
        createdAt: clock.now(),
      },
    }));
    const { runtime } = fixture({
      conversation: {
        input: {
          process: async () => ({
            status: 'accepted',
            input: {
              displayContent: [{ type: 'text', text: 'continue here' }],
              modelContent: [{ type: 'text', text: 'continue here' }],
              attachments: [],
            },
          }),
        },
        sessions: {
          getSession: () => ({ status: 'found', session }),
          createSession: vi.fn(),
        },
        history: { getCommittedBranch },
        branches: {
          resolveBranchDraft: () => ({
            status: 'resolved',
            branch_draft: {
              branch_marker_id: 'branch:1',
              session_id: 'session:1',
              source_message_id: 'message:source',
              source_entry_id: 'entry:source',
              created_at: clock.now(),
            },
          }),
          commitBranchDraft,
        },
        resolveModel: async () => ({ status: 'ok', model }),
      },
    });

    const result = await runtime.submitConversationInput({
      requestId: 'request:branch',
      workspaceId: 'workspace:1',
      sessionId: 'session:1',
      branchMarkerId: 'branch:1',
      text: 'continue here',
      modelSelection: { providerId: 'test-provider', modelId: 'test-model' },
    });

    expect(result.status).toBe('agent_started');
    if (result.status !== 'agent_started') throw new Error('unreachable');
    expect(result.branchCommit).toMatchObject({
      branchMarkerId: 'branch:1',
      branch: { targetMessageId: 'message:1' },
    });
    expect(commitBranchDraft).toHaveBeenCalledWith({
      request_id: 'request:branch',
      session_id: 'session:1',
      branch_marker_id: 'branch:1',
    });
    expect(getCommittedBranch).toHaveBeenCalledWith({
      sessionId: 'session:1',
      targetEntryId: 'entry:message:1',
    });
  });

  it('preserves request-id idempotency when the same Session submission is retried', async () => {
    const { runtime, testLaunch } = fixture({
      conversation: {
        input: {
          process: async () => ({
            status: 'accepted',
            input: {
              displayContent: [{ type: 'text', text: 'hello' }],
              modelContent: [{ type: 'text', text: 'hello' }],
              attachments: [],
            },
          }),
        },
        sessions: {
          getSession: () => ({ status: 'found', session }),
          createSession: vi.fn(),
        },
        history: { getCommittedBranch: vi.fn() },
        branches: {
          resolveBranchDraft: vi.fn(),
          commitBranchDraft: vi.fn(),
        },
        resolveModel: async () => ({ status: 'ok', model }),
      },
    });
    const request = {
      requestId: 'request:retry',
      workspaceId: 'workspace:1',
      sessionId: 'session:1',
      text: 'hello',
      modelSelection: { providerId: 'test-provider', modelId: 'test-model' },
    } as const;

    const first = await runtime.submitConversationInput(request);
    const second = await runtime.submitConversationInput(request);

    expect(first.status).toBe('agent_started');
    expect(second.status).toBe('agent_started');
    if (first.status !== 'agent_started' || second.status !== 'agent_started') {
      throw new Error('unreachable');
    }
    expect(second.execution.executionId).toBe(first.execution.executionId);
    expect(testLaunch.handles).toHaveLength(1);
  });

  it('starts one execution, publishes the user message before run.started, and returns a running projection', async () => {
    const { runtime, published, testLaunch } = fixture();
    const started = await runtime.start(startRequest);
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
    const { runtime, testLaunch } = fixture();
    const first = runtime.start(startRequest);
    const duplicate = runtime.start(startRequest);
    const [firstResult, duplicateResult] = await Promise.all([first, duplicate]);
    expect(firstResult.status).toBe('started');
    expect(duplicateResult.status).toBe('already_started');
    expect(testLaunch.handles).toHaveLength(1);
    if (firstResult.status !== 'started' || duplicateResult.status !== 'already_started') throw new Error('unreachable');
    expect(duplicateResult.execution.executionId).toBe(firstResult.execution.executionId);

    const conflict = await runtime.start({
      ...startRequest,
      requestId: 'request:1',
      input: { ...startRequest.input, displayContent: [{ type: 'text', text: 'different' }] },
    });
    expect(conflict.status).toBe('failed');
    if (conflict.status !== 'failed') throw new Error('unreachable');
    expect(conflict.failure).toMatchObject({ code: 'runtime_protocol_violation' });
  });

  it('returns session busy while another execution on the same Session is live', async () => {
    const { runtime, testLaunch } = fixture();
    const started = await runtime.start(startRequest);
    expect(started.status).toBe('started');
    const busy = await runtime.start({
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
    const failingLaunch = vi.fn<LaunchAgentExecution>(async () => {
      throw new Error('launch exploded');
    });
    const { runtime } = fixture({ launch: failingLaunch });
    const failed = await runtime.start(startRequest);
    expect(failed.status).toBe('failed');
    if (failed.status !== 'failed') throw new Error('unreachable');
    expect(failed.failure).toMatchObject({ code: 'internal_error' });

    const retried = await runtime.start(startRequest);
    expect(retried.status).toBe('failed');
  });

  it('fixes one terminal outcome, publishes run.ended, and keeps terminal reads immutable', async () => {
    const { runtime, published, testLaunch } = fixture();
    const started = await runtime.start(startRequest);
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

    const found = runtime.get({ executionId: 'execution:1' });
    expect(found.status).toBe('found');
    if (found.status !== 'found') throw new Error('unreachable');
    expect(found.execution).toMatchObject({ status: 'completed', completedAt: clock.now() });
    const again = runtime.get({ executionId: 'execution:1' });
    if (again.status !== 'found') throw new Error('unreachable');
    expect(again.execution).toEqual(found.execution);
  });

  it('resolves one approval once and reports not_found and already_resolved afterwards', async () => {
    const { runtime, testLaunch } = fixture();
    const started = await runtime.start(startRequest);
    expect(started.status).toBe('started');
    const handle = testLaunch.handles[0]!;
    // The launch registers its pending approval through the real wait seam.
    const wait = handle.input.awaitApproval({ approval: approvalRequest('execution:1', 'approval:1') });

    const resolved = await runtime.resolveApproval({
      approvalId: 'approval:1',
      decision: { decision: 'approved', optionId: 'once:1' },
    });
    expect(resolved.status).toBe('accepted');
    if (resolved.status !== 'accepted') throw new Error('unreachable');
    expect(resolved.execution).toMatchObject({ executionId: 'execution:1' });
    await expect(wait).resolves.toMatchObject({ status: 'approved' });

    const repeated = await runtime.resolveApproval({
      approvalId: 'approval:1',
      decision: { decision: 'denied' },
    });
    expect(repeated.status).toBe('already_resolved');

    const missing = await runtime.resolveApproval({
      approvalId: 'approval:missing',
      decision: { decision: 'denied' },
    });
    expect(missing.status).toBe('not_found');
  });

  it('cancels by settling the pending approval before aborting the Agent and converges as cancelled', async () => {
    const { runtime, published, testLaunch } = fixture();
    const started = await runtime.start(startRequest);
    expect(started.status).toBe('started');
    const handle = testLaunch.handles[0]!;
    const abortSpy = vi.spyOn(handle.agent, 'abort');
    const approvalOrder: string[] = [];
    const wait = handle.input.awaitApproval({ approval: approvalRequest('execution:1', 'approval:1') });
    void wait.then((resolution) => {
      approvalOrder.push(`settled:${resolution.status}`);
      handle.resolveOutcome({ status: 'cancelled' });
    });

    const cancelled = await runtime.cancel({ executionId: 'execution:1' });
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
    const repeated = await runtime.cancel({ executionId: 'execution:1' });
    expect(repeated.status).toBe('already_terminal');
    const unknown = await runtime.cancel({ executionId: 'execution:missing' });
    expect(unknown.status).toBe('not_found');
  });

  it('reports already_cancelling for a repeated live cancel', async () => {
    const { runtime, testLaunch } = fixture();
    const started = await runtime.start(startRequest);
    expect(started.status).toBe('started');
    const handle = testLaunch.handles[0]!;
    const wait = handle.input.awaitApproval({ approval: approvalRequest('execution:1', 'approval:1') });

    const first = await runtime.cancel({ executionId: 'execution:1' });
    expect(first.status).toBe('cancellation_requested');
    const second = await runtime.cancel({ executionId: 'execution:1' });
    expect(second.status).toBe('already_cancelling');
    void wait;
  });

  it('reads active executions per Session through getActive', async () => {
    const { runtime } = fixture();
    const started = await runtime.start(startRequest);
    expect(started.status).toBe('started');
    const found = runtime.getActive({ sessionId: 'session:1' });
    expect(found.status).toBe('found');
    if (found.status !== 'found') throw new Error('unreachable');
    expect(found.execution.executionId).toBe('execution:1');
    const missing = runtime.getActive({ sessionId: 'session:missing' });
    expect(missing.status).toBe('not_found');
  });

  it('stops admission on shutdown, cancels active Agents, and waits for completion', async () => {
    const { runtime, testLaunch } = fixture();
    const started = await runtime.start(startRequest);
    expect(started.status).toBe('started');
    const handle = testLaunch.handles[0]!;
    const abortSpy = vi.spyOn(handle.agent, 'abort');
    const wait = handle.input.awaitApproval({ approval: approvalRequest('execution:1', 'approval:1') });
    void wait.then(() => handle.resolveOutcome({ status: 'cancelled' }));

    const shutdown = await runtime.shutdown({ timeoutMs: 2_000 });
    expect(shutdown.status).toBe('shut_down');
    expect(abortSpy).toHaveBeenCalledTimes(1);

    const after = await runtime.start(startRequest);
    expect(after.status).toBe('failed');
    if (after.status !== 'failed') throw new Error('unreachable');
    expect(after.failure).toMatchObject({ code: 'internal_error' });
  });

  it('returns timed_out with active projections when shutdown cannot wait out executions', async () => {
    const { runtime } = fixture();
    const started = await runtime.start(startRequest);
    expect(started.status).toBe('started');
    // The approval promise never settles; abort fires but the outcome stays open.
    const shutdown = await runtime.shutdown({ timeoutMs: 30 });
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
