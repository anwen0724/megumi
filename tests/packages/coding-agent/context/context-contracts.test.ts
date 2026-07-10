import { describe, expect, it } from 'vitest';
import type {
  BuildPromptRequest,
  CompactContextRequest,
  ContextCompaction,
  GetCurrentContextUsageRequest,
  GetSessionContextRequest,
  Prompt,
  PromptMessage,
  SessionContext,
  SessionContextUsage,
} from '@megumi/coding-agent/context';

describe('context contracts', () => {
  it('models session context as context facts, not final prompt', () => {
    const context: SessionContext = {
      session_id: 'session:1',
      workspace_id: 'workspace:1',
      sources: [{
        source_id: 'skill-catalog',
        source_kind: 'skill_catalog',
        text: 'hello',
        persisted: true,
        created_at: '2026-07-03T00:00:00.000Z',
        metadata: { origin_module: 'skills' },
      }],
    };
    const request: GetSessionContextRequest = {
      session_id: 'session:1',
      workspace_id: 'workspace:1',
      purpose: 'agent_response',
    };

    expect(context.sources[0].source_kind).toBe('skill_catalog');
    expect(context.sources[0].metadata?.origin_module).toBe('skills');
    expect(request.purpose).toBe('agent_response');
  });

  it('models prompt messages with neutral roles only', () => {
    const message: PromptMessage = {
      role: 'system',
      content: 'System instructions',
    };
    const prompt: Prompt = {
      prompt_id: 'prompt:1',
      purpose: 'agent_response',
      messages: [message],
      source_refs: [],
    };
    const request: BuildPromptRequest = {
      session_context: { session_id: 'session:1', sources: [] },
      purpose: 'agent_response',
    };

    expect(prompt.messages[0].role).toBe('system');
    expect(request).not.toHaveProperty('session_id');
  });

  it('models per-session usage monitor reads', () => {
    const request: GetCurrentContextUsageRequest = {
      session_id: 'session:1',
      workspace_id: 'workspace:1',
    };
    const usage: SessionContextUsage = {
      used_tokens: 100,
      context_window_tokens: 1000,
      remaining_tokens: 900,
      used_ratio: 0.1,
      auto_compaction_threshold_ratio: 0.8,
      should_auto_compact: false,
    };

    expect(request.session_id).toBe('session:1');
    expect(usage.should_auto_compact).toBe(false);
  });

  it('models completed compaction results separately from failed compact calls', () => {
    const request: CompactContextRequest = {
      session_id: 'session:1',
      trigger: { kind: 'manual', requested_by: 'command' },
    };
    const compaction: ContextCompaction = {
      compaction_id: 'compaction:1',
      session_id: 'session:1',
      trigger: request.trigger,
      summary: 'Summary',
      compacted_source_refs: [],
      preserved_source_refs: [],
      usage_before: {
        used_tokens: 900,
        context_window_tokens: 1000,
        remaining_tokens: 100,
        used_ratio: 0.9,
        auto_compaction_threshold_ratio: 0.8,
        should_auto_compact: true,
      },
      status: 'completed',
      created_at: '2026-07-03T00:00:00.000Z',
    };

    expect(compaction.status).toBe('completed');
  });
});
