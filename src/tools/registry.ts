// Owns tool registration, lookup, snapshots, and model-visible tool projection without executing tools.
import type { RegisteredTool, ToolDefinition, ToolExecutor, ToolSetProjection } from './types';

export interface ToolRegistryInput {
  tools: readonly ToolDefinition[];
  executors?: ReadonlyMap<string, ToolExecutor>;
}

export interface ToolRegistry {
  get(name: string): ToolDefinition | undefined;
  getExecutor(name: string): ToolExecutor | undefined;
  list(): ToolDefinition[];
  entries(): RegisteredTool[];
}

export function createToolRegistry(input: ToolRegistryInput): ToolRegistry {
  const definitions = new Map<string, ToolDefinition>();
  const executors = input.executors ?? new Map<string, ToolExecutor>();

  for (const tool of input.tools) {
    if (definitions.has(tool.name)) {
      throw new Error(`Duplicate tool definition: ${tool.name}`);
    }
    definitions.set(tool.name, tool);
  }

  return {
    get(name) {
      return definitions.get(name);
    },
    getExecutor(name) {
      return executors.get(name);
    },
    list() {
      return [...definitions.values()];
    },
    entries() {
      return [...definitions.values()].map((definition) => ({
        definition,
        executor: executors.get(definition.name) ?? missingExecutor(definition.name),
      }));
    },
  };
}

export function projectToolSetFromRegistry(registry: ToolRegistry): ToolSetProjection {
  return {
    tools: registry.list().map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
  };
}

function missingExecutor(toolName: string) {
  return {
    async execute() {
      throw new Error(`Missing executor for tool: ${toolName}`);
    },
  };
}
