import { describe, expect, it } from 'vitest';
import { buildPromptParts } from '@megumi/coding-agent/context/core/prompt-parts';

describe('prompt parts', () => {
  it('organizes session context sources into prompt parts', () => {
    const result = buildPromptParts({
      session_context: {
        session_id: 'session:1',
        sources: [
          {
            source_id: 'instruction:1',
            source_kind: 'agent_instruction',
            text: 'AGENTS instructions',
            persisted: false,
          },
          {
            source_id: 'summary:1',
            source_kind: 'context_compaction_summary',
            text: 'compaction summary',
            persisted: true,
          },
          {
            source_id: 'message:1',
            source_kind: 'session_message',
            text: 'session message',
            persisted: true,
          },
          {
            source_id: 'runtime:1',
            source_kind: 'runtime_fact',
            text: 'runtime fact',
            persisted: true,
          },
          {
            source_id: 'tool:1',
            source_kind: 'tool_result',
            text: 'Tool result',
            persisted: true,
          },
          {
            source_id: 'memory:1',
            source_kind: 'memory_recall_result',
            text: 'remember this',
            persisted: false,
          },
          {
            source_id: 'skill-catalog',
            source_kind: 'skill_catalog',
            text: 'Available Skills',
            persisted: false,
            metadata: { origin_module: 'skills' },
          },
          {
            source_id: 'skill:checks:test',
            source_kind: 'skill',
            text: 'Skill body',
            persisted: false,
            metadata: { origin_module: 'skills', skillId: 'checks:test' },
          },
        ],
      },
      purpose: 'agent_response',
    });

    expect(result.status).toBe('ok');
    const parts = result.status === 'ok' ? result.parts : [];

    expect(parts.map((part) => part.part_kind)).toEqual([
      'agent_instruction',
      'context_compaction_summary',
      'session_message',
      'runtime_fact',
      'tool_result',
      'skill_catalog',
      'skill',
      'memory',
    ]);
    expect(parts.find((part) => part.part_kind === 'agent_instruction')?.required).toBe(true);
    expect(parts.find((part) => part.part_kind === 'agent_instruction')?.trim_policy).toBe('none');
    expect(parts.find((part) => part.part_kind === 'skill_catalog')).toMatchObject({
      required: true,
      trim_policy: 'none',
      source_refs: [{ source_id: 'skill-catalog', source_kind: 'skill_catalog', origin_module: 'skills' }],
    });
    expect(parts.find((part) => part.part_kind === 'skill')).toMatchObject({
      required: true,
      trim_policy: 'none',
      source_refs: [{ source_id: 'skill:checks:test', source_kind: 'skill', origin_module: 'skills' }],
    });
    expect(parts.find((part) => part.part_kind === 'skill')?.text).toContain('<skill_content>');
  });

  it('excludes session messages covered by a compaction summary', () => {
    const result = buildPromptParts({
      session_context: {
        session_id: 'session:1',
        sources: [
          {
            source_id: 'summary:1',
            source_kind: 'context_compaction_summary',
            text: 'compaction summary',
            persisted: true,
            metadata: { covered_source_ids: ['message:covered'] },
          },
          {
            source_id: 'message:covered',
            source_kind: 'session_message',
            text: 'old covered message',
            persisted: true,
          },
        ],
      },
      purpose: 'agent_response',
    });

    expect(result.status).toBe('ok');
    const parts = result.status === 'ok' ? result.parts : [];

    expect(parts.some((part) => part.text.includes('old covered message'))).toBe(false);
    expect(parts.some((part) => part.text.includes('compaction summary'))).toBe(true);
  });

  it('marks the current user message as a current user message part', () => {
    const result = buildPromptParts({
      session_context: {
        session_id: 'session:1',
        sources: [{
          source_id: 'message:current',
          source_kind: 'session_message',
          text: 'current user request',
          persisted: true,
          metadata: { role: 'user' },
        }],
      },
      purpose: 'agent_response',
      current_user_message_id: 'message:current',
    });

    expect(result.status).toBe('ok');
    expect(result.status === 'ok' ? result.parts[0] : undefined).toMatchObject({
      part_kind: 'current_user_message',
      text: 'current user request',
    });
  });
});
