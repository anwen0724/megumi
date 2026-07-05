/*
 * Forwards Coding Agent runtime and chat-stream events to renderer windows.
 */
import {
  RuntimeEventSchema,
  type RuntimeEvent,
} from '@megumi/coding-agent/events';
import {
  ChatStreamEventSchema,
  type ChatStreamEvent,
} from '@megumi/coding-agent/projections/chat-stream';
import type { RuntimeLogger } from '../services/agent-run/runtime-logger.service';
import { IPC_CHANNELS } from './channels';

export async function forwardRuntimeEvents(
  sender: { send(channel: string, event: RuntimeEvent): void },
  events: AsyncIterable<RuntimeEvent>,
  options: { logger?: RuntimeLogger } = {},
): Promise<void> {
  for await (const event of events) {
    const parsed = RuntimeEventSchema.safeParse(event);
    if (!parsed.success) {
      options.logger?.warn?.('Dropped invalid runtime event.', { error: parsed.error.message });
      continue;
    }
    sender.send(IPC_CHANNELS.runtime.event, parsed.data);
  }
}

export function forwardChatStreamEvent(
  sender: { send(channel: string, event: ChatStreamEvent): void },
  event: ChatStreamEvent,
  options: { logger?: RuntimeLogger } = {},
): void {
  const parsed = ChatStreamEventSchema.safeParse(event);
  if (!parsed.success) {
    options.logger?.warn?.('Dropped invalid chat stream event.', { error: parsed.error.message });
    return;
  }
  sender.send(IPC_CHANNELS.chatStream.event, parsed.data);
}
