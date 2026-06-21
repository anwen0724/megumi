// Maps parsed commands to typed handoff results without performing downstream execution.
import type { JsonObject } from '@megumi/shared/primitives';
import type { CommandAuditFact, CommandDispatchResult } from './definition';
import { parseSlashCommand } from './parser';
import { findCommand, type CommandRegistry } from './registry';

export function dispatchCommandText(rawText: string, registry: CommandRegistry): CommandDispatchResult {
  const trimmed = rawText.trim();
  const parsed = parseSlashCommand(trimmed);

  if (!parsed) {
    return { kind: 'fallback', rawText: trimmed, reason: 'not_a_command' };
  }

  const command = findCommand(parsed.name, registry);
  if (!command) {
    return {
      kind: 'fallback',
      rawText: trimmed,
      reason: 'unknown_command',
      parsedCommand: parsed,
    };
  }

  return {
    kind: command.dispatch.kind,
    command,
    commandName: command.name,
    rawText: parsed.rawText,
    argsText: parsed.argsText,
    target: command.dispatch,
  };
}

export function createCommandAuditFact(input: {
  result: CommandDispatchResult;
  createdAt: string;
  metadata?: JsonObject;
}): CommandAuditFact {
  const commandName = input.result.kind === 'fallback'
    ? input.result.parsedCommand?.name ?? '<none>'
    : input.result.commandName;
  const argsText = input.result.kind === 'fallback'
    ? input.result.parsedCommand?.argsText ?? ''
    : input.result.argsText;

  return {
    commandName,
    rawText: input.result.rawText,
    argsText,
    resultKind: input.result.kind,
    fallback: input.result.kind === 'fallback',
    unknown: input.result.kind === 'fallback' && input.result.reason === 'unknown_command',
    createdAt: input.createdAt,
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };
}
