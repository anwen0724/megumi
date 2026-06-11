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
        name: 'summary',
        kind: 'prompt_template',
        source: 'core',
        description: 'Summarize the current session',
        argumentHint: '[focus]',
      }).kind,
      InputCommandDefinitionSchema.parse({
        name: 'write-doc',
        kind: 'skill',
        source: 'core',
        description: 'Write or update project documentation',
        argumentHint: '[target]',
      }).kind,
    ]).toEqual(['local', 'intent', 'extension', 'prompt_template', 'skill']);
  });

  it('parses command suggestions with stable display metadata', () => {
    expect(InputCommandSuggestionSchema.parse({
      name: 'summary',
      kind: 'prompt_template',
      source: 'core',
      description: 'Summarize the current session',
      argumentHint: '[focus]',
    })).toEqual({
      name: 'summary',
      kind: 'prompt_template',
      source: 'core',
      description: 'Summarize the current session',
      argumentHint: '[focus]',
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
      originalText: '/summary',
      effectiveUserText: '总结当前会话',
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
          sourceId: 'input:template:summary',
          sourceName: '/summary',
          visibility: 'model_visible',
          instructionText: 'Summarize the current session.',
          templateId: 'summary',
          commandName: 'summary',
          templateSource: 'builtin',
        },
        {
          kind: 'skill',
          sourceId: 'input:skill:write-doc',
          sourceName: '/write-doc',
          visibility: 'model_visible',
          instructionText: 'Use the documentation writing method.',
          skillId: 'write-doc',
          commandName: 'write-doc',
          skillSource: 'builtin',
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
      templateId: 'summary',
      templateSource: 'builtin',
    });
    expect(parsed.entries[2]).toMatchObject({
      kind: 'skill',
      skillId: 'write-doc',
      skillSource: 'builtin',
    });
    expect(parsed.entries[3]).toMatchObject({
      kind: 'input_hook',
      action: 'continue',
      visibility: 'host_only',
    });
  });

  it('rejects model-visible preprocessing entries without instruction text', () => {
    expect(() => InputPreprocessingResultSchema.parse({
      originalText: '/summary',
      effectiveUserText: '总结当前会话',
      entries: [
        {
          kind: 'prompt_template',
          sourceId: 'input:template:summary',
          sourceName: '/summary',
          visibility: 'model_visible',
          templateId: 'summary',
          commandName: 'summary',
          templateSource: 'builtin',
        },
      ],
      diagnostics: [],
    })).toThrow();
  });
});
