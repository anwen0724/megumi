// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_INPUT_COMMAND_REGISTRY,
  createCommandRegistry,
} from '@megumi/command';
import {
  ParsedInputSchema,
  RawInputSchema,
  createParsedInputId,
  normalizeRawInput,
  parseRawInput,
} from '@megumi/input';

describe('input package normalization', () => {
  it('normalizes raw text input into stable ParsedInput facts', () => {
    const parsed = parseRawInput({
      id: 'raw-input:1',
      source: {
        kind: 'composer',
        surface: 'chat-input',
      },
      text: 'Read package.json',
      target: {
        kind: 'session',
        sessionId: 'session-1',
      },
      metadata: {
        clientRequestId: 'client-1',
      },
      createdAt: '2026-06-21T00:00:00.000Z',
    }, {
      createId: (prefix, value) => `${prefix}:${value}`,
    });

    expect(parsed).toEqual({
      id: 'parsed-input:raw-input:1',
      rawInputId: 'raw-input:1',
      source: {
        kind: 'composer',
        surface: 'chat-input',
      },
      rawKind: 'text',
      kind: 'user_input',
      text: 'Read package.json',
      attachments: [],
      references: [],
      target: {
        kind: 'session',
        sessionId: 'session-1',
      },
      facts: [],
      metadata: {
        clientRequestId: 'client-1',
      },
      createdAt: '2026-06-21T00:00:00.000Z',
    });
    expect(ParsedInputSchema.parse(parsed)).toEqual(parsed);
  });

  it('records slash command dispatch as ParsedInput facts without running the command', () => {
    const parsed = normalizeRawInput({
      rawInput: {
        id: 'raw-command:1',
        source: {
          kind: 'composer',
        },
        text: '/summary current work',
        createdAt: '2026-06-21T00:00:00.000Z',
      },
      commandRegistry: BUILT_IN_INPUT_COMMAND_REGISTRY,
      createId: (prefix, value) => `${prefix}:${value}`,
    });

    expect(parsed.rawKind).toBe('slash_command');
    expect(parsed.kind).toBe('command_input');
    expect(parsed.facts).toEqual([{
      kind: 'prompt_template',
      commandName: 'summary',
      argsText: 'current work',
      templateId: 'summary',
    }]);
  });

  it('records skill and app operation command facts', () => {
    const registry = createCommandRegistry({
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
        description: 'Create session',
        dispatch: {
          kind: 'app_operation',
          operation: 'session.create',
        },
      }],
    });

    expect(parseRawInput({
      id: 'raw-skill:1',
      source: { kind: 'quick_action' },
      text: '/write-doc architecture',
      createdAt: '2026-06-21T00:00:00.000Z',
    }, { commandRegistry: registry }).facts).toEqual([{
      kind: 'skill',
      skillName: 'write-doc',
      argsText: 'architecture',
      source: 'command',
    }]);

    expect(parseRawInput({
      id: 'raw-app:1',
      source: { kind: 'app' },
      text: '/new-session',
      createdAt: '2026-06-21T00:00:00.000Z',
    }, { commandRegistry: registry }).facts).toEqual([{
      kind: 'app_operation',
      operation: 'session.create',
      argsText: '',
      source: 'command',
    }]);
  });

  it('keeps attachments, references, and target as input facts', () => {
    const raw = RawInputSchema.parse({
      id: 'raw-input:attachments',
      source: {
        kind: 'desktop',
        metadata: {
          windowId: 'main',
        },
      },
      attachments: [{
        id: 'attachment:1',
        kind: 'file',
        name: 'package.json',
        path: 'package.json',
        mimeType: 'application/json',
        sizeBytes: 123,
      }],
      references: [{
        kind: 'selected_range',
        filePath: 'src/index.ts',
        startLine: 1,
        endLine: 5,
      }],
      target: {
        kind: 'selection',
        filePath: 'src/index.ts',
        startLine: 1,
        endLine: 5,
      },
      createdAt: '2026-06-21T00:00:00.000Z',
    });

    const parsed = parseRawInput(raw);

    expect(parsed.rawKind).toBe('attachment');
    expect(parsed.attachments).toHaveLength(1);
    expect(parsed.references).toHaveLength(1);
    expect(parsed.target).toEqual({
      kind: 'selection',
      filePath: 'src/index.ts',
      startLine: 1,
      endLine: 5,
    });
  });

  it('creates parsed input IDs using the input-owned helper', () => {
    expect(createParsedInputId('abc')).toBe('parsed-input:abc');
  });
});
