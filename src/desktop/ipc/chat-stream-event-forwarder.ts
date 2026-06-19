// Forwards AgentRuntimeEvent values to renderer chat stream subscribers.
import type { BrowserWindow } from 'electron';
import type { AgentRuntimePort } from '../../app';
import { createAgentRuntimeChatStreamAdapter } from '../mappers/agent-runtime-chat-stream-adapter';

export function registerChatStreamEventForwarder(options: {
  agentRuntime: AgentRuntimePort;
  getMainWindow(): BrowserWindow | undefined;
}): () => void {
  const adapter = createAgentRuntimeChatStreamAdapter({
    publish(event) {
      options.getMainWindow()?.webContents.send('megumi:chat-stream:event', event);
    },
  });

  const unsubscribe = options.agentRuntime.subscribe((event) => adapter.handle(event));
  return () => {
    adapter.dispose();
    unsubscribe();
  };
}
