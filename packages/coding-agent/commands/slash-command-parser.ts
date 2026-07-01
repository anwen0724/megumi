/*
 * Parses slash-command syntax only. It does not inspect registered commands
 * and does not execute command handlers.
 */

import type { CommandInvocation } from './command-definition';

export type SlashCommandParseResult =
  | { type: 'not_command'; raw_input: string }
  | { type: 'invalid_command'; raw_input: string; reason: string }
  | { type: 'command'; invocation: CommandInvocation };

export function parseSlashCommandInput(raw_input: string): SlashCommandParseResult {
  const trimmed = raw_input.trim();
  if (!trimmed.startsWith('/')) {
    return { type: 'not_command', raw_input };
  }

  const body = trimmed.slice(1);
  if (body.trim().length === 0) {
    return { type: 'invalid_command', raw_input, reason: 'missing_command_name' };
  }

  const firstWhitespace = body.search(/\s/);
  const name = firstWhitespace === -1 ? body : body.slice(0, firstWhitespace);
  const arguments_input = firstWhitespace === -1 ? '' : body.slice(firstWhitespace + 1).trim();

  return {
    type: 'command',
    invocation: { name, arguments_input, raw_input },
  };
}
