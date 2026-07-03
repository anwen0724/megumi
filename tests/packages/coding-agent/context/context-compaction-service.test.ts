import { describe, expect, it, vi } from 'vitest';
import { ContextCompactionService } from '@megumi/coding-agent/context';
import type { SessionContext } from '@megumi/coding-agent/context';

describe('context compaction service', () => {
  it('returns skipped for short manual context', async () => {
    const service = createService({
      session_context: {
        session_id: 'session:1',
        sources: [{
          source_id: 'message:1',
          source_kind: 'session_message',
          text: 'short',
          persisted: true,
        }],
      },
    });

    await expect(service.compact({
      session_id: 'session:1',
      trigger: { kind: 'manual', requested_by: 'command' },
    })).resolves.toMatchObject({ status: 'skipped', reason: 'nothing_to_compact' });
  });

  it('returns stale_signal when auto usage no longer needs compaction', async () => {
    const service = createService({
      context_window_tokens: 10000,
      session_context: largeContext(),
    });

    await expect(service.compact({
      session_id: 'session:1',
      trigger: { kind: 'auto', reason: 'context_window_threshold', signal_id: 'signal:1' },
    })).resolves.toMatchObject({ status: 'skipped', reason: 'stale_signal' });
  });

  it('returns already_running for concurrent compaction on the same session', async () => {
    let resolveModel!: () => void;
    const modelCall = {
      completePrompt: vi.fn(() => new Promise<any>((resolve) => {
        resolveModel = () => resolve({ status: 'ok', text: 'summary' });
      })),
    };
    const service = createService({ modelCall, session_context: largeContext() });

    const first = service.compact({
      session_id: 'session:1',
      trigger: { kind: 'manual', requested_by: 'command' },
    });
    const second = await service.compact({
      session_id: 'session:1',
      trigger: { kind: 'manual', requested_by: 'command' },
    });
    resolveModel();
    await first;

    expect(second).toMatchObject({ status: 'skipped', reason: 'already_running' });
  });

  it('builds summary prompt, logs it before model call, and saves completed compaction', async () => {
    const calls: string[] = [];
    const repository = {
      saveContextCompaction: vi.fn(() => calls.push('save')),
    };
    const promptLog = {
      writePrompt: vi.fn(() => calls.push('log')),
    };
    const modelCall = {
      completePrompt: vi.fn(async ({ prompt }) => {
        calls.push('model');
        expect(prompt.purpose).toBe('context_compaction');
        expect(prompt.messages.map((message) => message.role)).toEqual(['system', 'user']);
        return { status: 'ok' as const, text: 'summary' };
      }),
    };
    const service = createService({ repository, promptLog, modelCall, session_context: largeContext() });

    const result = await service.compact({
      session_id: 'session:1',
      trigger: { kind: 'manual', requested_by: 'command' },
    });

    expect(result.status).toBe('completed');
    expect(calls.slice(0, 2)).toEqual(['log', 'model']);
    expect(promptLog.writePrompt).toHaveBeenCalledWith(expect.objectContaining({
      purpose: 'context_compaction',
      messages: expect.any(Array),
    }));
    expect(repository.saveContextCompaction).toHaveBeenCalledWith(expect.objectContaining({
      status: 'completed',
      summary: 'summary',
    }));
  });

  it('returns failed and does not save when model call fails', async () => {
    const repository = {
      saveContextCompaction: vi.fn(),
    };
    const service = createService({
      repository,
      session_context: largeContext(),
      modelCall: {
        completePrompt: vi.fn(async () => ({
          status: 'failed' as const,
          failure: { code: 'model_failed', message: 'model failed' },
        })),
      },
    });

    const result = await service.compact({
      session_id: 'session:1',
      trigger: { kind: 'manual', requested_by: 'command' },
    });

    expect(result).toMatchObject({ status: 'failed' });
    expect(repository.saveContextCompaction).not.toHaveBeenCalled();
  });
});

function createService(input: {
  session_context: SessionContext;
  context_window_tokens?: number;
  repository?: { saveContextCompaction: ReturnType<typeof vi.fn> };
  modelCall?: { completePrompt: ReturnType<typeof vi.fn> };
  promptLog?: { writePrompt: ReturnType<typeof vi.fn> };
}) {
  return new ContextCompactionService({
    contextService: {
      getSessionContext: vi.fn(async () => ({
        status: 'ok' as const,
        session_context: input.session_context,
      })),
    },
    repository: input.repository ?? { saveContextCompaction: vi.fn() },
    modelCall: input.modelCall ?? { completePrompt: vi.fn(async () => ({ status: 'ok' as const, text: 'summary' })) },
    clock: { now: () => '2026-07-03T00:00:00.000Z' },
    ids: {
      compactionId: () => 'compaction:1',
      eventId: vi.fn()
        .mockReturnValueOnce('event:started')
        .mockReturnValueOnce('event:completed')
        .mockReturnValueOnce('event:failed'),
      promptId: () => 'prompt:compact',
    },
    modelConfigProvider: () => ({
      model_id: 'test',
      context_window_tokens: input.context_window_tokens ?? 100,
    }),
    thresholdRatio: 0.8,
    promptResources: {
      context_compaction_prompt: 'Create a structured summary',
    },
    promptLog: input.promptLog,
  });
}

function largeContext(): SessionContext {
  return {
    session_id: 'session:1',
    sources: [
      {
        source_id: 'message:1',
        source_kind: 'session_message',
        text: 'old message '.repeat(100),
        persisted: true,
        created_at: '2026-07-03T00:00:00.000Z',
      },
      {
        source_id: 'message:2',
        source_kind: 'session_message',
        text: 'recent message 1',
        persisted: true,
        created_at: '2026-07-03T00:01:00.000Z',
      },
      {
        source_id: 'message:3',
        source_kind: 'session_message',
        text: 'recent message 2',
        persisted: true,
        created_at: '2026-07-03T00:02:00.000Z',
      },
    ],
  };
}
