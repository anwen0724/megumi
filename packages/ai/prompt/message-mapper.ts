import type { ChatMessage, ChatRuntimeRequest } from '@megumi/shared/chat-contracts';
import type { SessionMessage } from '@megumi/shared/session-run-contracts';
import type { RunContext } from '@megumi/shared/run-context-contracts';
import type { ModelStepRuntimeRequest } from '@megumi/shared/model-step-contracts';
import type { PermissionModeSnapshot } from '@megumi/shared/permission-mode-contracts';
import type { ToolDefinition, ToolResult } from '@megumi/shared/tool-contracts';
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

  for (const toolResult of request.toolResults ?? []) {
    messages.push(mapToolResult(toolResult));
  }

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
