import { describe, expect, it } from 'vitest';
import {
  buildAgentResponsePrompt,
  buildContextCompactionPrompt,
} from '@megumi/coding-agent/context/core/prompt-builder';
import type { PromptPart } from '@megumi/coding-agent/context/core/prompt-parts';

describe('prompt builder', () => {
  it('builds an agent response prompt from prompt parts', () => {
    const parts: PromptPart[] = [
      {
        part_id: 'instruction:1',
        part_kind: 'agent_instruction',
        text: 'AGENTS instructions',
        source_refs: [{ source_id: 'instruction:1', source_kind: 'agent_instruction' }],
        priority: 100,
        required: true,
        trim_policy: 'none',
      },
      {
        part_id: 'tool:1',
        part_kind: 'tool_result',
        text: 'Tool result',
        source_refs: [{ source_id: 'tool:1', source_kind: 'tool_result' }],
        priority: 40,
        required: false,
        trim_policy: 'truncate',
      },
      {
        part_id: 'message:current',
        part_kind: 'current_user_message',
        text: 'Fix the test',
        source_refs: [{ source_id: 'message:current', source_kind: 'session_message' }],
        priority: 110,
        required: true,
        trim_policy: 'none',
      },
    ];

    const prompt = buildAgentResponsePrompt({
      prompt_id: 'prompt:1',
      parts,
      prompt_resources: {
        system_prompt: 'You are Megumi',
      },
    });

    expect(prompt.purpose).toBe('agent_response');
    expect(prompt.messages.map((message) => message.role)).toEqual(['system', 'user']);
    expect(prompt.messages[0].content).toContain('You are Megumi');
    expect(prompt.messages[0].content).toContain('AGENTS instructions');
    expect(prompt.messages[0].content).toContain('Tool result');
    expect(prompt.source_refs.map((ref) => ref.source_kind)).toContain('agent_instruction');
  });

  it('builds a context compaction prompt from compaction candidates', () => {
    const parts: PromptPart[] = [{
      part_id: 'message:1',
      part_kind: 'context_compaction_candidate',
      text: 'Old context',
      source_refs: [{ source_id: 'message:1', source_kind: 'session_message' }],
      priority: 50,
      required: false,
      trim_policy: 'truncate',
    }];

    const prompt = buildContextCompactionPrompt({
      prompt_id: 'prompt:compact',
      parts,
      prompt_resources: {
        context_compaction_prompt: 'Create a structured summary',
      },
    });

    expect(prompt.purpose).toBe('context_compaction');
    expect(prompt.messages.map((message) => message.role)).toEqual(['system', 'user']);
    expect(prompt.messages[0].content).toContain('structured summary');
    expect(prompt.messages[1].content).toContain('context_compaction_candidate');
  });
});
