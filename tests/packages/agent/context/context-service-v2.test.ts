/*
 * Exercises ContextService v2 orchestration through owner-owned service seams.
 */
import { describe, expect, it, vi } from 'vitest';
import type { SessionHistoryItem } from '@megumi/agent/session';
import { ContextServiceImpl } from '@megumi/agent/context/service/context-service-impl';
import type { ContextServiceDependencies } from '@megumi/agent/context/service/context-service-impl';
import { composeAgentContext } from '@megumi/agent/context';

const capacity = { providerId: 'openai', modelId: 'gpt', contextWindowTokens: 100 };
const currentRun = {
  runId: 'R-current',
  userEntry: { entryId: 'E-current', parentEntryId: 'E-assistant' },
  userMessage: { type: 'user_message' as const, content: [{ type: 'text' as const, text: 'now' }] },
  runItems: [{ type: 'assistant_message' as const, content: [{ type: 'text' as const, text: 'working' }] }],
};

function history(): SessionHistoryItem[] {
  return [
    { type: 'message', entry: { entry_id: 'E-user', session_id: 'S1', entry_type: 'message', message_id: 'M-user', created_at: 'now' }, message: { message_id: 'M-user', session_id: 'S1', run_id: 'R-old', message_kind: 'user_message', content: [{ type: 'text', text: 'before' }], created_at: 'now' }, attachments: [] },
    { type: 'message', entry: { entry_id: 'E-assistant', session_id: 'S1', parent_entry_id: 'E-user', entry_type: 'message', message_id: 'M-assistant', created_at: 'now' }, message: { message_id: 'M-assistant', session_id: 'S1', run_id: 'R-old', message_kind: 'assistant_reply', status: 'completed', reason_code: 'normal_completion', content: [{ type: 'text', text: 'done' }], created_at: 'now', completed_at: 'now' }, attachments: [] },
  ];
}

function dependencies(inputTokens: number[] = [50]): ContextServiceDependencies {
  const counts = [...inputTokens];
  return {
    sessionService: {
      readAttachmentContent: vi.fn(async () => ({ status: 'failed' as const, failure: { code: 'attachment_not_found', message: 'not found' } })),
      getActiveHistory: vi.fn(() => ({ status: 'ok' as const, history: history() })),
      saveCompactionSummary: vi.fn(() => ({ status: 'saved' as const, compaction: { compaction_id: 'C1', session_id: 'S1', summary_text: 'short', covered_until_entry_id: 'E-assistant', created_at: 'now' } })),
    },
    instructionScopeResolver: { resolve: vi.fn(() => ({ status: 'resolved' as const, workspaceRoot: '/workspace', workingDirectory: '/workspace/packages/app' })) },
    instructionService: {
      getSystemInstructions: vi.fn(() => [{ instructionId: 'system', content: 'system' }]),
      getEffectiveAgentInstructions: vi.fn(async () => ({ status: 'ok' as const, instructions: { sources: [] } })),
    },
    contextTokenEstimator: vi.fn(() => counts.shift() ?? inputTokens.at(-1) ?? 0),
    summaryModelCall: { complete: vi.fn(async () => ({ status: 'completed' as const, content: 'short' })) },
    usageSnapshotCache: new Map(),
    clock: { now: () => '2026-07-12T00:00:00.000Z' },
    ids: { preparationId: () => 'P1', compactionId: () => 'C1' },
  };
}

function request() {
  return { sessionId: 'S1', workspaceId: 'W1', currentRun, skillCatalog: [], usedSkills: [], tools: [], modelContext: capacity, imageInputSupport: true as const };
}

