/* Verifies Context is the sole owner that resolves Session image references for model calls. */
import { describe, expect, it, vi } from 'vitest';
import { ContextServiceImpl, type ContextServiceDependencies } from '@megumi/coding-agent/context/service/context-service-impl';
import type { SessionHistoryItem } from '@megumi/coding-agent/session';

const imageAttachment = {
  attachment_id: 'A-history', message_id: 'M-user', session_id: 'S1', type: 'image' as const,
  name: 'history.png', mime_type: 'image/png', source_type: 'host_reference' as const,
  source_value: 'A-history/original.png', created_at: '2026-07-14T00:00:00.000Z',
};

function history(): SessionHistoryItem[] {
  return [
    { type: 'message', entry: { entry_id: 'E-user', session_id: 'S1', entry_type: 'message', message_id: 'M-user', created_at: '2026-07-14T00:00:00.000Z' }, message: { message_id: 'M-user', session_id: 'S1', run_id: 'R-old', conversation: { role: 'user', content: [{ type: 'text', text: 'Earlier image' }] }, created_at: '2026-07-14T00:00:00.000Z' }, attachments: [imageAttachment] },
    { type: 'message', entry: { entry_id: 'E-answer', session_id: 'S1', parent_entry_id: 'E-user', entry_type: 'message', message_id: 'M-answer', created_at: '2026-07-14T00:00:01.000Z' }, message: { message_id: 'M-answer', session_id: 'S1', run_id: 'R-old', conversation: { role: 'assistant', content: [{ type: 'text', text: 'Earlier answer' }] }, created_at: '2026-07-14T00:00:01.000Z' }, attachments: [] },
  ];
}

function dependencies(
  counts = [10],
  summaryModelCall: ContextServiceDependencies['summaryModelCall']['complete'] = vi.fn(async () => ({ status: 'completed' as const, content: 'summary' })),
): ContextServiceDependencies {
  const queue = [...counts];
  return {
    sessionService: {
      getActiveHistory: vi.fn(() => ({ status: 'ok' as const, history: history() })),
      saveCompactionSummary: vi.fn(() => ({ status: 'saved' as const, compaction: { compaction_id: 'C1', session_id: 'S1', summary_text: 'summary', covered_until_entry_id: 'E-answer', created_at: 'now' } })),
      readAttachmentContent: vi.fn(async ({ attachment_id }) => ({ status: 'ok' as const, content: { media_type: 'image/png' as const, bytes: new Uint8Array([attachment_id === 'A-current' ? 2 : 1]) } })),
    },
    instructionScopeResolver: { resolve: () => ({ status: 'resolved', workspaceRoot: 'C:/w', workingDirectory: 'C:/w' }) },
    instructionService: { getSystemInstructions: () => [], getEffectiveAgentInstructions: async () => ({ status: 'ok', instructions: { sources: [] } }) },
    skillService: { getSkillCatalog: async () => ({ status: 'ok', skills: [] }) },
    promptTokenCounter: { count: vi.fn(async () => ({ status: 'counted' as const, inputTokens: queue.shift() ?? 10, accuracy: 'estimated' as const })) },
    summaryModelCall: { complete: summaryModelCall },
    usageSnapshotCache: new Map(),
    ids: { preparationId: () => 'P1', compactionId: () => 'C1' },
  };
}

const request = {
  sessionId: 'S1', workspaceId: 'W1', activatedSkills: [], tools: [],
  modelContext: { providerId: 'p', modelId: 'm', contextWindowTokens: 100 },
  currentTurn: {
    runId: 'R-current', userEntry: { entryId: 'E-current', parentEntryId: 'E-answer' },
    userMessage: { type: 'user_message' as const, content: [{ type: 'image' as const, source: { type: 'host_reference' as const, referenceId: 'A-current' } }] },
    runItems: [],
  },
};

describe('Context image materialization', () => {
  it('returns a complete Prompt with historical and current images resolved to Base64', async () => {
    const result = await new ContextServiceImpl(dependencies()).prepareModelCall(request);
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    const images = result.prepared.prompt.conversation.flatMap((item) =>
      item.type === 'user_message' ? item.content.filter((block) => block.type === 'image') : []);
    expect(images).toEqual([
      { type: 'image', source: { type: 'base64', mediaType: 'image/png', data: 'AQ==' } },
      { type: 'image', source: { type: 'base64', mediaType: 'image/png', data: 'Ag==' } },
    ]);
  });

  it('materializes images in the compaction summary model request', async () => {
    let summaryPrompt: Parameters<ContextServiceDependencies['summaryModelCall']['complete']>[0]['prompt'] | undefined;
    const summaryModelCall: ContextServiceDependencies['summaryModelCall']['complete'] = vi.fn(async (input) => {
      summaryPrompt = input.prompt;
      return { status: 'completed' as const, content: 'summary' };
    });
    const deps = dependencies([90, 30, 30], summaryModelCall);
    deps.policy = { compactionThresholdRatio: 0.8, keepRecentTurns: 0 };
    expect(await new ContextServiceImpl(deps).prepareModelCall(request)).toMatchObject({ status: 'ready' });
    expect(JSON.stringify(summaryPrompt)).toContain('"type":"base64"');
    expect(JSON.stringify(summaryPrompt)).not.toContain('host_reference');
  });
});
