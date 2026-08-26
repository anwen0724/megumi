/*
 * Verifies the Conversation product operation from accepted raw input through
 * its early Host acceptance and eventual Agent Execution settlement.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Api, Model } from '@megumi/ai';
import type { Observability } from '@megumi/observability';
import {
  createConversationSubmission,
  type ConversationSubmissionDependencies,
  type ExecutionOutcome,
  type StartExecutionResult,
} from '@megumi/execution';
import type { TraceJournalRecord } from '../../../packages/agent/observability/src/persistence/trace-journal-record';
import { createTraceRecorder } from '../../../packages/agent/observability/src/trace/trace-recorder';

const NOW = '2026-08-26T00:00:00.000Z';
const model: Model<Api> = {
  id: 'model:1', name: 'Test', api: 'test-api', provider: 'provider:1',
  baseUrl: 'https://example.invalid', reasoning: false, input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 8_192, maxTokens: 1_024,
};
const session = {
  session_id: 'session:1', workspace_id: 'workspace:1', title: 'Test', status: 'active',
  created_at: NOW, updated_at: NOW,
} as const;
const acceptedInput = {
  displayContent: [{ type: 'text' as const, text: 'hello' }],
  modelContent: [{ type: 'text' as const, text: 'hello' }],
  attachments: [],
};

describe('Conversation Submission Trace', () => {
  it('records raw and processed Input and ends a terminal command as a short Trace', async () => {
    const records: TraceJournalRecord[] = [];
    const observability = recorder(records);
    const startExecution = vi.fn();
    const conversation = createConversationSubmission({
      dependencies: dependencies({
        observability,
        input: { process: async () => ({
          status: 'completed', result: { type: 'completed', message: 'handled' },
        }) },
      }),
      startExecution,
    });

    const result = await conversation.submit(request('request:terminal'));
    await conversation.shutdown();

    expect(result).toMatchObject({ status: 'completed', message: 'handled' });
    expect(startExecution).not.toHaveBeenCalled();
    expect(records.filter(isSpanStarted).map((record) => record.name))
      .toEqual(['session.resolve', 'model.resolve', 'input.process']);
    expect(records.filter(isContent).map((record) => record.kind))
      .toEqual(['input.received', 'input.processed']);
    expect(records.find(isTraceEnded)?.outcome).toEqual({ status: 'ok', code: 'completed' });
  });

  it('returns agent_started before completion and keeps the Trace open through cancellation', async () => {
    const records: TraceJournalRecord[] = [];
    const observability = recorder(records);
    const completion = deferred<ExecutionOutcome>();
    const startExecution = vi.fn(async () => startedExecution(
      observability.withSpan({
        name: 'agent.execution',
        correlation: { requestId: 'request:running', executionId: 'execution:1', sessionId: 'session:1' },
      }, () => completion.promise),
    ));
    const conversation = createConversationSubmission({
      dependencies: dependencies({ observability }),
      startExecution,
    });

    const result = await conversation.submit(request('request:running'));

    expect(result.status).toBe('agent_started');
    expect(records.some(isTraceEnded)).toBe(false);
    const shutdown = conversation.shutdown();
    let drained = false;
    void shutdown.then(() => { drained = true; });
    await Promise.resolve();
    expect(drained).toBe(false);

    completion.resolve({ status: 'cancelled' });
    await shutdown;

    expect(startExecution).toHaveBeenCalledOnce();
    expect(records.filter(isSpanStarted).map((record) => record.name))
      .toEqual(['session.resolve', 'model.resolve', 'input.process', 'agent.execution']);
    expect(records.find(isTraceEnded)?.outcome).toEqual({ status: 'cancelled', code: 'cancelled' });
  });

  it('traces only operations that actually occur for Recommendation, Session, and Branch preparation', async () => {
    const records: TraceJournalRecord[] = [];
    const observability = recorder(records);
    const completion = Promise.resolve<ExecutionOutcome>({
      status: 'completed', assistantMessageId: 'message:assistant',
    });
    const conversation = createConversationSubmission({
      dependencies: dependencies({
        observability,
        recommendations: { readRecommendationReference: () => ({
          type: 'recommendation_reference', recommendationId: 'recommendation:1',
          sourceName: 'Source', canonicalUrl: 'https://example.com/item', title: 'Item',
          description: 'Description', recommendationReason: 'Relevant',
        }) },
        sessions: {
          getSession: vi.fn(),
          createSession: () => ({ status: 'created', session }),
        },
        branches: {
          resolveBranchDraft: () => ({ status: 'resolved', branch_draft: {
            branch_marker_id: 'branch:1', session_id: 'session:1', source_message_id: 'message:source',
            source_entry_id: 'entry:source', created_at: NOW,
          } }),
          commitBranchDraft: () => ({ status: 'committed', branch_draft: {
            branch_marker_id: 'branch:1', session_id: 'session:1', source_message_id: 'message:source',
            source_entry_id: 'entry:source', created_at: NOW,
          } }),
        },
        history: { getCommittedBranch: () => ({ status: 'found', branch: {
          type: 'branch', branchId: 'branch:committed', sourceEntryId: 'entry:source',
          sourceMessageId: 'message:source', targetEntryId: 'entry:user',
          targetMessageId: 'message:user', createdAt: NOW,
        } }) },
      }),
      startExecution: async () => startedExecution(completion),
    });

    const result = await conversation.submit({
      ...request('request:full'), sessionId: undefined, recommendationId: 'recommendation:1',
      branchMarkerId: 'branch:1',
    });
    await conversation.shutdown();

    expect(result.status).toBe('agent_started');
    expect(records.filter(isSpanStarted).map((record) => record.name)).toEqual([
      'model.resolve',
      'input.process',
      'recommendation.reference.resolve',
      'session.create',
      'session.branch.resolve',
      'session.branch.commit',
    ]);
    expect(records.find(isTraceEnded)?.outcome).toEqual({ status: 'ok', code: 'completed' });
  });

  it('creates a short duplicate Trace and links it without awaiting the original completion', async () => {
    const records: TraceJournalRecord[] = [];
    const observability = recorder(records);
    const completion = deferred<ExecutionOutcome>();
    let observedCompletion: Promise<ExecutionOutcome> | undefined;
    let calls = 0;
    const conversation = createConversationSubmission({
      dependencies: dependencies({ observability }),
      startExecution: async () => {
        calls += 1;
        observedCompletion ??= observability.withSpan({
          name: 'agent.execution',
          correlation: { requestId: 'request:duplicate', executionId: 'execution:1', sessionId: 'session:1' },
        }, () => completion.promise);
        return startedExecution(observedCompletion, calls === 1 ? 'started' : 'already_started');
      },
    });

    const first = await conversation.submit(request('request:duplicate'));
    const duplicate = await conversation.submit(request('request:duplicate'));

    expect(first.status).toBe('agent_started');
    expect(duplicate.status).toBe('agent_started');
    await vi.waitFor(() => expect(records.filter(isTraceEnded)).toHaveLength(1));
    const endedBeforeOriginal = records.filter(isTraceEnded);
    expect(endedBeforeOriginal).toHaveLength(1);
    expect(endedBeforeOriginal[0]?.outcome).toEqual({ status: 'ok', code: 'already_started' });
    expect(records.filter((record) => record.type === 'trace.linked')).toHaveLength(1);

    completion.resolve({ status: 'completed', assistantMessageId: 'message:assistant' });
    await conversation.shutdown();
    expect(records.filter(isTraceEnded)).toHaveLength(2);
  });

  it('preserves the business result and single dispatch when Observability fails', async () => {
    const startExecution = vi.fn(async () => startedExecution(Promise.resolve({
      status: 'completed', assistantMessageId: 'message:assistant',
    })));
    const conversation = createConversationSubmission({
      dependencies: dependencies({ observability: throwingObservability() }),
      startExecution,
    });

    const result = await conversation.submit(request('request:diagnostic-failure'));
    await conversation.shutdown();

    expect(result.status).toBe('agent_started');
    expect(startExecution).toHaveBeenCalledOnce();
  });
});

function dependencies(
  overrides: Partial<ConversationSubmissionDependencies> = {},
): ConversationSubmissionDependencies {
  return {
    input: { process: async () => ({ status: 'accepted', input: acceptedInput }) },
    sessions: {
      getSession: () => ({ status: 'found', session }),
      createSession: () => ({ status: 'created', session }),
    },
    history: { getCommittedBranch: vi.fn() },
    branches: { resolveBranchDraft: vi.fn(), commitBranchDraft: vi.fn() },
    resolveModel: async () => ({ status: 'ok', model }),
    ...overrides,
  };
}

function request(requestId: string) {
  return {
    requestId,
    workspaceId: 'workspace:1',
    sessionId: 'session:1',
    text: 'hello',
    modelSelection: { providerId: 'provider:1', modelId: 'model:1' },
  };
}

function startedExecution(
  completion: Promise<ExecutionOutcome>,
  status: 'started' | 'already_started' = 'started',
): StartExecutionResult {
  return {
    status,
    completion,
    execution: {
      kind: 'conversation', executionId: 'execution:1', requestId: 'request:1',
      workspaceId: 'workspace:1', sessionId: 'session:1', userMessageId: 'message:user',
      status: 'running', phase: 'preparing_context', model, permissionMode: 'ask',
      createdAt: NOW, startedAt: NOW,
    },
    userMessage: { message: {
      message_id: 'message:user', session_id: 'session:1', execution_id: 'execution:1',
      message_kind: 'user_message', role: 'user', content: acceptedInput.displayContent, created_at: NOW,
    }, attachments: [] },
    userEntry: {
      entry_id: 'entry:user', session_id: 'session:1', entry_type: 'message',
      message_id: 'message:user', created_at: NOW,
    },
  };
}

function recorder(records: TraceJournalRecord[]) {
  let id = 0;
  return createTraceRecorder({
    enqueue: (record) => { records.push(record); },
    createId: () => `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}`,
    now: () => new Date(NOW),
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => { resolve = accept; });
  return { promise, resolve };
}

function throwingObservability(): Observability {
  const failure = () => { throw new Error('observability unavailable'); };
  return {
    withTrace: failure,
    withSpan: failure,
    recordContent: failure,
    recordEvent: failure,
    linkTrace: failure,
  } as Observability;
}

function isSpanStarted(record: TraceJournalRecord): record is Extract<TraceJournalRecord, { type: 'span.started' }> {
  return record.type === 'span.started';
}

function isContent(record: TraceJournalRecord): record is Extract<TraceJournalRecord, { type: 'content.recorded' }> {
  return record.type === 'content.recorded';
}

function isTraceEnded(record: TraceJournalRecord): record is Extract<TraceJournalRecord, { type: 'trace.ended' }> {
  return record.type === 'trace.ended';
}
