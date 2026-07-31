/*
 * Exercises ContextService v2 orchestration through owner-owned service seams.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Api, AssistantMessage, Model } from '@megumi/ai';
import type { SessionHistoryItem } from '@megumi/agent/session';
import { ContextServiceImpl } from '@megumi/agent/context/service/context-service-impl';
import type { ContextServiceDependencies } from '@megumi/agent/context/service/context-service-impl';
import { composeAgentContext } from '@megumi/agent/context';

const model: Model<Api> = {
  id: 'gpt',
  name: 'GPT',
  api: 'openai-completions',
  provider: 'openai',
  baseUrl: 'https://api.example.com/v1',
  reasoning: true,
  input: ['text', 'image'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 100,
  maxTokens: 20,
};
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

function completedMessage(content = 'short'): AssistantMessage {
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
    models: { completeSimple: vi.fn(async () => completedMessage()) },
    contextTokenEstimator: vi.fn(() => counts.shift() ?? inputTokens.at(-1) ?? 0),
    usageSnapshotCache: new Map(),
    clock: { now: () => '2026-07-12T00:00:00.000Z' },
    ids: { preparationId: () => 'P1', compactionId: () => 'C1' },
  };
}

function request() {
  return { sessionId: 'S1', workspaceId: 'W1', currentRun, tools: [], model };
}

describe('ContextServiceImpl build', () => {
  it('queries history through the current user parent and derives capacity from Model', async () => {
    const deps = dependencies([50]);
    const result = await new ContextServiceImpl(deps).build(request());

    expect(deps.sessionService.getActiveHistory).toHaveBeenCalledWith({ session_id: 'S1', through_entry_id: 'E-assistant' });
    expect(deps.instructionService.getEffectiveAgentInstructions).toHaveBeenCalledWith({ workspaceRoot: '/workspace', workingDirectory: '/workspace/packages/app' });
    expect(result).toMatchObject({
      status: 'ready',
      prepared: {
        preparationId: 'P1',
        usage: { usedTokens: 50, contextWindowTokens: model.contextWindow },
      },
    });
    if (result.status === 'ready') {
      expect(result.prepared.context.messages.map((message) => message.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    }
  });

  it('loads the Skill catalog, selected Skill, dynamic use_skill source, Memory, and Tool definitions itself', async () => {
    const deps = dependencies([20]);
    const getSkillCatalog = vi.fn(async () => ({
      status: 'ok' as const,
      skills: [{ name: 'review', description: 'Review', skillPath: '/skills/review/SKILL.md' }],
    }));
    const useSkill = vi.fn(async () => ({
      status: 'ok' as const,
      skill: { name: 'selected', skillPath: '/skills/selected/SKILL.md', content: 'Selected instructions.' },
    }));
    deps.skillServiceFactory = vi.fn(() => ({ getSkillCatalog, useSkill }));
    const runWithSkillSource = {
      ...currentRun,
      runItems: [{
        type: 'tool_result' as const,
        toolCallId: 'TC1',
        toolName: 'use_skill',
        status: 'success' as const,
        content: [{ type: 'text' as const, text: 'loaded' }],
        runtimeSources: [{
          source_id: 'skill:dynamic',
          source_kind: 'skill',
          text: 'Dynamic instructions.',
          persisted: false,
          metadata: { name: 'dynamic', skillPath: '/skills/dynamic/SKILL.md' },
        }],
      }],
    };
    const result = await new ContextServiceImpl(deps).build({
      ...request(),
      currentRun: runWithSkillSource,
      selectedSkill: { type: 'skill', name: 'selected', skillPath: '/skills/selected/SKILL.md' },
      tools: [{
        name: 'read_file',
        description: 'Read a file',
        inputSchema: { type: 'object', properties: {} },
        capabilities: ['project_read'],
        riskLevel: 'low',
        sideEffect: 'none',
        availability: { status: 'available' },
      }],
    });

    expect(result).toMatchObject({ status: 'ready' });
    expect(getSkillCatalog).toHaveBeenCalledWith({});
    expect(useSkill).toHaveBeenCalledWith({ skillPath: '/skills/selected/SKILL.md' });
    if (result.status === 'ready') {
      expect(result.prepared.context.tools).toEqual([
        expect.objectContaining({ name: 'read_file', parameters: expect.any(Object) }),
      ]);
      const serialized = JSON.stringify(result.prepared.context.messages);
      expect(serialized).toContain('Selected instructions.');
      expect(serialized).toContain('Dynamic instructions.');
    }
  });

  it('returns owner-aware failures without using diagnostics as recovery input', async () => {
    const deps = dependencies([20]);
    expect(await new ContextServiceImpl(deps).build(request())).toMatchObject({ status: 'ready' });

    deps.instructionScopeResolver.resolve = vi.fn(() => ({ status: 'failed' as const, failure: { code: 'workspace_missing', message: 'missing' } }));
    expect(await new ContextServiceImpl(deps).build(request())).toEqual({
      status: 'failed',
      failure: expect.objectContaining({ code: 'instruction_load_failed', cause: { owner: 'instructions', code: 'workspace_missing' } }),
    });
  });

  it('returns context_window_exceeded when the final Context reaches the Model window', async () => {
    const deps = dependencies([100]);
    deps.sessionService.getActiveHistory = vi.fn(() => ({ status: 'ok' as const, history: [] }));
    expect(await new ContextServiceImpl(deps).build(request())).toMatchObject({ status: 'failed', failure: { code: 'context_window_exceeded' } });
  });

  it('continues above the soft threshold when no complete history can be compacted', async () => {
    const deps = dependencies([90]);
    deps.sessionService.getActiveHistory = vi.fn(() => ({ status: 'ok' as const, history: [] }));
    expect(await new ContextServiceImpl(deps).build(request())).toMatchObject({ status: 'ready', prepared: { usage: { usedTokens: 90 } } });
    expect(deps.models.completeSimple).not.toHaveBeenCalled();
  });
});

describe('composeAgentContext', () => {
  it('passes the injected Models collection directly to Context compaction', async () => {
    const deps = dependencies();
    const completeSimple = vi.fn(async () => ({
      ...completedMessage(),
      stopReason: 'error' as const,
      failure: { code: 'provider_failed' as const, message: 'summary failed', retryable: false },
    }));
    const context = composeAgentContext({
      sessionService: deps.sessionService,
      instructionScopeResolver: deps.instructionScopeResolver,
      instructionService: deps.instructionService,
      models: { completeSimple },
      contextTokenEstimator: vi.fn(() => 90),
      policy: { keepRecentRuns: 0 },
    });

    expect(await context.contextService.build(request())).toMatchObject({ status: 'failed', failure: { code: 'compaction_failed' } });
    expect(completeSimple).toHaveBeenCalledWith(
      model,
      expect.any(Object),
      expect.objectContaining({ sessionId: 'S1' }),
    );
  });
});
