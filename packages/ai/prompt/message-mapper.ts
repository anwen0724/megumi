import type { ChatMessage, ChatRuntimeRequest } from '@megumi/shared/chat-contracts';
import type { SessionMessage } from '@megumi/shared/session-run-contracts';
import type { RunContext } from '@megumi/shared/run-context-contracts';
import type { ModelStepProviderState, ModelStepRuntimeRequest } from '@megumi/shared/model-step-contracts';
import type { PermissionModeSnapshot } from '@megumi/shared/permission-mode-contracts';
import type { ToolDefinition, ToolResult, ToolUse } from '@megumi/shared/tool-contracts';
import type {
  OpenAICompatibleChatCompletionRequestBody,
  OpenAICompatibleMessage,
  OpenAICompatibleToolDefinition,
} from '../types';
import { buildSystemPrompt } from './system-prompt';

export function mapModelStepToOpenAICompatibleRequest(
  request: ModelStepRuntimeRequest,
): OpenAICompatibleChatCompletionRequestBody {
  const tools = request.toolDefinitions?.map(mapToolDefinition);

  return {
    model: String(request.modelId),
    messages: mapModelStepToOpenAICompatibleMessages(request),
    stream: true,
    stream_options: {
      include_usage: true,
    },
    ...(tools && tools.length > 0 ? { tools, tool_choice: 'auto' as const } : {}),
  };
}

export function mapModelStepToOpenAICompatibleMessages(request: ModelStepRuntimeRequest): OpenAICompatibleMessage[] {
  const messages: OpenAICompatibleMessage[] = [
    {
      role: 'system',
      content: buildSystemPrompt(
        toChatRuntimeContext(request.context),
        request.modeSnapshot ? buildPermissionModePromptLines(request.modeSnapshot) : [],
      ),
    },
  ];

  for (const message of request.messages) {
    messages.push(mapSessionMessage(message));
  }

  messages.push(...mapPreviousToolInteractions(
    request.toolUses ?? [],
    request.toolResults ?? [],
    request.providerStates ?? [],
  ));

  return messages;
}

export function mapToOpenAICompatibleMessages(request: ChatRuntimeRequest): OpenAICompatibleMessage[] {
  const messages: OpenAICompatibleMessage[] = [
    {
      role: 'system',
      content: buildSystemPrompt(request.context),
    },
  ];

  for (const message of request.messages) {
    messages.push(mapMessage(message));
  }

  return messages;
}

function mapMessage(message: ChatMessage): OpenAICompatibleMessage {
  return {
    role: message.role,
    content: message.content,
    ...(message.name ? { name: message.name } : {}),
    ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}),
  };
}

function buildPermissionModePromptLines(mode: PermissionModeSnapshot): string[] {
  return [
    `Permission mode: ${mode.permissionMode}`,
    mode.permissionMode === 'plan'
      ? 'Produce a reviewable implementation plan. Do not modify files or run side-effecting commands.'
      : 'Produce the requested response within the current runtime and host boundaries.',
  ];
}

function mapSessionMessage(message: SessionMessage): OpenAICompatibleMessage {
  return {
    role: toOpenAICompatibleRole(message.role),
    content: message.content,
  };
}

function toOpenAICompatibleRole(role: SessionMessage['role']): OpenAICompatibleMessage['role'] {
  return role === 'host' ? 'system' : role;
}

function mapToolDefinition(tool: ToolDefinition): OpenAICompatibleToolDefinition {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  };
}

function mapToolResult(toolResult: ToolResult): OpenAICompatibleMessage {
  return {
    role: 'tool',
    tool_call_id: String(toolResult.toolUseId),
    content: stringifyToolResultContent(toolResult),
  };
}

function mapPreviousToolInteractions(
  toolUses: ToolUse[],
  toolResults: ToolResult[],
  providerStates: ModelStepProviderState[] = [],
): OpenAICompatibleMessage[] {
  if (toolResults.length === 0) {
    return [];
  }

  const toolUseById = new Map(toolUses.map((toolUse) => [String(toolUse.toolUseId), toolUse]));
  const messages: OpenAICompatibleMessage[] = [];
  let currentModelStepId: string | undefined;
  let currentToolCalls: ToolUse[] = [];
  let currentToolResults: ToolResult[] = [];

  const flush = () => {
    if (currentToolCalls.length > 0) {
      const reasoningContent = currentModelStepId
        ? reasoningContentForModelStep(providerStates, currentModelStepId)
        : undefined;

      messages.push({
        role: 'assistant',
        content: '',
        ...(reasoningContent ? { reasoning_content: reasoningContent } : {}),
        tool_calls: currentToolCalls.map(mapToolUseToOpenAICompatibleToolCall),
      });
    }

    for (const toolResult of currentToolResults) {
      messages.push(mapToolResult(toolResult));
    }

    currentModelStepId = undefined;
    currentToolCalls = [];
    currentToolResults = [];
  };

  for (const toolResult of toolResults) {
    const toolUse = toolUseById.get(String(toolResult.toolUseId));
    const modelStepId = toolUse ? String(toolUse.modelStepId) : undefined;

    if (currentToolResults.length > 0 && modelStepId !== currentModelStepId) {
      flush();
    }

    currentModelStepId = modelStepId;
    if (toolUse) {
      currentToolCalls.push(toolUse);
    }
    currentToolResults.push(toolResult);
  }

  flush();
  return messages;
}

function reasoningContentForModelStep(
  providerStates: ModelStepProviderState[],
  modelStepId: string,
): string | undefined {
  const text = providerStates
    .filter((state) => String(state.modelStepId) === modelStepId)
    .flatMap((state) => state.blocks)
    .filter((block) => block.type === 'reasoning_content')
    .map((block) => block.text)
    .join('');

  return text.length > 0 ? text : undefined;
}

function mapToolUseToOpenAICompatibleToolCall(toolUse: ToolUse) {
  return {
    id: String(toolUse.toolUseId),
    type: 'function' as const,
    function: {
      name: toolUse.toolName,
      arguments: JSON.stringify(toolUse.input ?? {}),
    },
  };
}

function stringifyToolResultContent(toolResult: ToolResult): string {
  if (toolResult.textContent !== undefined) {
    return toolResult.textContent;
  }

  return JSON.stringify({
    kind: toolResult.kind,
    ...(toolResult.structuredContent !== undefined ? { structuredContent: toolResult.structuredContent } : {}),
    ...(toolResult.denialReason ? { denialReason: toolResult.denialReason } : {}),
    ...(toolResult.error ? { error: toolResult.error } : {}),
  });
}

function toChatRuntimeContext(context: RunContext | undefined): ChatRuntimeRequest['context'] | undefined {
  if (!context) {
    return undefined;
  }

  return {
    workspaceId: context.workspaceBoundary.workspaceId,
    workspacePath: context.workspaceBoundary.rootPath,
    sessionTitle: context.goal,
  };
}
