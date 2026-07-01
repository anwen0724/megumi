// Verifies the public shared Input System contracts used across renderer and runtime boundaries.
import { describe, expect, it } from 'vitest';
import {
  InputCommandDefinitionSchema,
  InputCommandSuggestionSchema,
  InputPreprocessingResultSchema,
  InputPromptSourceSchema,
  InputPipelineHandoffSchema,
  createCodeReviewInputIntentMetadata,
} from '@megumi/shared/input';

describe('input shared contracts', () => {
  it('parses command definitions for local, intent, extension, prompt template, and skill entries', () => {
    expect([
      InputCommandDefinitionSchema.parse({
        name: 'settings',
        kind: 'local',
        source: 'core',
        description: 'Open settings',
      }).kind,
      InputCommandDefinitionSchema.parse({
        name: 'review',
        kind: 'intent',
        source: 'core',
        description: 'Review code in the current project',
      }).kind,
      InputCommandDefinitionSchema.parse({
        name: 'calendar-today',
        kind: 'extension',
        source: 'extension',
        description: 'Show calendar events',
      }).kind,
      InputCommandDefinitionSchema.parse({
        name: 'explain',
        kind: 'prompt_template',
        source: 'core',
        description: 'Explain a selected target',
        argumentHint: '[target]',
      }).kind,
      InputCommandDefinitionSchema.parse({
        name: 'debug-flow',
        kind: 'skill',
        source: 'core',
        description: 'Use an example skill workflow',
        argumentHint: '[target]',
      }).kind,
    ]).toEqual(['local', 'intent', 'extension', 'prompt_template', 'skill']);
  });

  it('parses command suggestions with stable display metadata', () => {
    expect(InputCommandSuggestionSchema.parse({
      name: 'explain',
      kind: 'prompt_template',
      source: 'core',
      description: 'Explain a selected target',
      argumentHint: '[target]',
    })).toEqual({
      name: 'explain',
      kind: 'prompt_template',
      source: 'core',
      description: 'Explain a selected target',
      argumentHint: '[target]',
    });
  });

  it('keeps the current review intent metadata shape while runtime migration is pending', () => {
    expect(createCodeReviewInputIntentMetadata(' 当前改动 ')).toEqual({
      intentName: 'code_review',
      source: 'core_command',
      commandName: 'review',
      argsText: '当前改动',
    });
  });

  it('parses existing send_intent handoff with optional intent default permission', () => {
    expect(InputPipelineHandoffSchema.parse({
      kind: 'send_intent',
      messageText: '/review 当前改动',
      intent: {
        intentName: 'code_review',
        source: 'core_command',
        commandName: 'review',
        argsText: '当前改动',
      },
      defaultPermission: {
        permissionMode: 'plan',
        source: 'intent_default',
      },
    })).toEqual({
      kind: 'send_intent',
      messageText: '/review 当前改动',
      intent: {
        intentName: 'code_review',
        source: 'core_command',
        commandName: 'review',
        argsText: '当前改动',
      },
      defaultPermission: {
        permissionMode: 'plan',
        source: 'intent_default',
      },
    });
  });

  it('parses prompt source values without workflow terminology', () => {
    expect(InputPromptSourceSchema.parse('fallback')).toBe('fallback');
    expect(InputPromptSourceSchema.parse('prompt_template')).toBe('prompt_template');
    expect(InputPromptSourceSchema.parse('skill')).toBe('skill');
    expect(InputPromptSourceSchema.parse('input_hook_transform')).toBe('input_hook_transform');
    expect(() => InputPromptSourceSchema.parse('workflow')).toThrow();
  });

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

