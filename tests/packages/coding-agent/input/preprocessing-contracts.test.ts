// Verifies the Coding Agent input preprocessing contracts used across runtime boundaries.
import { describe, expect, it } from 'vitest';
import {
  InputPreprocessingResultSchema,
} from '@megumi/coding-agent/input';

describe('input preprocessing contracts', () => {
  it('parses a structured preprocessing result containing all input-derived entry kinds', () => {
    const parsed = InputPreprocessingResultSchema.parse({
      originalText: '/explain src/index.ts',
      effectiveUserText: 'src/index.ts',
      entries: [
        {
          kind: 'intent',
          sourceId: 'input:intent:review',
          sourceName: '/review',
          visibility: 'model_visible',
          instructionText: 'Current input comes from the review intent.',
          intentId: 'review',
          commandName: 'review',
          defaultPermissionMode: 'plan',
          defaultPermissionSource: 'intent_default',
        },
        {
          kind: 'prompt_template',
          sourceId: 'input:template:example-template',
          sourceName: '/explain',
          visibility: 'model_visible',
          instructionText: 'Explain the selected target.',
          templateId: 'example-template',
          commandName: 'explain',
          templateSource: 'project',
        },
        {
          kind: 'skill',
          sourceId: 'input:skill:example-skill',
          sourceName: '/debug-flow',
          visibility: 'model_visible',
          instructionText: 'Use the example skill workflow.',
          skillId: 'example-skill',
          commandName: 'debug-flow',
          skillSource: 'project',
        },
        {
          kind: 'input_hook',
          sourceId: 'input:hook:default',
          sourceName: 'default input hook',
          visibility: 'host_only',
          hookId: 'default',
          action: 'continue',
        },
      ],
      diagnostics: [
        {
          code: 'input_hook_continue',
          message: 'Default input hook continued without changes.',
          metadata: { hookId: 'default' },
        },
      ],
    });

    expect(parsed.entries.map((entry) => entry.kind)).toEqual([
      'intent',
      'prompt_template',
      'skill',
      'input_hook',
    ]);
    expect(parsed.entries[1]).toMatchObject({
      kind: 'prompt_template',
      templateId: 'example-template',
      templateSource: 'project',
    });
    expect(parsed.entries[2]).toMatchObject({
      kind: 'skill',
      skillId: 'example-skill',
      skillSource: 'project',
    });
    expect(parsed.entries[3]).toMatchObject({
      kind: 'input_hook',
      action: 'continue',
      visibility: 'host_only',
    });
  });

  it('rejects model-visible preprocessing entries without instruction text', () => {
    expect(() => InputPreprocessingResultSchema.parse({
      originalText: '/explain src/index.ts',
      effectiveUserText: 'src/index.ts',
      entries: [
        {
          kind: 'prompt_template',
          sourceId: 'input:template:example-template',
          sourceName: '/explain',
          visibility: 'model_visible',
          templateId: 'example-template',
          commandName: 'explain',
          templateSource: 'project',
        },
      ],
      diagnostics: [],
    })).toThrow();
  });
});


