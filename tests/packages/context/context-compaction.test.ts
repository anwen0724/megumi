/* Verifies automatic and manual compaction share one policy, commit path, and per-Session lock. */
import type { Api, AssistantMessage, Model } from '@megumi/ai';
import type { SessionHistoryItem } from '@megumi/session';
import { describe, expect, it, vi } from 'vitest';
import {
  createContext,
  type CreateContextOptions,
  type CurrentConversationRun,
} from '../../../packages/context/src/index';

const model: Model<Api> = {
  id: 'gpt',
  name: 'GPT',
  api: 'openai-completions',
  provider: 'openai',
  baseUrl: 'https://api.example.com/v1',
  reasoning: false,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 100,
  maxTokens: 20,
};

const currentRun: CurrentConversationRun = {
  runId: 'run:current',
  userEntry: { entryId: 'entry:current', parentEntryId: 'entry:assistant:2' },
  userMessage: { type: 'user_message', content: [{ type: 'text', text: 'continue' }] },
  runItems: [],
};

function completedMessage(content: string): AssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text: content }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'stop',
    timestamp: 0,
  };
}

function runHistory(index: number): SessionHistoryItem[] {
  return [
    {
      type: 'message',
      entry: {
        entry_id: `entry:user:${index}`,
        session_id: 'session:1',
        ...(index > 1 ? { parent_entry_id: `entry:assistant:${index - 1}` } : {}),
        entry_type: 'message',
        message_id: `message:user:${index}`,
        created_at: 'now',
      },
      message: {
        message_id: `message:user:${index}`,
        session_id: 'session:1',
        run_id: `run:${index}`,
        message_kind: 'user_message',
        display_content: [{ type: 'text', text: `question ${index}` }],
        model_content: [{ type: 'text', text: `question ${index}` }],
        created_at: 'now',
      },
      attachments: [],
    },
    {
      type: 'message',
      entry: {
        entry_id: `entry:assistant:${index}`,
        session_id: 'session:1',
        parent_entry_id: `entry:user:${index}`,
        entry_type: 'message',
        message_id: `message:assistant:${index}`,
        created_at: 'now',
      },
      message: {
        message_id: `message:assistant:${index}`,
        session_id: 'session:1',
        run_id: `run:${index}`,
        message_kind: 'assistant_reply',
        status: 'completed',
        reason_code: 'normal_completion',
        content: [{ type: 'text', text: `answer ${index}` }],
        created_at: 'now',
        completed_at: 'now',
      },
      attachments: [],
    },
  ];
}

function fixture(
  counts: number[],
  completeSimple = vi.fn(async () => completedMessage('replacement summary')),
): CreateContextOptions {
  const history = [...runHistory(1), ...runHistory(2)];
  return {
    sessionHistory: {
      getActiveHistory: vi.fn(() => ({ status: 'ok' as const, history })),
      saveCompactionSummary: vi.fn((request) => ({
        status: 'saved' as const,
        compaction: {
          compaction_id: request.compaction_id,
          session_id: request.session_id,
          summary_text: request.summary_text,
          covered_until_entry_id: request.covered_until_entry_id,
          created_at: request.created_at,
        },
      })),
    },
    attachmentReader: { readAttachmentContent: vi.fn() },
    scopeResolver: {
      resolve: vi.fn(() => ({
        status: 'resolved' as const,
        workspaceRoot: '/workspace',
        executionEnvironment: {
          workingDirectory: '/workspace',
          operatingSystem: 'Linux',
          shell: 'POSIX shell',
        },
      })),
    },
    instructionReader: {
      getSystemInstructions: vi.fn(() => []),
      getEffectiveInstructions: vi.fn(async () => ({
        status: 'ok' as const,
        instructions: { sources: [] },
      })),
    },
    models: { completeSimple },
    contextTokenEstimator: vi.fn(() => counts.shift() ?? 20),
    policy: { keepRecentRuns: 1, compactionThresholdRatio: 0.8 },
    clock: { now: () => '2026-07-12T00:00:00.000Z' },
    ids: { preparationId: () => 'preparation:1', compactionId: () => 'compaction:1' },
  };
}

