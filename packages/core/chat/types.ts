import type { ChatRuntimeRequest } from '@megumi/shared/chat-contracts';
import type { RunId } from '@megumi/shared/ids';
import type { AiChatPort } from '../ports/ai-port';

export interface ChatRuntimeClock {
  now(): string;
}

export interface RunChatTurnInput {
  request: ChatRuntimeRequest;
  aiPort: AiChatPort;
  signal?: AbortSignal;
  runIdFactory?: () => RunId | string;
  eventIdFactory?: () => string;
  clock?: ChatRuntimeClock;
}

export const defaultChatRuntimeClock: ChatRuntimeClock = {
  now: () => new Date().toISOString(),
};
