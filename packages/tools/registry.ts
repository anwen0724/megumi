import type { PermissionMode } from '@megumi/shared/permission-mode-contracts';
import type { ToolDefinition } from '@megumi/shared/tool-contracts';

export interface ToolRegistryListInput {
  runId: string;
  projectId?: string;
  permissionMode: PermissionMode;
  providerCapabilitySummary?: {
    supportsToolUse?: boolean;
  };
}

export interface ToolRegistry {
  listDefinitions<TInput extends ToolRegistryListInput>(input: TInput): ToolDefinition[];
  getDefinition<TInput extends ToolRegistryListInput>(toolName: string, input?: TInput): ToolDefinition | undefined;
}

function cloneToolDefinition(definition: ToolDefinition): ToolDefinition {
  return JSON.parse(JSON.stringify(definition)) as ToolDefinition;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nestedValue of Object.values(value)) {
      deepFreeze(nestedValue);
    }
    Object.freeze(value);
  }
  return value;
}

export function createStaticToolRegistry(definitions: readonly ToolDefinition[]): ToolRegistry {
  const byName = new Map<string, ToolDefinition>();

  for (const definition of definitions) {
    if (byName.has(definition.name)) {
      throw new Error(`Duplicate tool name: ${definition.name}`);
    }
    byName.set(definition.name, deepFreeze(cloneToolDefinition(definition)));
  }

  function listVisibleDefinitions(input: ToolRegistryListInput): ToolDefinition[] {
    if (input.providerCapabilitySummary?.supportsToolUse === false) {
      return [];
    }

    return [...byName.values()].filter((definition) => definition.availability.status === 'available');
  }

  return {
    listDefinitions(input) {
      return listVisibleDefinitions(input).map(cloneToolDefinition);
    },
    getDefinition(toolName, input) {
      const definition = byName.get(toolName);
      if (!definition) {
        return undefined;
      }
      if (input && !listVisibleDefinitions(input).some((visible) => visible.name === toolName)) {
        return undefined;
      }
      return cloneToolDefinition(definition);
    },
  };
}
