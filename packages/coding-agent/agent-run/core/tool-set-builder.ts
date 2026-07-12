/*
 * Builds and caches the stable run-level Tool Set.
 * Agent Run chooses the model-visible set; Tool Registry only supplies available tools.
 */
import type { ToolSet, ToolSetEntry } from '@megumi/ai';
import type { RegisteredTool } from '../../tools';

export type RunToolSetBuilder = {
  getToolSet(request: GetRunToolSetRequest): ToolSet;
  getRegisteredTool(runId: string, toolName: string): RegisteredTool | undefined;
};

export type GetRunToolSetRequest = {
  run_id: string;
};

export type CreateRunToolSetBuilderOptions = {
  tool_registry_service: {
    listAvailableTools(): { tools: RegisteredTool[] };
  };
};

type CachedRunToolSet = {
  tools: ToolSet;
  registered_tools_by_name: Map<string, RegisteredTool>;
};

export function createRunToolSetBuilder(options: CreateRunToolSetBuilderOptions): RunToolSetBuilder {
  return new DefaultRunToolSetBuilder(options);
}

class DefaultRunToolSetBuilder implements RunToolSetBuilder {
  private readonly cache = new Map<string, CachedRunToolSet>();

  constructor(private readonly options: CreateRunToolSetBuilderOptions) {}

  getToolSet(request: GetRunToolSetRequest): ToolSet {
    const cached = this.cache.get(request.run_id);
    if (cached) {
      return cached.tools;
    }

    const next = this.createToolSet(request);
    this.cache.set(request.run_id, next);
    return next.tools;
  }

  getRegisteredTool(runId: string, toolName: string): RegisteredTool | undefined {
    return this.cache.get(runId)?.registered_tools_by_name.get(toolName);
  }

  private createToolSet(request: GetRunToolSetRequest): CachedRunToolSet {
    const registeredTools = this.options.tool_registry_service.listAvailableTools().tools;
    return {
      tools: registeredTools.map(toolEntryFromRegisteredTool),
      registered_tools_by_name: new Map(
        registeredTools.map((tool) => [tool.registeredToolName, tool]),
      ),
    };
  }
}

function toolEntryFromRegisteredTool(tool: RegisteredTool): ToolSetEntry {
  return {
    name: tool.registeredToolName,
    description: tool.definition.modelFacingDescription ?? tool.definition.description,
    inputSchema: tool.definition.inputSchema,
  };
}
