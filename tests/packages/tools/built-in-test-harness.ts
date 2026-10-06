/* Exercises complete tool objects through the public Agent entry. */
import { fauxAssistantMessage, fauxToolCall, type JsonObject } from '@megumi/ai';
import { createSearchWebTool, createFetchPageTool, type AgentTool, type AgentEvent, type ToolExecutionResult } from '@megumi/agent';
import type { WebSearch } from '@megumi/agent/tools/builtin/web/search-web';
import type { WebFetch } from '@megumi/agent/tools/builtin/web/fetch-page';
import { fixture } from '../agent/agent-fixture';

export function createBuiltInTestHarness(request: { webSearch?: WebSearch; webFetch?: WebFetch }) {
  const tools = [
    ...(request.webSearch ? [createSearchWebTool(request.webSearch)] : []),
    ...(request.webFetch ? [createFetchPageTool(request.webFetch)] : []),
  ];
  return {
    execute(input: { toolName: string; input: JsonObject }, options: { signal?: AbortSignal } = {}) {
      const tool = tools.find(tool => tool.name === input.toolName);
      if (!tool) throw new Error(`Missing fixture tool: ${input.toolName}`);
      return executeToolThroughAgent(tool, input.input, options);
    },
  };
}

export async function executeToolThroughAgent(
  tool: AgentTool, input: JsonObject,
  options: { signal?: AbortSignal; onEvent?: (event: AgentEvent) => void } = {},
): Promise<ToolExecutionResult> {
  const { agent, config, provider } = fixture();
  provider.setResponses([
    fauxAssistantMessage(fauxToolCall(tool.name, input), { stopReason: 'toolUse' }),
    fauxAssistantMessage('Done.'),
  ]);
  const result = await agent.startAgent({
    config: { ...config, tools: [tool] },
    input: { role: 'user', content: 'Execute the tool', timestamp: 1 },
    context: { async prepare({ runMessages, tools }) { return { systemPrompt: '', messages: runMessages, tools }; } },
    ...options,
  }).completion;
  const message = result.runMessages.find(message => message.role === 'toolResult');
  if (message?.role !== 'toolResult') throw new Error(`Expected tool result, got ${result.status}`);
  return message.details as ToolExecutionResult;
}
