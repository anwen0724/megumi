// Forwards AgentRuntimeEvent values to renderer chat stream subscribers.
import type { BrowserWindow } from 'electron';
import type { AgentRuntimePort } from '../../app';
import { ChatStreamEventSchema } from '../../shared/renderer-contracts/chat-stream';
import { createAgentRuntimeChatStreamAdapter } from '../renderer-protocol/agent-runtime-chat-stream-adapter';

export function registerChatStreamEventForwarder(options: {
  agentRuntime: AgentRuntimePort;
  getMainWindow(): BrowserWindow | undefined;
}): () => void {
  const adapter = createAgentRuntimeChatStreamAdapter({
    publish(event) {
      if (!ChatStreamEventSchema.safeParse(event).success) {
        return;
      }
      options.getMainWindow()?.webContents.send('megumi:chat-stream:event', event);
    },
  });

  const unsubscribe = options.agentRuntime.subscribe((event) => adapter.handle(event));
  return () => {
    adapter.dispose();
    unsubscribe();
  };
}
