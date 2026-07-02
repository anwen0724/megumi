// Provides the Tool Registry Service public entrypoint for other Coding Agent modules.
import type {
  GetRegisteredToolRequest,
  GetRegisteredToolResult,
  ListAvailableToolsResult,
} from '../contracts/tool-contracts';
import { createToolRegistry } from '../core/tool-registry';

export class ToolRegistryService {
  private readonly registry = createToolRegistry();

  listAvailableTools(): ListAvailableToolsResult {
    return { tools: this.registry.listAvailableTools() };
  }

  getRegisteredTool(request: GetRegisteredToolRequest): GetRegisteredToolResult {
    const tool = this.registry.getRegisteredTool(request.toolName);
    return tool
      ? { type: 'found', tool }
      : { type: 'not_found', toolName: request.toolName };
  }
}
