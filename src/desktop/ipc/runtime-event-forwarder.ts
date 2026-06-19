// Forwards AppEvent values to renderer runtime subscribers.
import type { BrowserWindow } from 'electron';
import type { AppApi } from '../../app';
import { mapAppEventToRuntimeEvent } from '../mappers/app-event-to-runtime-event.mapper';

export function registerRuntimeEventForwarder(options: {
  appApi: AppApi;
  getMainWindow(): BrowserWindow | undefined;
}): () => void {
  return options.appApi.subscribe((event) => {
    options.getMainWindow()?.webContents.send('megumi:runtime:event', mapAppEventToRuntimeEvent(event));
  });
}
