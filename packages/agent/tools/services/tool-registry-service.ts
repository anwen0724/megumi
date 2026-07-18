// Provides the Tool Registry Service public entrypoint for other Agent modules.
import type {
  GetRegisteredToolRequest,
  GetRegisteredToolResult,
  ListAvailableToolsResult,
} from '../contracts/tool-contracts';
import { BUILT_IN_TOOL_NAMES, type BuiltInToolName } from '../core/tool-definitions';
import { createBuiltInToolRegistrations, createToolRegistry, type ToolRegistry } from '../core/tool-registry';

export class ToolRegistryService {
  private readonly registry: ToolRegistry;
  private readonly isBuiltInToolAvailable?: (toolName: BuiltInToolName) => boolean;

  constructor(input: {
    disabledBuiltInTools?: readonly BuiltInToolName[];
    isBuiltInToolAvailable?: (toolName: BuiltInToolName) => boolean;
  } = {}) {
    this.isBuiltInToolAvailable = input.isBuiltInToolAvailable;
    this.registry = createToolRegistry({
      registrations: createBuiltInToolRegistrations({
        disabledToolNames: input.disabledBuiltInTools ?? (input.isBuiltInToolAvailable ? [] : ['web_search']),
      }),
    });
  }

  listAvailableTools(): ListAvailableToolsResult {
    return {
      tools: this.registry.listAvailableTools().filter((tool) => this.isAvailable(tool.definition.name)),
    };
  }

  getRegisteredTool(request: GetRegisteredToolRequest): GetRegisteredToolResult {
    const tool = this.registry.getRegisteredTool(request.toolName);
    return tool && this.isAvailable(tool.definition.name)
      ? { type: 'found', tool }
      : { type: 'not_found', toolName: request.toolName };
  }

  private isAvailable(toolName: string): boolean {
    return !this.isBuiltInToolAvailable
      || !isBuiltInToolName(toolName)
      || this.isBuiltInToolAvailable(toolName);
  }
}

function isBuiltInToolName(value: string): value is BuiltInToolName {
  return BUILT_IN_TOOL_NAMES.includes(value as BuiltInToolName);
}
