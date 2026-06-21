// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_INPUT_COMMAND_REGISTRY,
  CommandDefinitionSchema,
  createCommandAuditFact,
  createCommandRegistry,
  dispatchCommandText,
  listCommandSuggestions,
  parseSlashCommand,
} from '@megumi/command';

describe('command package contracts', () => {
  it('parses slash command text without executing the command', () => {
    expect(parseSlashCommand('/review src/main.ts')).toEqual({
      rawText: '/review src/main.ts',
      name: 'review',
      argsText: 'src/main.ts',
    });

    expect(parseSlashCommand('review src/main.ts')).toBeNull();
    expect(parseSlashCommand('/')).toBeNull();
  });

  it('registers explicit commands and dispatches them to typed handoff targets', () => {
    const registry = createCommandRegistry({
      agentCommands: [{
        name: 'review',
        kind: 'agent_command',
        source: 'core',
        description: 'Review code',
        dispatch: {
          kind: 'agent_command',
          commandName: 'review',
          description: 'Review code',
        },
      }],
      promptTemplateCommands: [{
        name: 'summary',
        kind: 'prompt_template',
        source: 'core',
        description: 'Summarize',
        argumentHint: '[focus]',
        dispatch: {
          kind: 'prompt_template',
          templateId: 'summary',
          variables: ['focus'],
        },
      }],
      skillCommands: [{
        name: 'write-doc',
        kind: 'skill_trigger',
        source: 'core',
        description: 'Write docs',
        dispatch: {
          kind: 'skill_trigger',
          skillName: 'write-doc',
          inputMode: 'append_args',
        },
      }],
      appOperationCommands: [{
        name: 'new-session',
        kind: 'app_operation',
        source: 'system',
        description: 'Create a session',
        dispatch: {
          kind: 'app_operation',
          operation: 'session.create',
        },
      }],
    });

    expect(dispatchCommandText('/review packages/input', registry)).toMatchObject({
      kind: 'agent_command',
      commandName: 'review',
      argsText: 'packages/input',
      target: {
        kind: 'agent_command',
        commandName: 'review',
      },
    });

    expect(dispatchCommandText('/summary current turn', registry)).toMatchObject({
      kind: 'prompt_template',
      commandName: 'summary',
      argsText: 'current turn',
      target: {
        kind: 'prompt_template',
        templateId: 'summary',
      },
    });

    expect(dispatchCommandText('/write-doc architecture', registry)).toMatchObject({
      kind: 'skill_trigger',
      commandName: 'write-doc',
      argsText: 'architecture',
      target: {
        kind: 'skill_trigger',
        skillName: 'write-doc',
      },
    });

    expect(dispatchCommandText('/new-session', registry)).toMatchObject({
      kind: 'app_operation',
      commandName: 'new-session',
      target: {
        kind: 'app_operation',
        operation: 'session.create',
      },
    });
  });

  it('returns fallback for non-command and unknown command text', () => {
    const registry = createCommandRegistry({});

    expect(dispatchCommandText('hello', registry)).toEqual({
      kind: 'fallback',
      rawText: 'hello',
      reason: 'not_a_command',
    });

    expect(dispatchCommandText('/missing arg', registry)).toEqual({
      kind: 'fallback',
      rawText: '/missing arg',
      reason: 'unknown_command',
      parsedCommand: {
        rawText: '/missing arg',
        name: 'missing',
        argsText: 'arg',
      },
    });
  });

  it('lists command suggestions without owning UI rendering', () => {
    const registry = createCommandRegistry({
      agentCommands: [{
        name: 'review',
        kind: 'agent_command',
        source: 'core',
        description: 'Review code',
        dispatch: { kind: 'agent_command', commandName: 'review' },
      }],
      promptTemplateCommands: [{
        name: 'summary',
        kind: 'prompt_template',
        source: 'core',
        description: 'Summarize',
        dispatch: { kind: 'prompt_template', templateId: 'summary' },
      }],
    });

    expect(listCommandSuggestions('/r', registry).map((command) => command.name)).toEqual(['review']);
    expect(listCommandSuggestions('/summary now', registry)).toEqual([]);
    expect(listCommandSuggestions('summary', registry)).toEqual([]);
  });

  it('creates command audit facts from dispatch results', () => {
    const result = dispatchCommandText('/review src', BUILT_IN_INPUT_COMMAND_REGISTRY);

    expect(createCommandAuditFact({
      result,
      createdAt: '2026-06-21T00:00:00.000Z',
      metadata: { source: 'test' },
    })).toEqual({
      commandName: 'review',
      rawText: '/review src',
      argsText: 'src',
      resultKind: 'agent_command',
      fallback: false,
      unknown: false,
      createdAt: '2026-06-21T00:00:00.000Z',
      metadata: { source: 'test' },
    });
  });

  it('validates command definitions strictly', () => {
    expect(() => CommandDefinitionSchema.parse({
      name: 'Review',
      kind: 'agent_command',
      source: 'core',
      description: 'Bad name',
      dispatch: { kind: 'agent_command', commandName: 'Review' },
    })).toThrow();

    expect(() => CommandDefinitionSchema.parse({
      name: 'review',
      kind: 'agent_command',
      source: 'core',
      description: 'Review code',
      dispatch: { kind: 'agent_command', commandName: 'review' },
      executesTool: true,
    })).toThrow();
  });
});
