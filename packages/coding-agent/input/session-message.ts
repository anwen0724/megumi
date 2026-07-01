// Owns session-message input sensing before a Coding Agent run consumes it.
import type { SessionMessageSendPayload } from '@megumi/shared/ipc';
import type { JsonObject } from '@megumi/shared/primitives';
import type { PermissionMode, PermissionModeSelectionSource } from '@megumi/shared/permission';
import type { InputPreprocessingResult } from '@megumi/coding-agent/input';
import type { CommandAgentRunInput } from '../commands';
import { parseRawInput } from './normalizer';
import type { ParsedInput } from './parsed-input';
import { normalizeSessionMessageInputPreprocessing } from './preprocessing';

export type SessionMessageInputMessage = NonNullable<SessionMessageSendPayload['message']>;

export interface PreparedSessionMessageInput {
  currentUserMessage: SessionMessageInputMessage;
  permissionMode: PermissionMode;
  permissionSource: PermissionModeSelectionSource;
  inputPreprocessing: InputPreprocessingResult;
  metadata: JsonObject;
}

export interface PrepareSessionMessageInputInput {
  payload: SessionMessageSendPayload;
}

export interface ParseSessionMessageRawInputInput {
  requestId: string;
  runId: string;
  sessionId: string;
  message: SessionMessageInputMessage;
  createdAt: string;
  command?: CommandAgentRunInput['command'];
}

export function prepareSessionMessageInput(
  input: PrepareSessionMessageInputInput,
): PreparedSessionMessageInput {
  const currentUserMessage = currentUserChatMessage(input.payload);
  if (!currentUserMessage) {
    throw new Error('Session message send requires a user message.');
  }

  const normalizedInput = normalizeSessionMessageInputPreprocessing({
    rawText: currentUserMessage.content,
    requestedPermissionMode: input.payload.context?.permissionMode,
    requestedPermissionSource: input.payload.context?.permissionSource,
    preprocessing: input.payload.context?.preprocessing,
    createdAt: input.payload.createdAt,
  });

  return {
    currentUserMessage,
    permissionMode: normalizedInput.permissionMode,
    permissionSource: normalizedInput.permissionSource,
    inputPreprocessing: normalizedInput.inputPreprocessing,
    metadata: normalizedInput.metadata,
  };
}

export function parseSessionMessageRawInput(
  input: ParseSessionMessageRawInputInput,
): ParsedInput {
  return parseRawInput({
    id: `raw-input:${input.runId}:${input.message.id}`,
    source: {
      kind: 'desktop',
      surface: 'session-message',
    },
    text: input.message.content,
    target: {
      kind: 'session',
      sessionId: input.sessionId,
    },
    metadata: {
      requestId: input.requestId,
    },
    createdAt: input.createdAt,
  }, input.command ? { command: input.command } : {});
}

type SessionMessageSendHistoryMessage = NonNullable<SessionMessageSendPayload['messages']>[number];

function currentUserChatMessage(payload: SessionMessageSendPayload): SessionMessageInputMessage | undefined {
  if (payload.message) {
    return payload.message;
  }

  const lastUserMessage = findLastUserChatMessage(payload.messages ?? []);
  return lastUserMessage
    ? {
        id: lastUserMessage.id,
        content: lastUserMessage.content,
        createdAt: lastUserMessage.createdAt,
      }
    : undefined;
}

function findLastUserChatMessage(
  messages: SessionMessageSendHistoryMessage[],
): SessionMessageSendHistoryMessage | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === 'user') {
      return message;
    }
  }
  return undefined;
}
