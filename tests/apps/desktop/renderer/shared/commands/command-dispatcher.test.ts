import { describe, expect, it } from 'vitest';
import {
  dispatchCommandText,
  listCommandSuggestions,
  type CommandRegistry,
} from '@megumi/desktop/renderer/shared/commands';

const registry: CommandRegistry = {
  localCommands: [
    {
      name: 'settings',
      kind: 'local',
      source: 'core',
      description: 'Open settings',
    },
  ],
  intentCommands: [
    {
      name: 'review',
      kind: 'intent',
      source: 'core',
      description: 'Review code in the current project',
    },
  ],
  extensionCommands: [
    {
      name: 'review',
      kind: 'extension',
      source: 'extension',
      description: 'Extension review command must not override core intent',
    },
    {
      name: 'calendar-today',
      kind: 'extension',
      source: 'extension',
      description: 'Show calendar events',
    },
  ],
  promptTemplateCommands: [
    {
      name: 'explain',
      kind: 'prompt_template',
      source: 'project',
      description: 'Explain a file',
      argumentHint: '<path>',
    },
  ],
  skillCommands: [
    {
      name: 'skill:debugging',
      kind: 'skill',
      source: 'user',
      description: 'Use debugging skill',
    },
  ],
};

describe('command dispatcher', () => {
  it('dispatches /review as a core intent command before extension commands', () => {
    expect(dispatchCommandText('/review 当前改动', registry)).toEqual({
      kind: 'send_intent',
      rawText: '/review 当前改动',
      argsText: '当前改动',
      command: {
        name: 'review',
        kind: 'intent',
        source: 'core',
        description: 'Review code in the current project',
      },
    });
  });

  it('dispatches each first-version command kind to the expected handoff shape', () => {
    expect(dispatchCommandText('/settings', registry).kind).toBe('local_action');
    expect(dispatchCommandText('/calendar-today', registry).kind).toBe('extension_command');
    expect(dispatchCommandText('/explain src/main.ts', registry)).toMatchObject({
      kind: 'send_prompt',
      source: 'prompt_template',
      argsText: 'src/main.ts',
    });
    expect(dispatchCommandText('/skill:debugging failing test', registry)).toMatchObject({
      kind: 'send_prompt',
      source: 'skill',
      argsText: 'failing test',
    });
  });

  it.each(['/reviewx 当前改动', '/Review 当前改动', 'hello'])('falls back for %s', (rawText) => {
    expect(dispatchCommandText(rawText, registry)).toEqual({
      kind: 'fallback',
      rawText: rawText.trim(),
    });
  });

  it('lists suggestions from all sources while keeping core conflicts first and unique', () => {
    expect(listCommandSuggestions('/re', registry)).toEqual([
      {
        name: 'review',
        kind: 'intent',
        source: 'core',
        description: 'Review code in the current project',
      },
    ]);

    expect(listCommandSuggestions('/', registry).map((command) => command.name)).toEqual([
      'settings',
      'review',
      'calendar-today',
      'explain',
      'skill:debugging',
    ]);
  });

  it('stops command suggestions once arguments start', () => {
    expect(listCommandSuggestions('/review 当前改动', registry)).toEqual([]);
  });
});
