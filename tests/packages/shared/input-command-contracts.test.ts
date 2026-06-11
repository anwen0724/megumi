import { describe, expect, it } from 'vitest';
import {
  InputCommandDefinitionSchema,
  InputCommandSuggestionSchema,
  InputInterceptResultSchema,
  InputPipelineHandoffSchema,
  createCodeReviewInputIntentMetadata,
} from '@megumi/shared/input-command-contracts';

describe('input-command-contracts', () => {
  it('parses all first-version command definition kinds', () => {
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
        source: 'project',
        description: 'Explain a file',
        argumentHint: '<path>',
      }).kind,
      InputCommandDefinitionSchema.parse({
        name: 'skill:debugging',
        kind: 'skill',
        source: 'user',
        description: 'Use debugging skill',
      }).kind,
    ]).toEqual(['local', 'intent', 'extension', 'prompt_template', 'skill']);
  });

  it('parses command suggestions with kind, source, description, and argument hint', () => {
    expect(InputCommandSuggestionSchema.parse({
      name: 'review',
      kind: 'intent',
      source: 'core',
      description: 'Review code in the current project',
      argumentHint: '[focus]',
    })).toEqual({
      name: 'review',
      kind: 'intent',
      source: 'core',
      description: 'Review code in the current project',
      argumentHint: '[focus]',
    });
  });

  it('creates code review intent metadata without workflow naming', () => {
    expect(createCodeReviewInputIntentMetadata(' 当前改动 ')).toEqual({
      intentName: 'code_review',
      source: 'core_command',
      commandName: 'review',
      argsText: '当前改动',
    });
  });

  it('parses send_intent handoff with optional default permission', () => {
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

  it('parses prompt, local action, handled, and extension intercept results', () => {
    expect(InputPipelineHandoffSchema.parse({
      kind: 'local_action',
      commandName: 'settings',
      argsText: '',
    }).kind).toBe('local_action');

    expect(InputPipelineHandoffSchema.parse({
      kind: 'send_prompt',
      messageText: 'Expanded prompt',
      source: 'prompt_template',
      metadata: { templateName: 'explain' },
    }).kind).toBe('send_prompt');

    expect(InputPipelineHandoffSchema.parse({
      kind: 'handled',
      reason: 'Opened settings',
    }).kind).toBe('handled');

    expect(InputInterceptResultSchema.parse({ kind: 'pass' })).toEqual({ kind: 'pass' });
    expect(InputInterceptResultSchema.parse({
      kind: 'transform',
      text: 'Expanded natural-language prompt',
      metadata: { source: 'extension' },
    }).kind).toBe('transform');
    expect(InputInterceptResultSchema.parse({
      kind: 'handled',
      reason: 'Handled locally',
    }).kind).toBe('handled');
  });
});
