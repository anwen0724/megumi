import type { CommandDefinition, CommandDispatchResult, CommandRegistry } from './command-types';
import { parseSlashCommand } from './command-parser';

function registryEntries(registry: CommandRegistry): CommandDefinition[] {
  return [
    ...(registry.localCommands ?? []),
    ...(registry.intentCommands ?? []),
    ...(registry.extensionCommands ?? []),
    ...(registry.promptTemplateCommands ?? []),
    ...(registry.skillCommands ?? []),
  ];
}

function uniqueByName(commands: readonly CommandDefinition[]): CommandDefinition[] {
  const seen = new Set<string>();
  const result: CommandDefinition[] = [];

  for (const command of commands) {
    if (seen.has(command.name)) {
      continue;
    }

    seen.add(command.name);
    result.push(command);
  }

  return result;
}

export function listCommandSuggestions(
  inputText: string,
  registry: CommandRegistry,
): CommandDefinition[] {
  const trimmedStart = inputText.trimStart();

  if (!trimmedStart.startsWith('/')) {
    return [];
  }

  const query = trimmedStart.slice(1);
  if (/\s/.test(query)) {
    return [];
  }

  return uniqueByName(registryEntries(registry).filter((command) => command.name.startsWith(query)));
}

function findCommand(parsedName: string, registry: CommandRegistry): CommandDefinition | undefined {
  return registryEntries(registry).find((candidate) => candidate.name === parsedName);
}

export function dispatchCommandText(
  rawText: string,
  registry: CommandRegistry,
): CommandDispatchResult {
  const trimmed = rawText.trim();
  const parsed = parseSlashCommand(trimmed);

  if (!parsed) {
    return { kind: 'fallback', rawText: trimmed };
  }

  const command = findCommand(parsed.name, registry);
  if (!command) {
    return { kind: 'fallback', rawText: trimmed };
  }

  if (command.kind === 'local') {
    return {
      kind: 'local_action',
      command,
      rawText: parsed.rawText,
      argsText: parsed.argsText,
    };
  }

  if (command.kind === 'intent') {
    return {
      kind: 'send_intent',
      command,
      rawText: parsed.rawText,
      argsText: parsed.argsText,
    };
  }

  if (command.kind === 'extension') {
    return {
      kind: 'extension_command',
      command,
      rawText: parsed.rawText,
      argsText: parsed.argsText,
    };
  }

  return {
    kind: 'send_prompt',
    command,
    source: command.kind,
    rawText: parsed.rawText,
    argsText: parsed.argsText,
  };
}
