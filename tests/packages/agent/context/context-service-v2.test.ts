/*
 * Exercises ContextService v2 orchestration through owner-owned service seams.
 */
import { describe, expect, it, vi } from 'vitest';
import type { SessionHistoryItem } from '@megumi/agent/session';
import { ContextServiceImpl } from '@megumi/agent/context/service/context-service-impl';
import type { ContextServiceDependencies } from '@megumi/agent/context/service/context-service-impl';
import { composeAgentContext } from '@megumi/agent/context';

const capacity = { providerId: 'openai', modelId: 'gpt', contextWindowTokens: 100 };
const currentTurn = {
  runId: 'R-current',
  userEntry: { entryId: 'E-current', parentEntryId: 'E-assistant' },
  userMessage: { type: 'user_message' as const, content: [{ type: 'text' as const, text: 'now' }] },
  runItems: [{ type: 'assistant_message' as const, content: [{ type: 'text' as const, text: 'working' }] }],
};

function history(): SessionHistoryItem[] {
  return [
    { type: 'message', entry: { entry_id: 'E-user', session_id: 'S1', entry_type: 'message', message_id: 'M-user', created_at: 'now' }, message: { message_id: 'M-user', session_id: 'S1', run_id: 'R-old', conversation: { role: 'user', content: [{ type: 'text', text: 'before' }] }, created_at: 'now' }, attachments: [] },
    { type: 'message', entry: { entry_id: 'E-assistant', session_id: 'S1', parent_entry_id: 'E-user', entry_type: 'message', message_id: 'M-assistant', created_at: 'now' }, message: { message_id: 'M-assistant', session_id: 'S1', run_id: 'R-old', conversation: { role: 'assistant', content: [{ type: 'text', text: 'done' }] }, created_at: 'now' }, attachments: [] },
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
    skillService: { getSkillCatalog: vi.fn(async () => ({ status: 'ok' as const, skills: [] })) },
    promptTokenCounter: { count: vi.fn(async () => ({ status: 'counted' as const, inputTokens: counts.shift() ?? inputTokens.at(-1) ?? 0, accuracy: 'estimated' as const })) },
    summaryModelCall: { complete: vi.fn(async () => ({ status: 'completed' as const, content: 'short' })) },
    usageSnapshotCache: new Map(),
    clock: { now: () => '2026-07-12T00:00:00.000Z' },
    ids: { preparationId: () => 'P1', compactionId: () => 'C1' },
  };
}

function request() {
  return { sessionId: 'S1', workspaceId: 'W1', currentTurn, activatedSkills: [], tools: [], modelContext: capacity, imageInputSupport: true as const };
}

describe('ContextServiceImpl prepareModelCall', () => {
  it('queries history through the current user parent and builds one complete prompt and usage', async () => {
    const deps = dependencies([50]);
    const result = await new ContextServiceImpl(deps).prepareModelCall(request());

    expect(deps.sessionService.getActiveHistory).toHaveBeenCalledWith({ session_id: 'S1', through_entry_id: 'E-assistant' });
    expect(deps.instructionService.getEffectiveAgentInstructions).toHaveBeenCalledWith({ workspaceRoot: '/workspace', workingDirectory: '/workspace/packages/app' });
    expect(result).toMatchObject({ status: 'ready', prepared: { preparationId: 'P1', usage: { usedTokens: 50 } } });
    if (result.status === 'ready') {
      expect(result.prepared.prompt.conversation.map((item) => item.type)).toEqual(['user_message', 'assistant_message', 'user_message', 'assistant_message']);
    }
    expect(deps.promptTokenCounter.count).toHaveBeenCalledTimes(1);
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

  it('returns context_window_exceeded when the final prompt reaches the hard window', async () => {
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
  it('resolves provider runtime config outside Context before counting the complete Prompt', async () => {
    const deps = dependencies();
    const resolve = vi.fn(() => ({ status: 'resolved' as const, modelConfig: { provider_id: 'openai', protocol: 'openai-compatible' as const, model_id: 'gpt', capabilities: { streaming: true, toolCalls: true, thinking: true, imageInput: true } } }));
    const countPrompt = vi.fn(async () => ({ status: 'counted' as const, input_tokens: 10, accuracy: 'estimated' as const }));
    const context = composeAgentContext({
      sessionService: deps.sessionService,
      instructionScopeResolver: deps.instructionScopeResolver,
      instructionService: deps.instructionService,
      skillService: deps.skillService,
      modelRuntimeConfigResolver: { resolve },
      modelCallService: { countPrompt, modelCall: vi.fn() },
    });

    expect(await context.contextService.prepareModelCall(request())).toMatchObject({ status: 'ready' });
    expect(resolve).toHaveBeenCalledWith({ providerId: 'openai', modelId: 'gpt' });
    expect(countPrompt).toHaveBeenCalledWith(expect.objectContaining({ model_config: expect.objectContaining({ provider_id: 'openai', model_id: 'gpt' }) }));
  });
});
