// Forwards AgentRuntimeEvent values to renderer runtime subscribers.
import type { BrowserWindow } from 'electron';
import type { AgentRuntimePort } from '../../app';
import { mapAgentRuntimeEventToRendererRuntimeEvent } from '../mappers/agent-runtime-event-to-renderer-runtime-event.mapper';

export function registerRuntimeEventForwarder(options: {
  agentRuntime: AgentRuntimePort;
  getMainWindow(): BrowserWindow | undefined;
}): () => void {
  return options.agentRuntime.subscribe((event) => {
    options.getMainWindow()?.webContents.send('megumi:runtime:event', mapAgentRuntimeEventToRendererRuntimeEvent(event));
  });
}
