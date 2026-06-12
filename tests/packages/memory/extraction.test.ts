import { describe, expect, it } from 'vitest';
import {
  buildMemoryExtractionPrompt,
  parseMemoryExtractionOutput,
} from '@megumi/memory';

describe('memory extraction prompt and parser', () => {
  it('builds a strict JSON extraction prompt with denylist constraints', () => {
    const prompt = buildMemoryExtractionPrompt({
      userText: '请记住：以后先讨论 spec。',
      assistantFinalText: '明白。',
      signals: ['explicit_remember', 'future_preference'],
      projectId: 'project:1',
      toolActivitySummary: 'No raw tool output is included.',
    });

    expect(prompt.system).toContain('Return strict JSON only');
    expect(prompt.system).toContain('Do not include id, status, or projectId');
    expect(prompt.system).toContain('Do not save task progress');
    expect(prompt.user).toContain('explicit_remember');
    expect(prompt.user).not.toContain('raw tool output value');
  });

  it('parses valid extraction output and empty candidate output', () => {
    expect(parseMemoryExtractionOutput('{ "candidates": [] }')).toEqual({
      ok: true,
      candidates: [],
    });

    const parsed = parseMemoryExtractionOutput(JSON.stringify({
      candidates: [
        {
          scope: 'user',
          kind: 'preference',
          text: '用户希望先讨论确认 spec，再写 implementation plan。',
          confidence: 0.91,
          evidence: { source: 'user_message', quote: '先讨论确认' },
        },
      ],
    }));

    expect(parsed).toMatchObject({
      ok: true,
      candidates: [
        {
          scope: 'user',
          kind: 'preference',
          confidence: 0.91,
        },
      ],
    });
  });

  it('rejects invalid JSON, invalid schema, and LLM-owned persistence fields', () => {
    expect(parseMemoryExtractionOutput('not json')).toMatchObject({
      ok: false,
      reason: 'invalid_json',
    });
    expect(parseMemoryExtractionOutput(JSON.stringify({
      candidates: [{ scope: 'session', kind: 'fact', text: 'x', confidence: 0.5 }],
    }))).toMatchObject({
      ok: false,
      reason: 'invalid_schema',
    });
    expect(parseMemoryExtractionOutput(JSON.stringify({
      candidates: [{ id: 'memory:1', scope: 'user', kind: 'fact', text: 'x', confidence: 0.5 }],
    }))).toMatchObject({
      ok: false,
      reason: 'forbidden_persistence_field',
    });
  });
});
