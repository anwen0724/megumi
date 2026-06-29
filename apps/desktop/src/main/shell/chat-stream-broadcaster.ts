// Forwards product chat stream events to the current Electron renderer window.
// Holds a mutable window ref so composition can build the broadcaster before the
// window exists; createWindow attaches it via setWindow. Publishing is a no-op
// while no live window is attached, so the host interface never blocks on UI.
import type { ChatStreamEvent } from '@megumi/shared/chat-stream';
import { forwardChatStreamEvent } from '../ipc/chat-stream-event-forwarder';
import type { RuntimeLogger } from '../services/agent-run/runtime-logger.service';

export interface BroadcastWindow {
  isDestroyed(): boolean;
  webContents: { send(channel: string, event: ChatStreamEvent): void };
}

// Mirrors the product ChatStreamEventSink contract (a single publish method) so the
// broadcaster can be passed to composeCodingAgentRuntime as a chatStreamEventSink.
export interface ChatStreamBroadcaster {
  publish(event: ChatStreamEvent): void;
  setWindow(window: BroadcastWindow | undefined): void;
}

export interface CreateChatStreamBroadcasterOptions {
  logger?: RuntimeLogger;
}

export function createChatStreamBroadcaster(
  options: CreateChatStreamBroadcasterOptions = {},
): ChatStreamBroadcaster {
  let window: BroadcastWindow | undefined;

  return {
    setWindow(nextWindow) {
      window = nextWindow;
    },
    publish(event: ChatStreamEvent) {
      if (!window || window.isDestroyed()) {
        return;
      }
      forwardChatStreamEvent(window.webContents, event, { logger: options.logger });
    },
  };
}