describe('Context compaction', () => {
  it('automatically compacts above the threshold and rebuilds from the committed Summary', async () => {
    const options = fixture([90, 20, 20]);
    const progress = vi.fn();
    const result = await createContext(options).build({
      sessionId: 'session:1',
      workspaceId: 'workspace:1',
      currentRun,
      tools: [],
      model,
      onCompactionProgress: progress,
    });

    expect(result).toMatchObject({
      status: 'ready',
      prepared: {
        compaction: { compactionId: 'compaction:1' },
        usage: { usedTokens: 20 },
      },
    });
    expect(options.sessionHistory.saveCompactionSummary).toHaveBeenCalledWith(expect.objectContaining({
      compaction_id: 'compaction:1',
      covered_until_entry_id: 'entry:assistant:1',
      first_kept_entry_id: 'entry:user:2',
      expected_active_entry_id: 'entry:current',
      append_to_active_path: true,
    }));
    expect(progress).toHaveBeenNthCalledWith(1, expect.objectContaining({ status: 'started' }));
    expect(progress).toHaveBeenNthCalledWith(2, expect.objectContaining({ status: 'completed' }));
  });

  it('uses the same compactor for manual requests and preserves nothing-to-compact semantics', async () => {
    const compacted = await createContext(fixture([70, 20])).compact({
      sessionId: 'session:1',
      workspaceId: 'workspace:1',
      model,
    });
    expect(compacted).toMatchObject({
      status: 'compacted',
      usageBefore: { usedTokens: 70 },
      usageAfter: { usedTokens: 20 },
    });

    const options: CreateContextOptions = {
      ...fixture([20]),
      policy: { keepRecentRuns: 2, compactionThresholdRatio: 0.8 },
    };
    expect(await createContext(options).compact({
      sessionId: 'session:1',
      workspaceId: 'workspace:1',
      model,
    })).toEqual({ status: 'nothing_to_compact', reason: 'no_older_runs' });
  });

  it('serializes concurrent compaction for the same Session', async () => {
    let release!: (message: AssistantMessage) => void;
    const first = new Promise<AssistantMessage>((resolve) => { release = resolve; });
    const completeSimple = vi.fn()
      .mockImplementationOnce(() => first)
      .mockImplementation(async () => completedMessage('second summary'));
    const context = createContext(fixture([70, 20, 70, 20], completeSimple));

    const one = context.compact({ sessionId: 'session:1', workspaceId: 'workspace:1', model });
    const two = context.compact({ sessionId: 'session:1', workspaceId: 'workspace:1', model });
    await vi.waitFor(() => expect(completeSimple).toHaveBeenCalledTimes(1));
    release(completedMessage('first summary'));
    await vi.waitFor(() => expect(completeSimple).toHaveBeenCalledTimes(2));
    await expect(Promise.all([one, two])).resolves.toEqual([
      expect.objectContaining({ status: 'compacted' }),
      expect.objectContaining({ status: 'compacted' }),
    ]);
  });

  it('does not persist cancelled or non-reducing summaries', async () => {
    const controller = new AbortController();
    controller.abort();
    const cancelledOptions = fixture([70]);
    expect(await createContext(cancelledOptions).compact({
      sessionId: 'session:1',
      workspaceId: 'workspace:1',
      model,
      signal: controller.signal,
    })).toMatchObject({ status: 'failed', failure: { code: 'cancelled' } });
    expect(cancelledOptions.sessionHistory.saveCompactionSummary).not.toHaveBeenCalled();

    const notReducingOptions = fixture([70, 70]);
    expect(await createContext(notReducingOptions).compact({
      sessionId: 'session:1',
      workspaceId: 'workspace:1',
      model,
    })).toEqual({ status: 'nothing_to_compact', reason: 'summary_not_reducing' });
    expect(notReducingOptions.sessionHistory.saveCompactionSummary).not.toHaveBeenCalled();
  });

  it('converts unexpected dependency exceptions into a stable compaction failure', async () => {
    const options = fixture([70]);
    options.sessionHistory.getActiveHistory = vi.fn(() => {
      throw new Error('database unavailable');
    });

    await expect(createContext(options).compact({
      sessionId: 'session:1',
      workspaceId: 'workspace:1',
      model,
    })).resolves.toEqual({
      status: 'failed',
      failure: {
        code: 'compaction_failed',
        message: 'database unavailable',
        retryable: false,
      },
    });
  });

  it('records manual compaction lifecycle and resulting token usage', async () => {
    const observability = {
      getCurrentTrace: vi.fn(() => undefined),
      recordLog: vi.fn(),
      recordMeasurement: vi.fn(),
    } as unknown as NonNullable<CreateContextOptions['observability']>;
    const options: CreateContextOptions = { ...fixture([70, 20]), observability };

    await expect(createContext(options).compact({
      sessionId: 'session:1',
      workspaceId: 'workspace:1',
      model,
    })).resolves.toMatchObject({ status: 'compacted' });

    expect(observability.recordLog).toHaveBeenNthCalledWith(1, expect.objectContaining({
      event: 'context.compaction.started',
      correlation: { sessionId: 'session:1' },
      attributes: expect.objectContaining({ beforeTokens: 70, automatic: false }),
    }));
    expect(observability.recordLog).toHaveBeenNthCalledWith(2, expect.objectContaining({
      event: 'context.compaction.completed',
      attributes: expect.objectContaining({ status: 'compacted', automatic: false }),
    }));
    expect(observability.recordMeasurement).toHaveBeenCalledWith({
      name: 'context.compaction.after_tokens',
      value: 20,
      unit: 'token',
      correlation: { sessionId: 'session:1' },
    });
  });
});
