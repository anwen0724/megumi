import type { ChatMessage, ChatRuntimeRequest } from '@megumi/shared/chat-contracts';
import type { SessionMessage } from '@megumi/shared/session-run-contracts';
import type { RunContext } from '@megumi/shared/run-context-contracts';
import type { ModelStepRuntimeRequest } from '@megumi/shared/model-step-contracts';
import type { RunMode } from '@megumi/shared/run-mode-contracts';
import type { OpenAICompatibleMessage } from '../types';
import { buildSystemPrompt } from './system-prompt';

export function mapModelStepToOpenAICompatibleMessages(request: ModelStepRuntimeRequest): OpenAICompatibleMessage[] {
  const messages: OpenAICompatibleMessage[] = [
    {
      role: 'system',
      content: buildSystemPrompt(
        toChatRuntimeContext(request.context),
        request.modeSnapshot ? buildRunModePromptLines(request.modeSnapshot) : [],
      ),
    },
  ];

  for (const message of request.messages) {
    messages.push(mapSessionMessage(message));
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

function buildRunModePromptLines(mode: RunMode): string[] {
  return [
    `Run mode: ${mode.preset ?? 'custom'}`,
    `Task intent: ${mode.taskIntent}`,
    `Permission mode: ${mode.permissionMode}`,
    `Output expectation: ${mode.outputExpectation}`,
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
