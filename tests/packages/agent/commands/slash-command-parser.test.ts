import { describe, expect, it } from 'vitest';
import { parseSlashCommandInput } from '@megumi/agent/commands/core/slash-command-parser';

describe('parseSlashCommandInput', () => {
  it('treats ordinary text as not command', () => {
    expect(parseSlashCommandInput('帮我看下代码')).toEqual({
      type: 'not_command',
      raw_input: '帮我看下代码',
    });
  });

  it('does not parse slash text in the middle of ordinary input', () => {
    expect(parseSlashCommandInput('hello /settings')).toEqual({
      type: 'not_command',
      raw_input: 'hello /settings',
    });
  });

  it('returns invalid command for a slash without a command name', () => {
    expect(parseSlashCommandInput('/')).toEqual({
      type: 'invalid_command',
      raw_input: '/',
      reason: 'missing_command_name',
    });
  });

  it('parses command name without arguments', () => {
    expect(parseSlashCommandInput('/settings')).toEqual({
      type: 'command',
      invocation: {
        name: 'settings',
        arguments_input: '',
        raw_input: '/settings',
      },
    });
  });

  it('parses command arguments after the command name', () => {
    expect(parseSlashCommandInput('/model gpt-5')).toEqual({
      type: 'command',
      invocation: {
        name: 'model',
        arguments_input: 'gpt-5',
        raw_input: '/model gpt-5',
      },
    });
  });

  it('trims only syntax whitespace while preserving raw input', () => {
    expect(parseSlashCommandInput(' /review diff ')).toEqual({
      type: 'command',
      invocation: {
        name: 'review',
        arguments_input: 'diff',
        raw_input: ' /review diff ',
      },
    });
  });

  it('does not check whether a parsed command exists', () => {
    expect(parseSlashCommandInput('/unknown abc')).toEqual({
      type: 'command',
      invocation: {
        name: 'unknown',
        arguments_input: 'abc',
        raw_input: '/unknown abc',
      },
    });
  });
});