describe('ContextServiceImpl prepareModelCall', () => {
  it('queries history through the current user parent and builds one complete Context and usage', async () => {
    const deps = dependencies([50]);
    const result = await new ContextServiceImpl(deps).prepareModelCall(request());

    expect(deps.sessionService.getActiveHistory).toHaveBeenCalledWith({ session_id: 'S1', through_entry_id: 'E-assistant' });
    expect(deps.instructionService.getEffectiveAgentInstructions).toHaveBeenCalledWith({ workspaceRoot: '/workspace', workingDirectory: '/workspace/packages/app' });
    expect(result).toMatchObject({ status: 'ready', prepared: { preparationId: 'P1', usage: { usedTokens: 50 } } });
    if (result.status === 'ready') {
      expect(result.prepared.context.messages.map((message) => message.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    }
    expect(deps.contextTokenEstimator).toHaveBeenCalledTimes(1);
  });

  it('returns owner-aware failures without using diagnostics as recovery input', async () => {
    const deps = dependencies([20]);
    expect(await new ContextServiceImpl(deps).prepareModelCall(request())).toMatchObject({ status: 'ready' });

    deps.instructionScopeResolver.resolve = vi.fn(() => ({ status: 'failed' as const, failure: { code: 'workspace_missing', message: 'missing' } }));
    expect(await new ContextServiceImpl(deps).prepareModelCall(request())).toEqual({
      status: 'failed',
      failure: expect.objectContaining({ code: 'instruction_load_failed', cause: { owner: 'instructions', code: 'workspace_missing' } }),
    });
  });

  it('returns context_window_exceeded when the final Context reaches the hard window', async () => {
    const deps = dependencies([100]);
    deps.sessionService.getActiveHistory = vi.fn(() => ({ status: 'ok' as const, history: [] }));
    expect(await new ContextServiceImpl(deps).prepareModelCall(request())).toMatchObject({ status: 'failed', failure: { code: 'context_window_exceeded' } });
  });

  it('continues above the soft threshold when no complete history can be compacted', async () => {
    const deps = dependencies([90, 5]);
    deps.sessionService.getActiveHistory = vi.fn(() => ({ status: 'ok' as const, history: [] }));
    expect(await new ContextServiceImpl(deps).prepareModelCall(request())).toMatchObject({ status: 'ready', prepared: { usage: { usedTokens: 90 } } });
    expect(deps.summaryModelCall.complete).not.toHaveBeenCalled();
  });

  it('uses the current Settings-owned compaction threshold for each operation', async () => {
    const deps = dependencies([50]);
    deps.policyProvider = {
      getPolicy: vi.fn(() => ({ compactionThresholdRatio: 0.7 })),
    };

    const result = await new ContextServiceImpl(deps).prepareModelCall(request());

    expect(result).toMatchObject({
      status: 'ready',
      prepared: { usage: { compactionThresholdRatio: 0.7 } },
    });
    expect(deps.policyProvider.getPolicy).toHaveBeenCalledTimes(1);
  });
});

describe('composeAgentContext', () => {
  it('resolves provider runtime config outside Context for the compaction model call', async () => {
    const deps = dependencies();
    const resolve = vi.fn(() => ({ status: 'resolved' as const, modelConfig: { provider_id: 'openai', api: 'openai-completions' as const, base_url: 'https://api.example.com/v1', model_id: 'gpt', display_name: 'GPT', context_window_tokens: 100, max_output_tokens: 20, capabilities: { streaming: true, toolCalls: true, thinking: true, imageInput: true } } }));
    const modelCall = vi.fn(() => ({ status: 'failed' as const, failure: { code: 'model_call_failed' as const, message: 'summary failed', retryable: false } }));
    const context = composeAgentContext({
      sessionService: deps.sessionService,
      instructionScopeResolver: deps.instructionScopeResolver,
      instructionService: deps.instructionService,
      modelRuntimeConfigResolver: { resolve },
      contextTokenEstimator: vi.fn(() => 90),
      policy: { keepRecentRuns: 0 },
      modelCallService: { modelCall },
    });

    expect(await context.contextService.prepareModelCall(request())).toMatchObject({ status: 'failed', failure: { code: 'compaction_failed' } });
    expect(resolve).toHaveBeenCalledWith({ providerId: 'openai', modelId: 'gpt' });
    expect(modelCall).toHaveBeenCalledWith(expect.objectContaining({ context: expect.any(Object), model_config: expect.objectContaining({ provider_id: 'openai', model_id: 'gpt' }) }));
  });
});
