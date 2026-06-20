// Exposes typed renderer subscriptions for main-process runtime events.
import { ipcRenderer } from 'electron';
import type { RendererChatStreamEventDto, RendererRuntimeEventDto, RendererUnsubscribe } from '../../shared/renderer-contracts/renderer-api';

export function onRuntimeEvent(callback: (event: RendererRuntimeEventDto) => void): RendererUnsubscribe {
  const listener = (_event: Electron.IpcRendererEvent, payload: RendererRuntimeEventDto) => callback(payload);
  ipcRenderer.on('megumi:runtime:event', listener);
  return () => ipcRenderer.removeListener('megumi:runtime:event', listener);
}

export function onChatStreamEvent(callback: (event: RendererChatStreamEventDto) => void): RendererUnsubscribe {
  const listener = (_event: Electron.IpcRendererEvent, payload: RendererChatStreamEventDto) => callback(payload);
  ipcRenderer.on('megumi:chat-stream:event', listener);
  return () => ipcRenderer.removeListener('megumi:chat-stream:event', listener);
}
