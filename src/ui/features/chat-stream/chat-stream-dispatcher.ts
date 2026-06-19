import { ChatStreamEventSchema } from '@megumi/renderer-contracts/chat-stream';
import type { ChatStreamEvent } from '@megumi/renderer-contracts/chat-stream';
import { useChatStreamStore } from './chat-stream-store';

export function dispatchChatStreamEvent(payload: unknown): void {
  const parsed = ChatStreamEventSchema.safeParse(payload);

  if (!parsed.success) {
    return;
  }

  if (!('eventType' in parsed.data)) {
    return;
  }

  useChatStreamStore.getState().dispatch(parsed.data as ChatStreamEvent);
}

