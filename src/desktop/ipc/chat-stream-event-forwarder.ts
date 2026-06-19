// Forwards AppEvent values to renderer chat stream subscribers.
import type { BrowserWindow } from 'electron';
import type { AppApi } from '../../app';
import { mapAppEventToChatStreamEvent } from '../mappers/app-event-to-chat-stream-event.mapper';

export function registerChatStreamEventForwarder(options: {
  appApi: AppApi;
  getMainWindow(): BrowserWindow | undefined;
}): () => void {
  return options.appApi.subscribe((event) => {
    const mapped = mapAppEventToChatStreamEvent(event);
    if (mapped) options.getMainWindow()?.webContents.send('megumi:chat-stream:event', mapped);
  });
}
