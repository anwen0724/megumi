// Owns command registry lookup and suggestion data without UI rendering.
import { CommandDefinitionSchema, type CommandDefinition } from './definition';

export interface CommandRegistryInput {
  agentCommands?: readonly CommandDefinition[];
  systemCommands?: readonly CommandDefinition[];
  quickCommands?: readonly CommandDefinition[];
  promptTemplateCommands?: readonly CommandDefinition[];
  skillCommands?: readonly CommandDefinition[];
  appOperationCommands?: readonly CommandDefinition[];
}

export interface CommandRegistry extends Required<CommandRegistryInput> {
  all: readonly CommandDefinition[];
}

export function createCommandRegistry(input: CommandRegistryInput): CommandRegistry {
  const agentCommands = validateCommands(input.agentCommands ?? []);
  const systemCommands = validateCommands(input.systemCommands ?? []);
  const quickCommands = validateCommands(input.quickCommands ?? []);
  const promptTemplateCommands = validateCommands(input.promptTemplateCommands ?? []);
  const skillCommands = validateCommands(input.skillCommands ?? []);
  const appOperationCommands = validateCommands(input.appOperationCommands ?? []);

  return {
    agentCommands,
    systemCommands,
    quickCommands,
    promptTemplateCommands,
    skillCommands,
    appOperationCommands,
    all: uniqueByName([
      ...agentCommands,
      ...systemCommands,
      ...quickCommands,
      ...promptTemplateCommands,
      ...skillCommands,
      ...appOperationCommands,
    ]),
  };
}

export function findCommand(name: string, registry: CommandRegistry): CommandDefinition | undefined {
  return registry.all.find((candidate) => candidate.name === name);
}

export function listCommandSuggestions(inputText: string, registry: CommandRegistry): CommandDefinition[] {
  const trimmedStart = inputText.trimStart();

  if (!trimmedStart.startsWith('/')) {
    return [];
  }

  const query = trimmedStart.slice(1);
  if (/\s/.test(query)) {
    return [];
  }

  return registry.all.filter((command) => command.name.startsWith(query));
}

function validateCommands(commands: readonly CommandDefinition[]): CommandDefinition[] {
  return commands.map((command) => CommandDefinitionSchema.parse(command));
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
