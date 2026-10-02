/*
 * Recognizes explicit slash command syntax without resolving a command name.
 */
import type { CommandInvocation } from "./commands";

export type SlashCommandParseResult =
  | { readonly type: "not_command"; readonly rawInput: string }
  | { readonly type: "invalid_command"; readonly rawInput: string; readonly reason: "missing_command_name" }
  | { readonly type: "command"; readonly invocation: CommandInvocation };

export function parseSlashCommand(rawInput: string): SlashCommandParseResult {
  const trimmed = rawInput.trim();
  if (!trimmed.startsWith("/")) return { type: "not_command", rawInput };
  const body = trimmed.slice(1);
  if (body.trim().length === 0) {
    return { type: "invalid_command", rawInput, reason: "missing_command_name" };
  }
  const firstWhitespace = body.search(/\s/);
  const name = firstWhitespace === -1 ? body : body.slice(0, firstWhitespace);
  const argumentsInput = firstWhitespace === -1 ? "" : body.slice(firstWhitespace + 1).trim();
  return {
    type: "command",
    invocation: { name, argumentsInput, rawInput },
  };
}
